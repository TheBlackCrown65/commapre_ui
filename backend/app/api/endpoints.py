from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, status, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..database import get_db
from ..models import Flow, Page, Mask, Job, FlowCreate, FlowRead, PageRead, MaskCreateRequest, MaskUpdateRequest, JobRead, FlowFolder, FolderCreate, FolderRead, SystemConfig, SystemConfigRead, SystemConfigUpdate, User
from ..core.deps import get_current_user, require_admin
from ..core.audit_logger import log_action
from ..events import job_events
import os
import shutil
import traceback
from typing import List, Optional, Annotated
from datetime import datetime
from pydantic import BaseModel

router = APIRouter()
OUTPUT_DIR = "/app/output"

class ReorderRequest(BaseModel):
    ids: List[int]

# --- Models สำหรับอัปเดตชื่อ ---
class FolderUpdate(BaseModel):
    name: str

class FlowUpdate(BaseModel):
    name: Optional[str] = None
    folder_id: Optional[int] = None
    note: Optional[str] = None

class PageUpdate(BaseModel):
    page_name: str

# --- Folders ---
@router.get("/folders", response_model=List[FolderRead])
def read_folders(squad_id: Optional[int] = None, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    query = db.query(FlowFolder)
    if squad_id:
        query = query.filter(FlowFolder.squad_id == squad_id)
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

@router.put("/folders/{folder_id}")
def update_folder(folder_id: int, req: FolderUpdate, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    folder = db.query(FlowFolder).filter(FlowFolder.id == folder_id).first()
    if folder:
        folder.name = req.name
        db.commit()
        job_events.broadcast("folder_updated", {"squad_id": folder.squad_id})
        log_action(
            user=current_user.username, event="FOLDER_UPDATED",
            details=f"id={folder_id}, name={req.name}",
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
def read_flows(squad_id: Optional[int] = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    query = db.query(Flow).order_by(Flow.sort_order.asc(), Flow.id.desc())
    if squad_id:
        # Filter flows by folders that belong to this squad OR root flows with this squad_id
        squad_folder_ids = [f.id for f in db.query(FlowFolder.id).filter(FlowFolder.squad_id == squad_id).all()]
        query = query.filter(
            (Flow.folder_id.in_(squad_folder_ids)) | (Flow.squad_id == squad_id)
        )
        
    flows = query.offset(skip).limit(limit).all()
    out = []
    
    for flow in flows:
        page_count = db.query(Page).filter(Page.flow_id == flow.id).count()
        f_dict = {
            "id": flow.id,
            "name": flow.name,
            "folder_id": flow.folder_id,
            "sort_order": flow.sort_order,
            "note": flow.note,
            "page_count": page_count,
            "pages": flow.pages
        }
        out.append(f_dict)
    
    return out

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
