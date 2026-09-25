from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, status, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..database import get_db
from ..models import Flow, Page, Mask, Job, FlowCreate, FlowRead, PageRead, MaskCreateRequest, MaskUpdateRequest, JobRead, FlowFolder, FolderCreate, FolderRead, SystemConfig, SystemConfigRead, SystemConfigUpdate, User, Squad, Department
from ..core.deps import get_current_user, require_admin
from ..core.audit_logger import log_action
from ..events import job_events
import os
import shutil
import traceback
from typing import List, Optional, Annotated
from datetime import datetime
from PIL import Image
from pydantic import BaseModel
import cv2
import numpy as np

router = APIRouter()
OUTPUT_DIR = "/app/output"

class ReorderRequest(BaseModel):
    ids: List[int]

# --- Models สำหรับอัปเดตชื่อ ---
class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None
    move_to_root: Optional[bool] = False

class FlowUpdate(BaseModel):
    name: Optional[str] = None
    folder_id: Optional[int] = None
    note: Optional[str] = None

class PageUpdate(BaseModel):
    page_name: str

class SmartMaskDetectRequest(BaseModel):
    page_id: int
    x: int
    y: int

# --- Folders ---
@router.get("/folders", response_model=List[FolderRead])
def read_folders(squad_id: Optional[int] = None, department_id: Optional[int] = None, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    query = db.query(FlowFolder)
    if squad_id:
        query = query.filter(FlowFolder.squad_id == squad_id)
    elif department_id:
        dept_squad_ids = [s.id for s in db.query(Squad.id).filter(Squad.department_id == department_id).all()]
        query = query.filter(FlowFolder.squad_id.in_(dept_squad_ids))
    return query.all()

@router.post("/folders", response_model=FolderRead)
def create_folder(folder: FolderCreate, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    squad_id = folder.squad_id

    # Depth check + inherit squad_id from parent
    if folder.parent_id:
        depth = 1
        parent = db.query(FlowFolder).filter(FlowFolder.id == folder.parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
        squad_id = parent.squad_id  # inherit from parent
        
        while parent.parent_id:
            depth += 1
            parent = db.query(FlowFolder).filter(FlowFolder.id == parent.parent_id).first()
            
        config_depth = db.query(SystemConfig).filter(SystemConfig.key == "max_folder_depth").first()
        max_depth = int(config_depth.value) if config_depth and config_depth.value.isdigit() else 3
        
        if depth >= max_depth:
            raise HTTPException(status_code=400, detail=f"Maximum folder depth is {max_depth} levels")

    db_folder = FlowFolder(name=folder.name, parent_id=folder.parent_id, squad_id=squad_id)
    db.add(db_folder)
    db.commit()
    db.refresh(db_folder)
    job_events.broadcast("folder_created", {"squad_id": db_folder.squad_id})
    log_action(
        user=current_user.username, event="FOLDER_CREATED",
        details=f"name={folder.name}, squad_id={squad_id}",
        level="INFO", module="FlowMgmt", request=request
    )
    return db_folder

def check_circular_dependency(db: Session, folder_id: int, target_parent_id: int):
    curr = target_parent_id
    while curr is not None:
        if curr == folder_id:
            raise HTTPException(status_code=400, detail="Cannot move folder into its own subfolder")
        parent = db.query(FlowFolder).filter(FlowFolder.id == curr).first()
        curr = parent.parent_id if parent else None

@router.put("/folders/{folder_id}", responses={400: {"description": "Cannot move folder into its own subfolder"}})
def update_folder(folder_id: int, req: FolderUpdate, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    folder = db.query(FlowFolder).filter(FlowFolder.id == folder_id).first()
    if folder:
        updated = False
        if req.name is not None:
            folder.name = req.name
            updated = True
        
        if req.move_to_root:
            folder.parent_id = None
            updated = True
        elif req.parent_id is not None:
            check_circular_dependency(db, folder_id, req.parent_id)
            folder.parent_id = req.parent_id
            updated = True
            
        if updated:
            db.commit()
            job_events.broadcast("folder_updated", {"squad_id": folder.squad_id})
            log_action(
                user=current_user.username, event="FOLDER_UPDATED",
                details=f"id={folder_id}, name={req.name}, parent={req.parent_id}, root={req.move_to_root}",
                level="INFO", module="FlowMgmt", request=request
            )
    return {"status": "success"}

@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: int, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    folder = db.query(FlowFolder).filter(FlowFolder.id == folder_id).first()
    if folder:
        # Before deleting, collect all flows inside this folder (and subfolders conceptually, but we rely on simple depth for now)
        # Note: cascading delete deletes the records, but we need the IDs to clean files
        # Let's recursive collect if needed, or simply all flows with this folder_id
        # Our depth is max 3, let's just collect flows for this folder (simplification, real recursive would be better, 
        # but SQLAlchemy cascade will delete all children folders)
        # A safer way to find all flows that will be deleted:
        def get_all_folder_ids(fid):
            ids = [fid]
            children = db.query(FlowFolder.id).filter(FlowFolder.parent_id == fid).all()
            for child in children:
                ids.extend(get_all_folder_ids(child[0]))
            return ids
            
        all_folder_ids = get_all_folder_ids(folder_id)
        flows = db.query(Flow.id).filter(Flow.folder_id.in_(all_folder_ids)).all()
        flow_ids = [f.id for f in flows]
        
        job_id_strs = []
        if flow_ids:
            jobs = db.query(Job).filter(Job.flow_id.in_(flow_ids)).all()
            active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]
            if active_jobs:
                raise HTTPException(status_code=400, detail="Cannot delete folder while jobs are QUEUED or PROCESSING")
            job_id_strs = [j.job_id_str for j in jobs]
        
        squad_id = folder.squad_id
        db.delete(folder)
        db.commit()
        job_events.broadcast("folder_deleted", {"squad_id": squad_id})
        log_action(
            user=current_user.username, event="FOLDER_DELETED",
            details=f"id={folder_id}, flows_affected={len(flow_ids)}",
            level="WARNING", module="FlowMgmt", request=request
        )
        
        refs_deleted = 0
        jobs_deleted = 0
        zips_deleted = 0
        delete_failures = 0
        for fid in flow_ids:
            ref_dir = os.path.join(OUTPUT_DIR, "references", str(fid))
            if os.path.exists(ref_dir):
                try:
                    shutil.rmtree(ref_dir)
                    refs_deleted += 1
                except Exception as e:
                    delete_failures += 1
                    log_action(
                        user=current_user.username, event="OUTPUT_DELETE_FAILED",
                        details=f"target=ref_dir, path={ref_dir}, err={type(e).__name__}",
                        level="WARNING", module="FlowMgmt", request=request
                    )

        for jid_str in job_id_strs:
            job_dir = os.path.join(OUTPUT_DIR, "jobs", jid_str)
            if os.path.exists(job_dir):
                try:
                    shutil.rmtree(job_dir)
                    jobs_deleted += 1
                except Exception as e:
                    delete_failures += 1
                    log_action(
                        user=current_user.username, event="OUTPUT_DELETE_FAILED",
                        details=f"target=job_dir, path={job_dir}, err={type(e).__name__}",
                        level="WARNING", module="FlowMgmt", request=request
                    )
            import glob
            for z in glob.glob(f"{OUTPUT_DIR}/zips/*_{jid_str}.zip"):
                try:
                    os.remove(z)
                    zips_deleted += 1
                except Exception as e:
                    delete_failures += 1
                    log_action(
                        user=current_user.username, event="OUTPUT_DELETE_FAILED",
                        details=f"target=zip, path={z}, err={type(e).__name__}",
                        level="WARNING", module="FlowMgmt", request=request
                    )
        log_action(
            user=current_user.username, event="OUTPUT_FILES_DELETED",
            details=f"scope=folder, folder_id={folder_id}, refs_deleted={refs_deleted}, jobs_deleted={jobs_deleted}, zips_deleted={zips_deleted}, failures={delete_failures}",
            level="INFO" if delete_failures == 0 else "WARNING", module="FlowMgmt", request=request
        )
                
    return {"status": "deleted"}

# --- Flows ---
@router.get("/flows", response_model=List[FlowRead])
def read_flows(squad_id: Optional[int] = None, department_id: Optional[int] = None, skip: int = 0, limit: int = 1000, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    query = db.query(Flow).order_by(Flow.sort_order.asc(), Flow.id.desc())
    if squad_id:
        # Filter flows by folders that belong to this squad OR root flows with this squad_id
        squad_folder_ids = [f.id for f in db.query(FlowFolder.id).filter(FlowFolder.squad_id == squad_id).all()]
        query = query.filter(
            (Flow.folder_id.in_(squad_folder_ids)) | (Flow.squad_id == squad_id)
        )
    elif department_id:
        dept_squad_ids = [s.id for s in db.query(Squad.id).filter(Squad.department_id == department_id).all()]
        dept_folder_ids = [f.id for f in db.query(FlowFolder.id).filter(FlowFolder.squad_id.in_(dept_squad_ids)).all()]
        query = query.filter(
            (Flow.folder_id.in_(dept_folder_ids)) | (Flow.squad_id.in_(dept_squad_ids))
        )
        
    flows = query.offset(skip).limit(limit).all()
    out = []
    
    for flow in flows:
        page_count = db.query(Page).filter(Page.flow_id == flow.id).count()
        eff_squad_id = flow.squad_id or (flow.folder.squad_id if flow.folder else None)
        f_dict = {
            "id": flow.id,
            "name": flow.name,
            "folder_id": flow.folder_id,
            "squad_id": eff_squad_id,
            "sort_order": flow.sort_order,
            "note": flow.note,
            "page_count": page_count,
            "pages": flow.pages
        }
        out.append(f_dict)
    
    return out

@router.get("/flows/{flow_id}", response_model=FlowRead)
def read_flow_by_id(flow_id: int, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")
    page_count = db.query(Page).filter(Page.flow_id == flow.id).count()
    return {
        "id": flow.id,
        "name": flow.name,
        "folder_id": flow.folder_id,
        "sort_order": flow.sort_order,
        "note": flow.note,
        "page_count": page_count,
        "pages": flow.pages
    }

@router.post("/flows", response_model=FlowRead)
def create_flow(flow: FlowCreate, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    db_flow = Flow(name=flow.name, folder_id=flow.folder_id, squad_id=flow.squad_id)
    db.add(db_flow)
    db.commit()
    db.refresh(db_flow)
    
    job_events.broadcast("flow_created", {"squad_id": db_flow.squad_id})
    log_action(
        user=current_user.username, event="FLOW_CREATED",
        details=f"name={flow.name}, folder_id={flow.folder_id}",
        level="INFO", module="FlowMgmt", request=request
    )
    
    # Return as dict matching FlowRead format
    return {
        "id": db_flow.id,
        "name": db_flow.name,
        "folder_id": db_flow.folder_id,
        "sort_order": db_flow.sort_order,
        "page_count": 0,
        "pages": []
    }

@router.put("/flows/reorder")
def reorder_flows(req: ReorderRequest, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    try:
        squad_id = None
        if req.ids:
            first_flow = db.query(Flow).filter(Flow.id == req.ids[0]).first()
            if first_flow:
                squad_id = first_flow.squad_id

        for index, flow_id in enumerate(req.ids):
            db.execute(text("UPDATE flows SET sort_order = :idx WHERE id = :fid"), {"idx": index, "fid": flow_id})
        db.commit()
        
        if squad_id:
            job_events.broadcast("flows_reordered", {"squad_id": squad_id})
            
        return {"message": "Flows reordered"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/flows/{flow_id}")
def update_flow(flow_id: int, req: FlowUpdate, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")
        
    try:
        update_data = req.model_dump(exclude_unset=True)
    except AttributeError:
        update_data = req.dict(exclude_unset=True)
        
    if "name" in update_data:
        flow.name = update_data["name"]
    if "folder_id" in update_data:
        flow.folder_id = update_data["folder_id"]
    if "note" in update_data:
        note_val = update_data["note"]
        if note_val is not None:
            # Validate max length from config
            config = db.query(SystemConfig).filter(SystemConfig.key == "max_flow_note_length").first()
            max_len = int(config.value) if config and config.value.isdigit() else 500
            if len(note_val) > max_len:
                raise HTTPException(status_code=400, detail=f"Note exceeds {max_len} characters")
            flow.note = note_val if note_val.strip() else None
        else:
            flow.note = None
    
    db.commit()
    job_events.broadcast("flow_updated", {"squad_id": flow.squad_id})
    log_action(
        user=current_user.username, event="FLOW_UPDATED",
        details=f"id={flow_id}",
        level="INFO", module="FlowMgmt", request=request
    )
    return {"status": "success"}

@router.delete("/flows/{flow_id}")
def delete_flow(flow_id: int, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow:
        # Get jobs before deletion
        jobs = db.query(Job).filter(Job.flow_id == flow_id).all()
        active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]
        if active_jobs:
            raise HTTPException(status_code=400, detail="Cannot delete flow while jobs are QUEUED or PROCESSING")
        job_id_strs = [j.job_id_str for j in jobs]

        refs_deleted = 0
        jobs_deleted = 0
        zips_deleted = 0
        delete_failures = 0
        ref_dir = os.path.join(OUTPUT_DIR, "references", str(flow_id))
        if os.path.exists(ref_dir):
            try:
                shutil.rmtree(ref_dir)
                refs_deleted += 1
            except Exception as e:
                delete_failures += 1
                log_action(
                    user=current_user.username, event="OUTPUT_DELETE_FAILED",
                    details=f"target=ref_dir, path={ref_dir}, err={type(e).__name__}",
                    level="WARNING", module="FlowMgmt", request=request
                )
            
        for jid_str in job_id_strs:
            job_dir = os.path.join(OUTPUT_DIR, "jobs", jid_str)
            if os.path.exists(job_dir):
                try:
                    shutil.rmtree(job_dir)
                    jobs_deleted += 1
                except Exception as e:
                    delete_failures += 1
                    log_action(
                        user=current_user.username, event="OUTPUT_DELETE_FAILED",
                        details=f"target=job_dir, path={job_dir}, err={type(e).__name__}",
                        level="WARNING", module="FlowMgmt", request=request
                    )
            import glob
            for z in glob.glob(f"{OUTPUT_DIR}/zips/*_{jid_str}.zip"):
                try:
                    os.remove(z)
                    zips_deleted += 1
                except Exception as e:
                    delete_failures += 1
                    log_action(
                        user=current_user.username, event="OUTPUT_DELETE_FAILED",
                        details=f"target=zip, path={z}, err={type(e).__name__}",
                        level="WARNING", module="FlowMgmt", request=request
                    )
        log_action(
            user=current_user.username, event="OUTPUT_FILES_DELETED",
            details=f"scope=flow, flow_id={flow_id}, refs_deleted={refs_deleted}, jobs_deleted={jobs_deleted}, zips_deleted={zips_deleted}, failures={delete_failures}",
            level="INFO" if delete_failures == 0 else "WARNING", module="FlowMgmt", request=request
        )
                
        squad_id = flow.squad_id
        db.delete(flow)
        db.commit()
        job_events.broadcast("flow_deleted", {"squad_id": squad_id})
        log_action(
            user=current_user.username, event="FLOW_DELETED",
            details=f"id={flow_id}, name={flow.name}",
            level="WARNING", module="FlowMgmt", request=request
        )
    return {"status": "deleted"}

# --- Pages ---
@router.post("/pages", response_model=PageRead)
def create_page(flow_id: int = Form(...), page_name: str = Form(...), file: UploadFile = File(...), request: Request = None, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if not flow: raise HTTPException(status_code=404, detail="Flow not found")
    
    current_pages = db.query(Page).filter(Page.flow_id == flow_id).count()
    
    config_count = db.query(SystemConfig).filter(SystemConfig.key == "max_images_per_flow").first()
    max_images = int(config_count.value) if config_count and config_count.value.isdigit() else 50
    
    # Resolve squad (flows inside folders might have squad_id=None)
    squad = flow.squad or (flow.folder.squad if flow.folder else None)
    
    # OVERRIDE with department's max_images_per_flow if set
    if squad and squad.department and squad.department.max_images_per_flow is not None:
        max_images = squad.department.max_images_per_flow

    if current_pages >= max_images:
        log_action(
            user=current_user.username, event="PAGE_CREATE_FAILED",
            details=f"flow_id={flow_id}, reason=max_images_reached, max_images={max_images}",
            level="WARNING", module="FlowMgmt", request=request
        )
        raise HTTPException(status_code=400, detail=f"Cannot upload more than {max_images} images per flow")

    # Validate System Config / Limits
    config_size = db.query(SystemConfig).filter(SystemConfig.key == "max_image_size_mb").first()
    max_size_mb = int(config_size.value) if config_size and config_size.value.isdigit() else 5
    max_bytes = max_size_mb * 1024 * 1024
    
    if file.size and file.size > max_bytes:
        log_action(
            user=current_user.username, event="PAGE_CREATE_FAILED",
            details=f"flow_id={flow_id}, reason=file_too_large, max_mb={max_size_mb}",
            level="WARNING", module="FlowMgmt", request=request
        )
        raise HTTPException(status_code=400, detail=f"File exceeds {max_size_mb}MB limit")
        
    save_dir = os.path.join(OUTPUT_DIR, "references", str(flow_id))
    os.makedirs(save_dir, exist_ok=True)
    filename = f"{page_name}.png" 
    file_path = os.path.join(save_dir, filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        log_action(
            user=current_user.username, event="PAGE_CREATE_FAILED",
            details=f"flow_id={flow_id}, reason=file_save_failed, err={type(e).__name__}",
            level="ERROR", module="FlowMgmt", request=request
        )
        raise HTTPException(status_code=500, detail="Failed to save file")
        
    step_order = current_pages + 1
    
    db_page = Page(flow_id=flow_id, page_name=page_name, image_path=f"references/{flow_id}/{filename}", step_order=step_order, sort_order=step_order)
    db.add(db_page)
    try:
        db.commit()
        db.refresh(db_page)
    except Exception as e:
        db.rollback()
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass
        log_action(
            user=current_user.username, event="PAGE_CREATE_FAILED",
            details=f"flow_id={flow_id}, reason=db_commit_failed, err={type(e).__name__}",
            level="ERROR", module="FlowMgmt", request=request
        )
        raise HTTPException(status_code=500, detail="Failed to create page")

    job_events.broadcast("page_created", {"flow_id": flow_id, "squad_id": flow.squad_id})
    log_action(
        user=current_user.username, event="PAGE_CREATED",
        details=f"flow_id={flow_id}, page_name={page_name}",
        level="INFO", module="FlowMgmt", request=request
    )
    return db_page

@router.get("/pages", response_model=List[PageRead])
def read_pages(flow_id: int, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    return db.query(Page).filter(Page.flow_id == flow_id).order_by(Page.sort_order.asc(), Page.id.asc()).all()

@router.put("/pages/reorder")
def reorder_pages(req: ReorderRequest, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    try:
        flow_id = None
        squad_id = None
        if req.ids:
            first_page = db.query(Page).filter(Page.id == req.ids[0]).first()
            if first_page:
                flow_id = first_page.flow_id
                squad_id = first_page.flow.squad_id

        for index, page_id in enumerate(req.ids):
            db.execute(text("UPDATE pages SET sort_order = :idx WHERE id = :pid"), {"idx": index, "pid": page_id})
        db.commit()
        
        if flow_id:
            job_events.broadcast("pages_reordered", {"flow_id": flow_id, "squad_id": squad_id})
            log_action(
                user=current_user.username, event="PAGES_REORDERED",
                details=f"flow_id={flow_id}, count={len(req.ids)}",
                level="INFO", module="FlowMgmt", request=request
            )
            
        return {"message": "Pages reordered"}
    except Exception as e:
        db.rollback()
        log_action(
            user=current_user.username, event="PAGES_REORDER_FAILED",
            details=f"reason=exception, err={type(e).__name__}",
            level="ERROR", module="FlowMgmt", request=request
        )
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/pages/{page_id}")
def update_page(page_id: int, req: PageUpdate, db: Session = Depends(get_db)):
    page = db.query(Page).filter(Page.id == page_id).first()
    if page:
        page.page_name = req.page_name
        db.commit()
        job_events.broadcast("page_updated", {"flow_id": page.flow_id, "squad_id": page.flow.squad_id})
    return {"status": "success"}

@router.put("/pages/{page_id}/image")
def change_page_image(page_id: int, file: UploadFile = File(...), request: Request = None, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    # Validate System Config / Limits
    config_size = db.query(SystemConfig).filter(SystemConfig.key == "max_image_size_mb").first()
    max_size_mb = int(config_size.value) if config_size and config_size.value.isdigit() else 5
    max_bytes = max_size_mb * 1024 * 1024
    
    if file.size and file.size > max_bytes:
        log_action(
            user=current_user.username, event="PAGE_IMAGE_CHANGE_FAILED",
            details=f"page_id={page_id}, flow_id={page.flow_id}, reason=file_too_large, max_mb={max_size_mb}",
            level="WARNING", module="FlowMgmt", request=request
        )
        raise HTTPException(status_code=400, detail=f"File exceeds {max_size_mb}MB limit")

    # Delete old image file if it exists
    old_path = os.path.join(OUTPUT_DIR, page.image_path) if page.image_path else None
    if old_path and os.path.exists(old_path):
        try:
            os.remove(old_path)
            log_action(
                user=current_user.username, event="PAGE_IMAGE_OLD_DELETED",
                details=f"page_id={page_id}, flow_id={page.flow_id}, path={page.image_path}",
                level="INFO", module="FlowMgmt", request=request
            )
        except Exception as e:
            log_action(
                user=current_user.username, event="PAGE_IMAGE_OLD_DELETE_FAILED",
                details=f"page_id={page_id}, flow_id={page.flow_id}, err={type(e).__name__}",
                level="WARNING", module="FlowMgmt", request=request
            )

    # Save new image using existing page_name
    save_dir = os.path.join(OUTPUT_DIR, "references", str(page.flow_id))
    os.makedirs(save_dir, exist_ok=True)
    filename = f"{page.page_name}.png"
    file_path = os.path.join(save_dir, filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        log_action(
            user=current_user.username, event="PAGE_IMAGE_CHANGE_FAILED",
            details=f"page_id={page_id}, flow_id={page.flow_id}, reason=file_save_failed, err={type(e).__name__}",
            level="ERROR", module="FlowMgmt", request=request
        )
        raise HTTPException(status_code=500, detail="Failed to save file")

    # Update DB
    page.image_path = f"references/{page.flow_id}/{filename}"
    try:
        db.commit()
        db.refresh(page)
    except Exception as e:
        db.rollback()
        log_action(
            user=current_user.username, event="PAGE_IMAGE_CHANGE_FAILED",
            details=f"page_id={page_id}, flow_id={page.flow_id}, reason=db_commit_failed, err={type(e).__name__}",
            level="ERROR", module="FlowMgmt", request=request
        )
        raise HTTPException(status_code=500, detail="Failed to update page image")
    job_events.broadcast("page_image_changed", {"flow_id": page.flow_id, "squad_id": page.flow.squad_id})
    log_action(
        user=current_user.username, event="PAGE_IMAGE_CHANGED",
        details=f"page_id={page_id}, flow_id={page.flow_id}",
        level="INFO", module="FlowMgmt", request=request
    )
    return page

@router.delete("/pages/{page_id}")
def delete_page(page_id: int, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    page = db.query(Page).filter(Page.id == page_id).first()
    if page:
        flow_id = page.flow_id
        squad_id = page.flow.squad_id
        image_path = page.image_path
        db.delete(page)
        db.commit()
        job_events.broadcast("page_deleted", {"flow_id": flow_id, "squad_id": squad_id})
        image_deleted = False
        if image_path:
            abs_path = os.path.join(OUTPUT_DIR, image_path)
            if os.path.exists(abs_path):
                try:
                    os.remove(abs_path)
                    log_action(
                        user=current_user.username, event="PAGE_IMAGE_DELETED",
                        details=f"page_id={page_id}, flow_id={flow_id}, path={image_path}",
                        level="INFO", module="FlowMgmt", request=request
                    )
                    image_deleted = True
                except Exception as e:
                    log_action(
                        user=current_user.username, event="PAGE_IMAGE_DELETE_FAILED",
                        details=f"page_id={page_id}, flow_id={flow_id}, err={type(e).__name__}",
                        level="WARNING", module="FlowMgmt", request=request
                    )
        if not image_deleted:
            log_action(
                user=current_user.username, event="PAGE_DELETED",
                details=f"page_id={page_id}, flow_id={flow_id}",
                level="INFO", module="FlowMgmt", request=request
            )
    return {"status": "deleted"}
# --- Masks ---
@router.post("/masks")
def create_mask(mask: MaskCreateRequest, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    db_mask = Mask(flow_id=mask.flow_id, page_id=mask.page_id, type=mask.type, x=mask.x, y=mask.y, width=mask.width, height=mask.height)
    db.add(db_mask)
    db.commit()
    log_action(
        user=current_user.username, event="MASK_CREATED",
        details=f"flow_id={mask.flow_id}, page_id={mask.page_id}, type={mask.type}",
        level="INFO", module="FlowMgmt", request=request
    )
    return {"status": "ok", "id": db_mask.id}

@router.get("/masks/{flow_id}")
def read_masks(flow_id: int, page_id: Optional[int] = None, type: Optional[str] = None, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    query = db.query(Mask).filter(Mask.flow_id == flow_id)
    if page_id: query = query.filter(Mask.page_id == page_id)
    if type: query = query.filter(Mask.type == type)
    return query.all()

@router.put("/masks/{mask_id}")
def update_mask(mask_id: int, req: MaskUpdateRequest, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    mask = db.query(Mask).filter(Mask.id == mask_id).first()
    if not mask:
        raise HTTPException(status_code=404, detail="Mask not found")
        
    mask.x = req.x
    mask.y = req.y
    mask.width = req.width
    mask.height = req.height
    db.commit()
    
    log_action(
        user=current_user.username, event="MASK_UPDATED",
        details=f"id={mask_id}, x={req.x}, y={req.y}, w={req.width}, h={req.height}",
        level="INFO", module="FlowMgmt", request=request
    )
    return {"status": "ok"}

@router.delete("/masks/{mask_id}")
def delete_mask(mask_id: int, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    mask = db.query(Mask).filter(Mask.id == mask_id).first()
    if mask:
        flow_id = mask.flow_id
        page_id = mask.page_id
        mask_type = mask.type
        db.delete(mask)
        db.commit()
        log_action(
            user=current_user.username, event="MASK_DELETED",
            details=f"id={mask_id}, flow_id={flow_id}, page_id={page_id}, type={mask_type}",
            level="INFO", module="FlowMgmt", request=request
        )
    return {"status": "deleted"}

@router.post("/masks/auto-global/{flow_id}")
def generate_auto_global_mask(
    flow_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page_id: Optional[int] = None
):
    """สร้าง Red Mark (Global Mask) สำหรับแถบ Status Bar อัตโนมัติ (4% ของความสูงจอ) จากขนาดของหน้า (หรือหน้าแรกใน Flow)"""
    target_page = None
    if page_id:
        target_page = db.query(Page).filter(Page.id == page_id, Page.flow_id == flow_id).first()
    if not target_page:
        target_page = db.query(Page).filter(Page.flow_id == flow_id).order_by(Page.sort_order.asc(), Page.id.asc()).first()

    if not target_page or not target_page.image_path:
        raise HTTPException(status_code=400, detail="Flow has no pages to calculate mask size")  # NOSONAR

    abs_path = os.path.join(OUTPUT_DIR, target_page.image_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Master image file not found")  # NOSONAR

    with Image.open(abs_path) as img:
        img_w, img_h = img.size

    mask_h = max(40, int(round(img_h * 0.04)))

    # อัปเดต Global Mask เดิมที่อยู่บนสุด (ถ้ามี) หรือสร้างใหม่
    existing_top_mask = db.query(Mask).filter(Mask.flow_id == flow_id, Mask.type == 'GLOBAL', Mask.y <= 10).first()
    if existing_top_mask:
        existing_top_mask.x = 0
        existing_top_mask.y = 0
        existing_top_mask.width = img_w
        existing_top_mask.height = mask_h
        db.commit()
        db.refresh(existing_top_mask)
        return {"status": "updated", "id": existing_top_mask.id, "x": 0, "y": 0, "width": img_w, "height": mask_h}

    new_mask = Mask(flow_id=flow_id, page_id=None, type='GLOBAL', x=0, y=0, width=img_w, height=mask_h)
    db.add(new_mask)
    db.commit()
    db.refresh(new_mask)
    return {"status": "created", "id": new_mask.id, "x": 0, "y": 0, "width": img_w, "height": mask_h}

def _extract_text_box(roi, rel_x, rel_y, img_w, img_h, roi_x1, roi_x2, roi_y1, roi_y2, click_x, click_y):
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

    # ดึงลายเส้นข้อความด้วย Background Subtraction รองรับทั้งตัวหนังสือมืดบนพื้นสว่าง และตัวหนังสือขาวบนปุ่มสี (เช่น ปุ่ม Save)
    bg = cv2.medianBlur(gray, 21)
    diff = cv2.absdiff(gray, bg)
    otsu_val, thresh = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if otsu_val < 15:
        _, thresh = cv2.threshold(diff, 18, 255, cv2.THRESH_BINARY)

    thresh[:, :10] = 0
    thresh[:, -10:] = 0

    cnts, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    comps = []
    for c in cnts:
        bx, by, bw, bh = cv2.boundingRect(c)
        if bw >= 2 and bh >= 4:
            # กรองเส้นแบ่งแนวตั้งบางๆ ออก
            if bw <= 2 and bh >= 30:
                continue
            comps.append((bx, by, bw, bh))

    if not comps:
        def_w = max(60, int(round(img_w * 0.08)))
        def_h = max(25, int(round(img_h * 0.02)))
        return int(max(0, click_x - def_w // 2)), int(max(0, click_y - def_h // 2)), int(def_w), int(def_h)

    # ค้นหาองค์ประกอบที่คลิกก่อน เพื่อทราบแนวแกน Y และความสูงของบรรทัด
    clicked_comp = min(comps, key=lambda c: (c[0] + c[2] / 2 - rel_x)**2 + (c[1] + c[3] / 2 - rel_y)**2)
    line_cy = clicked_comp[1] + clicked_comp[3] / 2
    line_h = max(24, clicked_comp[3])

    # องค์ประกอบที่อยู่บนบรรทัดเดียวกัน (รวมทั้งตัวอักษรปกติและจุดไข่ปลา ... / เครื่องหมายบนเส้นบรรทัด)
    line_comps = []
    for c in comps:
        v_overlap = max(0, min(c[1] + c[3], clicked_comp[1] + clicked_comp[3]) - max(c[1], clicked_comp[1]))
        c_cy = c[1] + c[3] / 2
        if v_overlap > 0 or abs(c_cy - line_cy) <= max(26, int(line_h * 0.9)):
            line_comps.append(c)

    line_comps.sort(key=lambda c: c[0])

    # รวมชิ้นส่วนที่ซ้อนทับหรือแตะกันในแนวนอน (เช่น ตัวอักษรที่มีสระ/วรรณยุกต์ หรือชิ้นส่วนไอคอน)
    merged = []
    for c in line_comps:
        if not merged:
            merged.append(list(c))
        else:
            prev = merged[-1]
            if c[0] <= prev[0] + prev[2]:
                new_x = min(prev[0], c[0])
                new_y = min(prev[1], c[1])
                new_r = max(prev[0] + prev[2], c[0] + c[2])
                new_b = max(prev[1] + prev[3], c[1] + c[3])
                merged[-1] = [new_x, new_y, new_r - new_x, new_b - new_y]
            else:
                merged.append(list(c))

    click_idx = min(range(len(merged)), key=lambda i: abs((merged[i][0] + merged[i][2] / 2) - rel_x))

    # คำนวณความสูงเฉลี่ยของข้อความบนบรรทัด เพื่อใช้แยกแยะไอคอน
    text_heights = [m[3] for m in merged if m[3] >= 12]
    med_h = float(np.median(text_heights)) if text_heights else 30.0

    # ฟังก์ชันตรวจสอบว่าชิ้นส่วนเป็น icon (ความสูงใหญ่กว่าตัวหนังสือชัดเจน และมีขนาดกว้างพอ)
    def is_icon(c):
        return c[3] > med_h * 1.6 and c[2] > med_h * 0.9

    clicked_is_icon = is_icon(merged[click_idx])

    # กำหนดระยะห่างสูงสุดระหว่างตัวอักษร/คำ (กว้างพอสำหรับเว้นวรรค แต่ไม่ข้ามช่องว่างไปยังไอคอนข้างหน้า/หลัง)
    max_gap = min(30, max(18, int(round(img_w * 0.022))))

    # ขยายขอบเขตไปทางซ้าย (หยุดเมื่อเจอระยะห่างเกินช่วงคำ หรือไอคอนข้างหน้า)
    left_idx = click_idx
    while left_idx > 0:
        prev = merged[left_idx - 1]
        cur = merged[left_idx]
        gap = cur[0] - (prev[0] + prev[2])
        if gap > max_gap:
            break
        # ตัวอักษรในคำเดียวกัน (gap < 12) จะไม่ถูกมองว่าเป็นไอคอนเด็ดขาด
        if gap >= 12 and not clicked_is_icon and is_icon(prev):
            break
        left_idx -= 1

    # ขยายขอบเขตไปทางขวา (หยุดเมื่อเจอระยะห่างเกินช่วงคำ หรือไอคอนข้างหลัง)
    right_idx = click_idx
    while right_idx < len(merged) - 1:
        nxt = merged[right_idx + 1]
        cur = merged[right_idx]
        gap = nxt[0] - (cur[0] + cur[2])
        if gap > max_gap:
            break
        if gap >= 12 and not clicked_is_icon and is_icon(nxt):
            break
        right_idx += 1

    selected = merged[left_idx : right_idx + 1]
    min_x = min(c[0] for c in selected)
    max_x = max(c[0] + c[2] for c in selected)
    min_y = min(c[1] for c in selected)
    max_y = max(c[1] + c[3] for c in selected)

    bw = max_x - min_x
    bh = max_y - min_y

    pad_x = max(12, int(round(img_w * 0.015)))
    pad_y = max(6, int(round(img_h * 0.004)))
    safe_gap = max(4, int(round(img_w * 0.003)))

    # ขยายขอบซ้ายรอบข้อความที่คลิก โดยถ้ามีไอคอนอยู่ข้างหน้า ต้องไม่ทับไอคอน
    final_x = max(0, roi_x1 + min_x - pad_x)
    if left_idx > 0 and is_icon(merged[left_idx - 1]):
        left_icon_edge = roi_x1 + merged[left_idx - 1][0] + merged[left_idx - 1][2]
        final_x = max(final_x, left_icon_edge + safe_gap)

    # ขยายขอบขวารอบข้อความที่คลิกให้สมมาตรและคลุมจุดไข่ปลา (...) สวยงาม โดยถ้ามีไอคอนข้างหลัง ต้องไม่ทับไอคอน
    final_right = min(img_w, roi_x1 + max_x + pad_x)
    if right_idx < len(merged) - 1 and is_icon(merged[right_idx + 1]):
        right_icon_edge = roi_x1 + merged[right_idx + 1][0]
        final_right = min(final_right, right_icon_edge - safe_gap)

    final_y = max(0, roi_y1 + min_y - pad_y)
    final_w = max(10, final_right - final_x)
    final_h = min(img_h - final_y, bh + pad_y * 2)

    return int(final_x), int(final_y), int(final_w), int(final_h)

@router.post("/masks/detect-text")
def detect_text_box(req: SmartMaskDetectRequest, db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(get_current_user)]):
    """ตรวจจับขอบเขตกลุ่มข้อความ/ตัวเลข (Word-level Bounding Box) ที่จุด (x, y) อัตโนมัติด้วย OpenCV"""
    page = db.query(Page).filter(Page.id == req.page_id).first()
    if not page or not page.image_path:
        raise HTTPException(status_code=404, detail="Page or image not found")  # NOSONAR

    abs_path = os.path.join(OUTPUT_DIR, page.image_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Master image file not found")  # NOSONAR

    img = cv2.imread(abs_path)
    if img is None:
        raise HTTPException(status_code=400, detail="Failed to load image")  # NOSONAR

    img_h, img_w = img.shape[:2]
    click_x = max(0, min(img_w - 1, int(req.x)))
    click_y = max(0, min(img_h - 1, int(req.y)))

    # กำหนด Region of Interest (ROI) ในแนวตั้งรอบจุดคลิก
    roi_h = max(300, int(round(img_h * 0.15)))
    roi_y1 = max(0, click_y - roi_h // 2)
    roi_y2 = min(img_h, click_y + roi_h // 2)
    roi_x1 = 0
    roi_x2 = img_w

    roi = img[roi_y1:roi_y2, roi_x1:roi_x2]
    if roi.size == 0:
        raise HTTPException(status_code=400, detail="Invalid coordinates")  # NOSONAR

    rel_x = click_x - roi_x1
    rel_y = click_y - roi_y1

    final_x, final_y, final_w, final_h = _extract_text_box(
        roi, rel_x, rel_y, img_w, img_h, roi_x1, roi_x2, roi_y1, roi_y2, click_x, click_y
    )

    return {
        "status": "ok",
        "x": final_x,
        "y": final_y,
        "width": final_w,
        "height": final_h
    }


# --- System Config ---
@router.get("/config", response_model=List[SystemConfigRead])
def read_all_configs(db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """ดึงค่าคอนฟิกระบบทั้งหมด (เฉพาะ ADMIN)"""
    return db.query(SystemConfig).order_by(SystemConfig.key).all()

@router.get("/config/{key}", response_model=SystemConfigRead)
def read_config(key: str, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """ดึงค่าคอนฟิกตาม Key ที่ระบุ (เฉพาะ ADMIN)"""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    return config

import socket
import os
import json

def restart_worker_container():
    """Trigger a restart of the worker container via Docker unix socket dynamically"""
    try:
        # 1. Connect to Docker socket to get our own container info
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect("/var/run/docker.sock")
        my_id = os.environ.get('HOSTNAME')
        req = f"GET /containers/{my_id}/json HTTP/1.0\r\n\r\n"
        sock.sendall(req.encode('utf-8'))
        
        data = b''
        while True:
            chunk = sock.recv(4096)
            if not chunk: break
            data += chunk
            
        body = data.split(b'\r\n\r\n', 1)[1]
        my_info = json.loads(body.decode('utf-8'))
        
        # 2. Find my project name
        my_project = my_info.get('Config', {}).get('Labels', {}).get('com.docker.compose.project')
        if not my_project:
            print("Could not find compose project label")
            return
            
        # 3. Reconnect to get worker containers
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect("/var/run/docker.sock")
        req = 'GET /containers/json?filters=%7B%22label%22%3A%5B%22com.docker.compose.service%3Dworker%22%5D%7D HTTP/1.0\r\n\r\n'
        sock.sendall(req.encode('utf-8'))
        
        data = b''
        while True:
            chunk = sock.recv(4096)
            if not chunk: break
            data += chunk
            
        body = data.split(b'\r\n\r\n', 1)[1]
        workers = json.loads(body.decode('utf-8'))
        
        # 4. Find the worker with the same project name
        target_worker_name = None
        for w in workers:
            if w.get('Labels', {}).get('com.docker.compose.project') == my_project:
                target_worker_name = w['Names'][0]
                break
                
        if not target_worker_name:
            print("Could not find matching worker container")
            return
            
        # 5. Reconnect to restart the worker
        print(f"Restarting worker: {target_worker_name}")
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect("/var/run/docker.sock")
        req = f"POST /containers{target_worker_name}/restart HTTP/1.0\r\n\r\n"
        sock.sendall(req.encode('utf-8'))
        
        data = sock.recv(4096)
        print("Worker restart response:", data.split(b'\n')[0])
    except Exception as e:
        print(f"Failed to auto-restart worker container: {e}")

@router.put("/config/{key}", response_model=SystemConfigRead)
def update_config(key: str, req: SystemConfigUpdate, request: Request, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """อัปเดตค่าคอนฟิก (เฉพาะ ADMIN)"""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    
    config.value = req.value
    db.commit()
    db.refresh(config)
    
    if key == "worker_concurrency":
        # Run restart synchronously so the UI waits for it to complete
        restart_worker_container()
    
    log_action(
        user=current_user.username, event="CONFIG_UPDATED",
        details=f"key={key}, value={req.value}",
        level="INFO", module="ConfigMgmt", request=request
    )
    return config
