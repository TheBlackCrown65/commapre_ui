from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from typing import List
import asyncio
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from .api import monitor as monitor_router
import os
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

tz_th = timezone(timedelta(hours=7))
import re
import io
import csv
import shutil
import traceback
import json
import zipfile
from sqlalchemy import text
from .worker.celery_app import celery_app

from PIL import Image, ImageChops, ImageDraw
import numpy as np
import cv2

from .database import engine, Base, SessionLocal, get_db
from sqlalchemy.orm import Session
from .models import Job, SystemConfig, Flow
from .api import endpoints
from .core.deps import get_current_user
from .api import auth as auth_router
from .api import org as org_router
from .api import roles as roles_router
from .events import job_events
from .api.monitor import invalidate_storage_cache
from .core.audit_logger import log_action, cleanup_old_logs

Base.metadata.create_all(bind=engine)

try:
    from .seed import seed_admin_user, seed_default_org, ensure_cascade_fks, seed_system_configs
    ensure_cascade_fks()
    seed_admin_user()
    seed_default_org()
    seed_system_configs()

    db = SessionLocal()
    try:
        existing = db.query(SystemConfig).filter(SystemConfig.key == 'max_dashboard_jobs').first()
        if not existing:
            new_config = SystemConfig(
                key='max_dashboard_jobs', 
                value='10', 
                description='Maximum jobs to display on Dashboard (No filter)'
            )
            db.add(new_config)
            db.commit()
        elif not existing.updated_at:
            existing.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
    finally:
        db.close()
        
except Exception as e:
    print(f"Seed warning: {e}")

app = FastAPI(title="Robot Verify API", version="1.0.0")

from .models import User
async def check_user_expirations():
    while True:
        try:
            db = SessionLocal()
            try:
                config_days_str = db.query(SystemConfig).filter(SystemConfig.key == 'offline_suspend_days').first()
                offline_days = int(config_days_str.value) if config_days_str else 30
                
                users = db.query(User).filter(User.status != "SUSPENDED", User.role != "ADMIN").all()
                now = datetime.now(tz_th).replace(tzinfo=None)
                for user in users:
                    suspend = False
                    # Check absolute expiration (at the end of the specified day)
                    if user.expire_date:
                        end_of_expire_day = user.expire_date.replace(hour=23, minute=59, second=59)
                        if end_of_expire_day < now:
                            suspend = True
                    # Check inactivity
                    elif user.last_login:
                        if (now - user.last_login).days >= offline_days:
                            suspend = True
                    # If no last_login, check created_at
                    else:
                        if (now - user.created_at).days >= offline_days:
                            suspend = True
                            
                    if suspend:
                        user.status = "SUSPENDED"
                        log_action(user="SYSTEM", event="AUTO_SUSPEND", details=f"user={user.username}", level="WARNING", module="UserMgmt")
                        job_events.broadcast("user_updated", {"user_id": user.id})
                db.commit()
            except Exception as e:
                print(f"Error checking user expirations: {e}")
            finally:
                db.close()
        except Exception as e:
            print(f"Outer loop error check_user_expirations: {e}")
            
        await asyncio.sleep(3600)  # Check every 1 hour

_background_tasks = set()

@app.on_event("startup")
async def startup_event_users():
    task = asyncio.create_task(check_user_expirations())
    _background_tasks.add(task)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

cors_origins_str = os.getenv("CORS_ORIGINS", "*")
cors_origins = [o.strip() for o in cors_origins_str.split(",")] if cors_origins_str != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)

@app.middleware("http")
async def audit_middleware(request: Request, call_next):
    response = await call_next(request)
    # Only auto-log mutating requests
    if request.method in ["POST", "PUT", "DELETE", "PATCH"]:
        # Check if an explicit log_action was already called by the route
        if not getattr(request.state, "audit_logged", False):
            # Attempt to extract user from state if a dependency set it
            user = getattr(request.state, "user", None)
            username = user.username if user else "API_USER"
            
            # Use log_action to record the event
            from .core.audit_logger import log_action
            log_action(
                user=username,
                event=f"API_CALL_{request.method}",
                details=f"Status: {response.status_code}",
                module="Middleware",
                request=request
            )
    return response

from starlette.responses import JSONResponse as StarletteJSONResponse

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == 401:
        detail_str = str(exc.detail) if exc.detail else ""
        if "หมดอายุ" in detail_str or "expired" in detail_str.lower():
            event = "SESSION_EXPIRED"
        else:
            event = "UNAUTHORIZED_ACCESS"
        log_action(
            user="-", event=event,
            details=f"endpoint={request.url.path}, reason={detail_str[:80]}",
            level="WARNING", module="SecurityService", request=request
        )
    elif exc.status_code == 403:
        log_action(
            user="-", event="UNAUTHORIZED_ACCESS",
            details=f"endpoint={request.url.path}, reason={str(exc.detail)[:80]}",
            level="WARNING", module="SecurityService", request=request
        )
    elif exc.status_code == 429:
        log_action(
            user="-", event="RATE_LIMITED",
            details=f"endpoint={request.url.path}",
            level="WARNING", module="SecurityService", request=request
        )
    
    return StarletteJSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None)
    )

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log_action(
        user="-", event="UNHANDLED_EXCEPTION",
        details=f"endpoint={request.url.path}, err={type(exc).__name__}",
        level="ERROR", module="Server", request=request
    )
    return StarletteJSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"}
    )

# 💡 Helper Function: หาชื่อ Department และ Squad จาก Flow (แก้ปัญหาหาชื่อทีมไม่เจอ)
def get_flow_org_info(flow):
    dept_id = None
    dept_name = None
    squad_name = None
    if not flow: return dept_id, dept_name, squad_name

    squad = None
    if hasattr(flow, 'squad') and flow.squad:
        squad = flow.squad
    elif hasattr(flow, 'folder') and flow.folder and hasattr(flow.folder, 'squad') and flow.folder.squad:
        squad = flow.folder.squad
    
    if squad:
        dept_id = squad.department_id
        squad_name = squad.name
        if hasattr(squad, 'department') and squad.department:
            dept_name = squad.department.name
            
    return dept_id, dept_name, squad_name


@app.get("/api/v1/jobs/stream")
async def job_event_stream(request: Request):
    queue = job_events.subscribe()

    async def event_generator():
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=30)
                    yield message
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            job_events.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    )


@app.post("/api/v1/jobs/notify")
async def notify_job_event(request: Request):
    data = await request.json()
    event_type = "job_completed" if data.get("status") == "COMPLETED" else "job_failed"
    job_events.broadcast(event_type, data)
    invalidate_storage_cache()
    return {"ok": True}

@app.post("/api/v1/jobs/notify_progress")
async def notify_job_progress(request: Request):
    data = await request.json()
    job_events.broadcast("job_progress", data)
    return {"ok": True}


def _check_queue_limits(db: Session):
    config_queue = db.query(SystemConfig).filter(SystemConfig.key == "max_queue_size").first()
    max_queue = int(config_queue.value) if config_queue and config_queue.value.isdigit() else 50
    current_queued = db.query(Job).filter(Job.status == "QUEUED").count()
    if current_queued >= max_queue:
        raise HTTPException(status_code=429, detail=f"Server is too busy. Queue is full ({max_queue} jobs). Please try again later.")

def _check_upload_limits(db: Session, files_a: List[UploadFile]):
    config_size = db.query(SystemConfig).filter(SystemConfig.key == "max_image_size_mb").first()
    max_size_mb = int(config_size.value) if config_size and config_size.value.isdigit() else 5
    max_bytes = max_size_mb * 1024 * 1024
    
    config_count = db.query(SystemConfig).filter(SystemConfig.key == "max_images_per_flow").first()
    max_images = int(config_count.value) if config_count and config_count.value.isdigit() else 50
    
    if len(files_a) > max_images:
        raise HTTPException(status_code=400, detail=f"Cannot upload more than {max_images} images per run")
        
    for file in files_a:
        if file.content_type not in ["image/jpeg", "image/png"]:
            raise HTTPException(status_code=400, detail=f"Invalid file type: {file.filename}. Only JPEG and PNG are allowed.")
        if file.size and file.size > max_bytes:
            raise HTTPException(status_code=400, detail=f"File {file.filename} exceeds {max_size_mb}MB limit")

@app.post("/api/v1/run-test")
@limiter.limit("30/minute")
def create_run_test(
    request: Request,
    flow_id: int = Form(...),
    files_a: List[UploadFile] = File(...),
    compare_by_order: str = Form("false"),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        _check_upload_limits(db, files_a)
        _check_queue_limits(db)

        job_id_str = datetime.now(tz_th).strftime("%Y%m%d%H%M%S%f")
        
        base_path = f"/app/output/jobs/{job_id_str}"
        dir_a = os.path.join(base_path, "device_a")
        dir_b = os.path.join(base_path, "device_b")
        dir_diff = os.path.join(base_path, "diff")

        for d in [dir_a, dir_b, dir_diff]:
            os.makedirs(d, exist_ok=True)

        db_job = Job(job_id_str=job_id_str, flow_id=flow_id, status="QUEUED")
        db.add(db_job)
        db.commit()
        db.refresh(db_job)
            
        for idx, file in enumerate(files_a, start=1):
            filename = os.path.basename(file.filename)
            safe_filename = f"{idx:04d}_{filename}" if compare_by_order.lower() == "true" else filename
            path = os.path.join(dir_a, safe_filename)
            with open(path, "wb") as f:
                shutil.copyfileobj(file.file, f)
        
        # 💡 หาชื่อทีมและเซฟลง meta.json
        flow = db.query(Flow).filter(Flow.id == flow_id).first()
        dept_id, dept_name, squad_name = get_flow_org_info(flow)

        if flow:
            with open(os.path.join(base_path, "meta.json"), "w") as f:
                json.dump({
                    "flow_name": flow.name, 
                    "compare_by_order": compare_by_order.lower() == "true",
                    "department_id": dept_id,
                    "department_name": dept_name,
                    "squad_name": squad_name,
                    "username": current_user.username if current_user else "Unknown"
                }, f)

        from .worker.tasks import process_comparison_job
        process_comparison_job.delay(db_job.id)
        
        try: cleanup_old_jobs(db)
        except: pass
        
        job_events.broadcast("job_created", {"job_id": job_id_str, "flow_id": flow_id, "status": "QUEUED", "department_id": dept_id})
        
        log_action(
            user=current_user.username, event="JOB_QUEUED",
            details=f"flow_id={flow_id}, files={len(files_a)}, job_id={job_id_str}",
            level="INFO", module="JobEngine", request=request
        )
        
        return {"message": "Job queued successfully", "job_id": job_id_str, "status": "QUEUED"}

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"{str(e)}")


def _resolve_flow_id_for_jenkins(db: Session, flow_id: int, flow_name: str, filename: str) -> int:
    if not filename.lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail="Only .zip files are allowed")
    if flow_id is None and flow_name is None:
        raise HTTPException(status_code=400, detail="Either flow_id or flow_name must be provided")
    
    if flow_id is not None:
        return flow_id
        
    flow = db.query(Flow).filter(Flow.name == flow_name).order_by(Flow.id.desc()).first()
    if not flow:
        raise HTTPException(status_code=404, detail=f"Flow with name '{flow_name}' not found")
    return flow.id

def _extract_jenkins_zip(file: UploadFile, base_path: str, dir_a: str):
    zip_path = os.path.join(base_path, "upload.zip")
    with open(zip_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        for zip_info in zip_ref.infolist():
            if zip_info.filename.lower().endswith(('.png', '.jpg', '.jpeg')) and not zip_info.filename.startswith('__MACOSX'):
                zip_info.filename = os.path.basename(zip_info.filename)
                zip_ref.extract(zip_info, dir_a)
    os.remove(zip_path)

@app.post("/api/v1/jobs/compare")
def create_jenkins_job(
    request: Request,
    flow_id: int = Form(None),
    flow_name: str = Form(None),
    webhook_url: str = Form(None),
    file: UploadFile = File(...),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        actual_flow_id = _resolve_flow_id_for_jenkins(db, flow_id, flow_name, file.filename)

        _check_queue_limits(db)

        job_id_str = datetime.now(tz_th).strftime("%Y%m%d%H%M%S%f")
        
        base_path = f"/app/output/jobs/{job_id_str}"
        dir_a = os.path.join(base_path, "device_a")
        dir_b = os.path.join(base_path, "device_b")
        dir_diff = os.path.join(base_path, "diff")

        for d in [dir_a, dir_b, dir_diff]:
            os.makedirs(d, exist_ok=True)

        db_job = Job(job_id_str=job_id_str, flow_id=actual_flow_id, status="QUEUED")
        db.add(db_job)
        db.commit()
        db.refresh(db_job)
            
        _extract_jenkins_zip(file, base_path, dir_a)
        
        # 💡 หาชื่อทีมและเซฟลง meta.json สำหรับ Jenkins
        flow = db.query(Flow).filter(Flow.id == actual_flow_id).first()
        dept_id, dept_name, squad_name = get_flow_org_info(flow)

        meta_data = {
            "flow_name": flow.name if flow else "job", 
            "department_id": dept_id,
            "department_name": dept_name,
            "squad_name": squad_name,
            "username": current_user.username if current_user else "Unknown"
        }

        if webhook_url:
            meta_data["webhook_url"] = webhook_url
            
        with open(os.path.join(base_path, "meta.json"), "w") as f:
            json.dump(meta_data, f)

        from .worker.tasks import process_comparison_job
        process_comparison_job.delay(db_job.id)

        job_events.broadcast("job_created", {"job_id": job_id_str, "flow_id": actual_flow_id, "status": "QUEUED", "department_id": dept_id})
        
        log_action(
            user=current_user.username, event="JENKINS_JOB_QUEUED",
            details=f"flow_id={actual_flow_id}, job_id={job_id_str}",
            level="INFO", module="JobEngine", request=request
        )
        
        return {
            "job_id": job_id_str,
            "status": "queued",
            "poll_url": f"/api/v1/jobs/{job_id_str}/status",
            "department_id": dept_id
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"{str(e)}")





@app.get("/api/v1/jobs/{job_id}/status")
def get_job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.job_id_str == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    dept_id, _, _ = get_flow_org_info(job.flow)
    
    return {
        "job_id": job.job_id_str,
        "status": job.status,
        "error_message": job.error_message,
        "department_id": dept_id
    }

@app.get("/api/v1/jobs/{job_id}")
def get_job_details_real(job_id: str, db: Session = Depends(get_db)):
    job_dir = f"/app/output/jobs/{job_id}"
    report_path = os.path.join(job_dir, "report.json")
    
    db_job = db.query(Job).filter(Job.job_id_str == str(job_id)).first()
    flow_name = db_job.flow.name if db_job and db_job.flow else "job"
    status = db_job.status if db_job else "COMPLETED"
    
    if status in ["QUEUED", "PROCESSING"]:
        return {"id": job_id, "status": status, "flow_name": flow_name, "files": []}

    if os.path.exists(report_path):
        try:
            with open(report_path, "r") as f:
                results = json.load(f)
            return {"id": job_id, "status": status, "flow_name": flow_name, "results": results}
        except: pass

    device_a_path = os.path.join(job_dir, "device_a")
    if not os.path.exists(device_a_path):
        return {"id": job_id, "status": status, "flow_name": flow_name, "files": []}
    
    files = [f for f in os.listdir(device_a_path) if f.lower().endswith(('.png','.jpg'))]
    files.sort()
    return {"id": job_id, "status": status, "flow_name": flow_name, "files": files}


@app.get("/api/v1/jobs/{job_id}/export/csv")
def export_job_csv(job_id: str, db: Session = Depends(get_db)):
    job_dir = f"/app/output/jobs/{job_id}"
    report_path = os.path.join(job_dir, "report.json")
    if not os.path.exists(report_path):
        raise HTTPException(status_code=404, detail="Job report not found")
    try:
        with open(report_path, "r") as f:
            results = json.load(f)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Filename', 'Status', 'Difference Points', 'Notes'])
        for r in results:
            writer.writerow([r.get('filename'), r.get('status'), r.get('diff_count'), r.get('message', '')])
        headers = {'Content-Disposition': f'attachment; filename="report_{job_id}.csv"'}
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers=headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export CSV: {e}")

@app.get("/api/v1/jobs/{job_id}/export/excel")
def export_job_excel(job_id: str, db: Session = Depends(get_db)):
    job_dir = f"/app/output/jobs/{job_id}"
    report_path = os.path.join(job_dir, "report.json")
    if not os.path.exists(report_path):
        raise HTTPException(status_code=404, detail="Job report not found")
    try:
        with open(report_path, "r") as f:
            results = json.load(f)
        html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><table border="1">'
        html += '<tr><th>Filename</th><th>Status</th><th>Difference Points</th><th>Notes</th></tr>'
        for r in results:
            html += f"<tr><td>{r.get('filename')}</td><td>{r.get('status')}</td><td>{r.get('diff_count')}</td><td>{r.get('message', '')}</td></tr>"
        html += '</table></body></html>'
        headers = {'Content-Disposition': f'attachment; filename="report_{job_id}.xls"'}
        return StreamingResponse(iter([html]), media_type="application/vnd.ms-excel", headers=headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export Excel: {e}")


@app.get("/api/v1/jobs")
def get_jobs_list(department_id: int = None, db: Session = Depends(get_db)):
    root = "/app/output/jobs"
    dir_jobs = []
    if os.path.exists(root):
        dir_jobs = [d for d in os.listdir(root) if d.isdigit()]
        
    config_max = db.query(SystemConfig).filter(SystemConfig.key == "max_jobs_per_department").first()
    max_jobs_limit = int(config_max.value) if config_max and config_max.value.isdigit() else 10
        
    config_dash = db.query(SystemConfig).filter(SystemConfig.key == "max_dashboard_jobs").first()
    max_dash_limit = int(config_dash.value) if config_dash and config_dash.value.isdigit() else 10
        
    db_jobs = db.query(Job).order_by(Job.id.desc()).all()
    job_map = {}
    db_modified = False
    
    for j in db_jobs:
        job_dir = os.path.join(root, j.job_id_str)
        if not os.path.exists(job_dir):
            if not j.created_at or (datetime.now(timezone.utc).replace(tzinfo=None) - j.created_at).total_seconds() > 60:
                db.delete(j)
                db_modified = True
        else:
            job_map[j.job_id_str] = j
            
    if db_modified:
        db.commit()
    
    all_jobs_set = set(dir_jobs) | set(job_map.keys())
    all_jobs = list(all_jobs_set)
    all_jobs.sort(key=lambda x: int(x) if x.isdigit() else 0, reverse=True)
    
    result = []
    for j in all_jobs:
        db_job = job_map.get(j)
        flow_obj = db_job.flow if db_job else None
        
        # 💡 หาข้อมูลจาก Database
        db_dept_id, db_dept_name, db_squad_name = get_flow_org_info(flow_obj)

        # 💡 หาข้อมูลจาก meta.json เผื่อไว้กรณี Database หลุด
        meta_dept_id, meta_dept_name, meta_squad_name, meta_username = None, None, None, None
        flow_name = db_job.flow.name if flow_obj else "job"
        
        meta_path = os.path.join(root, j, "meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                    if "flow_name" in meta: flow_name = meta["flow_name"]
                    meta_dept_id = meta.get("department_id")
                    meta_dept_name = meta.get("department_name")
                    meta_squad_name = meta.get("squad_name")
                    meta_username = meta.get("username")
            except: pass
            
        final_dept_id = db_dept_id or meta_dept_id
        final_dept_name = db_dept_name or meta_dept_name
        final_squad_name = db_squad_name or meta_squad_name
        final_username = meta_username or "Unknown"

        # 💡 กรองข้อมูลตาม Department ID 
        if department_id and final_dept_id != department_id:
            continue
            
        if department_id and len(result) >= max_jobs_limit:
            break
        if not department_id and len(result) >= max_dash_limit:
            break
                
        status = db_job.status if db_job else "COMPLETED"
        error_message = db_job.error_message if db_job else None
        created_at = None
        
        if db_job:
            dt_str = db_job.created_at.isoformat() if db_job.created_at else None
            if dt_str and "+" not in dt_str and not dt_str.endswith("Z"):
                created_at = dt_str + "Z"
            else:
                created_at = dt_str
        else:
            try:
                dt = datetime.strptime(j, "%Y%m%d%H%M%S")
                created_at = dt.isoformat()
            except ValueError:
                try:
                    folder_path = os.path.join(root, j)
                    mtime = os.path.getmtime(folder_path)
                    created_at = datetime.fromtimestamp(mtime).isoformat()
                except: pass
                
        result.append({
            "id": j,
            "status": status,
            "created_at": created_at,
            "flow_name": flow_name,
            "error_message": error_message,
            "department_name": final_dept_name,
            "squad_name": final_squad_name,
            "username": final_username
        })
        
    return result

@app.delete("/api/v1/jobs/{job_id}")
def delete_job(job_id: str, request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    db_job = db.query(Job).filter(Job.job_id_str == str(job_id)).first()
    if db_job:
        db.delete(db_job)
        db.commit()

    job_dir = f"/app/output/jobs/{job_id}"
    if os.path.exists(job_dir):
        try: shutil.rmtree(job_dir)
        except Exception as e: pass
        
    invalidate_storage_cache()
    job_events.broadcast("job_deleted", {"job_id": job_id})

    log_action(
        user=current_user.username, event="JOB_DELETED",
        details=f"job_id={job_id}",
        level="INFO", module="JobEngine", request=request
    )
    return {"message": f"Job {job_id} deleted"}

async def daily_retention_cleanup():
    while True:
        try:
            db = SessionLocal()
            try:
                time_conf = db.query(SystemConfig).filter(SystemConfig.key == "job_cleanup_time").first()
                cleanup_time = time_conf.value if time_conf else "02:00"
                
                retention_conf = db.query(SystemConfig).filter(SystemConfig.key == "job_retention_days").first()
                retention_days = int(retention_conf.value) if retention_conf and retention_conf.value.isdigit() else 30
            finally:
                db.close()
                
            now = datetime.now(tz_th)
            try:
                target_hour, target_minute = map(int, cleanup_time.split(':'))
            except Exception:
                target_hour, target_minute = 2, 0

            target_time = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
            if now >= target_time:
                target_time += timedelta(days=1)
                
            sleep_seconds = (target_time - now).total_seconds()
            print(f"💤 Sleeping for {sleep_seconds} seconds until next cleanup at {target_time.strftime('%Y-%m-%d %H:%M:%S')}")
            await asyncio.sleep(sleep_seconds)
            
            db = SessionLocal()
            try:
                retention_conf = db.query(SystemConfig).filter(SystemConfig.key == "job_retention_days").first()
                retention_days = int(retention_conf.value) if retention_conf and retention_conf.value.isdigit() else 30

                print(f"🧹 Running Daily Retention Cleanup (Retention: {retention_days} days)")
                threshold_date = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=retention_days)
                
                old_jobs = db.query(Job).filter(Job.created_at < threshold_date).all()
                for job in old_jobs:
                    job_id_str = job.job_id_str
                    db.delete(job)
                    job_dir = f"/app/output/jobs/{job_id_str}"
                    if os.path.exists(job_dir):
                        shutil.rmtree(job_dir, ignore_errors=True)
                db.commit()
                
                root = "/app/output/jobs"
                if os.path.exists(root):
                    for folder_name in os.listdir(root):
                        if folder_name.isdigit():
                            folder_path = os.path.join(root, folder_name)
                            try:
                                mtime = os.path.getmtime(folder_path)
                                folder_dt = datetime.fromtimestamp(mtime)
                                if folder_dt < threshold_date:
                                    if not db.query(Job).filter(Job.job_id_str == folder_name).first():
                                        shutil.rmtree(folder_path, ignore_errors=True)
                            except Exception as e:
                                pass
                                
                print(f"✅ Daily Retention Cleanup finished.")
                invalidate_storage_cache()
                
                try:
                    deleted_logs = cleanup_old_logs()
                    if deleted_logs > 0:
                        log_action(user="SYSTEM", event="AUDIT_LOG_CLEANUP", details=f"deleted={deleted_logs} files", level="INFO", module="SystemService")
                except Exception: pass
                
                if old_jobs:
                    log_action(user="SYSTEM", event="DAILY_CLEANUP", details=f"deleted={len(old_jobs)} jobs, retention={retention_days}d", level="INFO", module="SystemService")
            finally:
                db.close()
                
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"Error in daily_retention_cleanup: {e}")
            await asyncio.sleep(60)

@app.on_event("startup")
async def startup_event_cleanup():
    task = asyncio.create_task(daily_retention_cleanup())
    _background_tasks.add(task)
    log_action(user="SYSTEM", event="SYSTEM_STARTUP", details="-", level="INFO", module="SystemService")
    try:
        deleted = cleanup_old_logs()
        if deleted > 0:
            log_action(user="SYSTEM", event="AUDIT_LOG_CLEANUP", details=f"deleted={deleted} files", level="INFO", module="SystemService")
    except Exception as e:
        print(f"Audit log cleanup error: {e}")

class HealRequest(BaseModel):
    filename: str = None  

@app.post("/api/v1/jobs/{job_id}/heal")
def heal_job_baseline(job_id: str, req: HealRequest, request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.job_id_str == str(job_id)).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    flow_id = job.flow_id
    meta_path = f"/app/output/jobs/{job_id}/meta.json"
    compare_by_order = False
    
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
                compare_by_order = meta.get("compare_by_order", False)
        except: pass

    p_rows = db.execute(text("SELECT id, page_name, sort_order, image_path FROM pages WHERE flow_id = :fid ORDER BY sort_order ASC, id ASC"), {"fid": flow_id}).fetchall()

    pages_ordered = []
    page_sort_map = {}
    page_path_map = {}
    for p in p_rows:
        pname = str(p[1]).lower().strip()
        porder = p[2] if len(p) > 2 and p[2] is not None else 999
        pages_ordered.append(pname)
        page_sort_map[pname] = porder
        page_path_map[pname] = str(p[3]) if len(p) > 3 else None

    dir_a = f"/app/output/jobs/{job_id}/device_a"
    if not os.path.exists(dir_a):
        raise HTTPException(status_code=404, detail="New images directory not found")

    saved_files = sorted([f for f in os.listdir(dir_a) if f.lower().endswith(('.png', '.jpg', '.jpeg'))])
    healed_count = 0

    for idx, filename in enumerate(saved_files):
        if req.filename and req.filename != "all" and filename != req.filename:
            continue

        fname_key = filename.lower().strip()
        fname_no_ext = os.path.splitext(fname_key)[0]
        ref_page_name = None

        if compare_by_order:
            if idx < len(pages_ordered):
                ref_page_name = pages_ordered[idx]
        else:
            if fname_key in page_sort_map: ref_page_name = fname_key
            elif fname_no_ext in page_sort_map: ref_page_name = fname_no_ext

        if ref_page_name and ref_page_name in page_path_map and page_path_map[ref_page_name]:
            rel_path = page_path_map[ref_page_name]
            master_path = os.path.join("/app/output", rel_path.lstrip("/"))
            new_img_path = os.path.join(dir_a, filename)

            if os.path.exists(new_img_path):
                os.makedirs(os.path.dirname(master_path), exist_ok=True)
                shutil.copy2(new_img_path, master_path)
                healed_count += 1

    if healed_count > 0:
        job_events.broadcast("page_image_changed", {"flow_id": flow_id})
        
    log_action(user=current_user.username, event="BASELINE_HEALED", details=f"job_id={job_id}, healed_count={healed_count}", level="INFO", module="HealEngine", request=request)
    return {"message": "Healing successful", "healed_count": healed_count}

def _delete_job_files(job_id_str: str, root: str):
    job_dir = os.path.join(root, job_id_str)
    try:
        if os.path.exists(job_dir):
            shutil.rmtree(job_dir)
        for z in glob.glob(f"/app/output/zips/*_{job_id_str}.zip"):
            try:
                os.remove(z)
            except Exception:
                pass
    except Exception:
        pass

def cleanup_old_jobs(db: Session = None):
    if not db: return
    root = "/app/output/jobs"
    if not os.path.exists(root): return
        
    config_max = db.query(SystemConfig).filter(SystemConfig.key == "max_jobs_per_department").first()
    max_jobs_limit = int(config_max.value) if config_max and config_max.value.isdigit() else 10
    
    jobs = db.query(Job).all()
    dept_jobs = {}
    orphan_jobs = [] 
    
    for job in jobs:
        # 💡 ใช้ Helper function หา dept_id ให้แม่นยำขึ้นตอนสั่งลบ
        dept_id, _, _ = get_flow_org_info(job.flow)
            
        if dept_id:
            if dept_id not in dept_jobs:
                dept_jobs[dept_id] = []
            dept_jobs[dept_id].append(job)
        else:
            orphan_jobs.append(job)
            
    jobs_to_delete = []
    
    for dept_id, j_list in dept_jobs.items():
        j_list.sort(key=lambda x: x.id, reverse=True)
        if len(j_list) > max_jobs_limit:
            jobs_to_delete.extend(j_list[max_jobs_limit:])
            
    orphan_jobs.sort(key=lambda x: x.id, reverse=True)
    if len(orphan_jobs) > max_jobs_limit:
        jobs_to_delete.extend(orphan_jobs[max_jobs_limit:])

    for job in jobs_to_delete:
        job_id_str = job.job_id_str
        db.delete(job)
        db.commit()
        _delete_job_files(job_id_str, root)

class ReorderRequest(BaseModel):
    ids: List[int]

app.include_router(endpoints.router, prefix="/api/v1", tags=["Settings"])
app.include_router(auth_router.router, prefix="/api/v1", tags=["Auth"])
app.include_router(org_router.router, prefix="/api/v1", tags=["Organization"])
app.include_router(roles_router.router, prefix="/api/v1", tags=["Roles"])
app.include_router(monitor_router.router, prefix="/api/v1", tags=["Monitor"])

from .api import users as users_router
app.include_router(users_router.router, prefix="/api/v1", tags=["Users"])

from .api import audit as audit_router
app.include_router(audit_router.router, prefix="/api/v1/audit", tags=["Audit"])

from .pdf_export import register_pdf_export
register_pdf_export(app)

os.makedirs("/app/output", exist_ok=True)
app.mount("/output", StaticFiles(directory="/app/output"), name="output")