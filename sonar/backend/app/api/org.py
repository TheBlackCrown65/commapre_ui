"""
Organization API Endpoints
============================
CRUD for Department + Squad
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os
import shutil
import glob

from ..database import get_db
from ..models import Department, Squad, FlowFolder, Flow
from ..events import job_events
from ..core.audit_logger import log_action
from ..core.deps import require_admin, get_current_user
from sqlalchemy.exc import IntegrityError

router = APIRouter(prefix="/org", tags=["Organization"])


# --- Pydantic Schemas ---
class DepartmentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    max_images_per_flow: Optional[int] = None

class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    max_images_per_flow: Optional[int] = None

class SquadCreate(BaseModel):
    name: str
    department_id: int
    description: Optional[str] = None

class SquadUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class SquadRead(BaseModel):
    id: int
    name: str
    department_id: int
    description: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

class DepartmentRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    max_images_per_flow: Optional[int] = None
    created_at: datetime
    squads: List[SquadRead] = []
    class Config:
        from_attributes = True


# --- Access Helper ---
def check_dept_access(user, dept_id: int):
    if user.role == "ADMIN" and not user.custom_role_id:
        return True # Super admin
    allowed = []
    if user.department_id:
        allowed.append(user.department_id)
    if user.support_roles:
        allowed.extend([sr.department_id for sr in user.support_roles])
    return dept_id in allowed


# =============================================
# Public Endpoints (no auth required)
# =============================================
@router.get("/public/departments", response_model=List[DepartmentRead])
def list_departments_public(db: Session = Depends(get_db)):
    """List all departments with their squads (public - for registration form)"""
    depts = db.query(Department).all()
    depts.sort(key=lambda d: d.name.lower())
    for d in depts:
        d.squads.sort(key=lambda s: s.name.lower())
    return depts


# =============================================
# Department CRUD
# =============================================
@router.get("/departments", response_model=List[DepartmentRead])
def list_departments(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """List all departments with their squads"""
    query = db.query(Department)
    if current_user.role != "ADMIN" or current_user.custom_role_id:
        allowed_depts = []
        if current_user.department_id:
            allowed_depts.append(current_user.department_id)
        if current_user.support_roles:
            allowed_depts.extend([sr.department_id for sr in current_user.support_roles])
        
        if not allowed_depts:
            return []
            
        query = query.filter(Department.id.in_(allowed_depts))
        
    depts = query.all()
    depts.sort(key=lambda d: d.name.lower())
    for d in depts:
        d.squads.sort(key=lambda s: s.name.lower())
    return depts


@router.post("/departments", response_model=DepartmentRead)
def create_department(
    req: DepartmentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(require_admin),
):
    """Create a new department"""
    existing = db.query(Department).filter(Department.name == req.name).first()
    if existing:
        log_action(
            user=current_user.username, event="DEPT_CREATE_FAILED",
            details=f"reason=duplicate_name, name={req.name}",
            level="WARNING", module="OrgMgmt", request=request
        )
        raise HTTPException(status_code=400, detail=f"Department '{req.name}' มีอยู่แล้ว")

    dept = Department(
        name=req.name, 
        description=req.description,
        max_images_per_flow=req.max_images_per_flow
    )
    db.add(dept)
    db.commit()
    db.refresh(dept)
    
    # Broadcast event for real-time UI updates
    job_events.broadcast("dept_created", {"id": dept.id, "name": dept.name})
    log_action(
        user=current_user.username, event="DEPT_CREATED",
        details=f"name={dept.name}",
        level="INFO", module="OrgMgmt", request=request
    )
    
    return dept


@router.put("/departments/{dept_id}", response_model=DepartmentRead)
def update_department(
    dept_id: int,
    req: DepartmentUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(require_admin),
):
    """Update department"""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # 💡 FIX: เช็คชื่อซ้ำก่อนทำการอัปเดต (ป้องกัน DB Error 500)
    if req.name is not None and req.name != dept.name:
        existing = db.query(Department).filter(Department.name == req.name).first()
        if existing:
            log_action(
                user=current_user.username, event="DEPT_UPDATE_FAILED",
                details=f"id={dept_id}, reason=duplicate_name, name={req.name}",
                level="WARNING", module="OrgMgmt", request=request
            )
            raise HTTPException(status_code=400, detail=f"Department '{req.name}' มีอยู่แล้ว")
        dept.name = req.name
        
    if req.description is not None:
        dept.description = req.description

    if req.max_images_per_flow is not None:
        dept.max_images_per_flow = req.max_images_per_flow
    elif hasattr(req, 'model_fields_set') and 'max_images_per_flow' in req.model_fields_set:
        dept.max_images_per_flow = None
    elif hasattr(req, '__fields_set__') and 'max_images_per_flow' in req.__fields_set__:
        dept.max_images_per_flow = None

    # 💡 FIX: ดักจับ Error ตอน Save ลงฐานข้อมูล เพื่อไม่ให้ Server แครช
    try:
        db.commit()
        db.refresh(dept)
    except Exception as e:
        db.rollback()
        log_action(
            user=current_user.username, event="DEPT_UPDATE_FAILED",
            details=f"id={dept_id}, reason=db_commit_failed, err={type(e).__name__}",
            level="ERROR", module="OrgMgmt", request=request
        )
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")
    
    # Broadcast event for real-time UI updates
    job_events.broadcast("dept_updated", {"id": dept.id, "name": dept.name})
    log_action(
        user=current_user.username, event="DEPT_UPDATED",
        details=f"id={dept.id}, name={dept.name}",
        level="INFO", module="OrgMgmt", request=request
    )
    
    return dept


@router.delete("/departments/{dept_id}")
def delete_department(
    dept_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(require_admin),
):
    """Delete department and all its squads"""
    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    # Get all squads belonging to this department
    squad_ids = [s.id for s in dept.squads]

    from ..models import User
    users_in_dept = db.query(User).filter(User.department_id == dept_id).count()
    users_in_squads = db.query(User).filter(User.squad_id.in_(squad_ids)).count() if squad_ids else 0
    if users_in_dept > 0 or users_in_squads > 0:
        log_action(
            user=current_user.username, event="DEPT_DELETE_FAILED",
            details=f"id={dept_id}, reason=users_assigned, users_in_dept={users_in_dept}, users_in_squads={users_in_squads}",
            level="WARNING", module="OrgMgmt", request=request
        )
        raise HTTPException(status_code=409, detail="Cannot delete the Department because there are users assigned to it.")

    if squad_ids:
        # Get all folders belonging to these squads
        folder_ids = [f.id for f in db.query(FlowFolder.id).filter(FlowFolder.squad_id.in_(squad_ids)).all()]
        
        # Get all flows attached to these squads OR folders
        if folder_ids:
            flows = db.query(Flow).filter( (Flow.squad_id.in_(squad_ids)) | (Flow.folder_id.in_(folder_ids)) ).all()
        else:
            flows = db.query(Flow).filter(Flow.squad_id.in_(squad_ids)).all()
        flow_ids = [f.id for f in flows]
    else:
        flow_ids = []

    # Get all jobs associated with these flows BEFORE deleting them from DB
    from ..models import Job
    if flow_ids:
        jobs = db.query(Job).filter(Job.flow_id.in_(flow_ids)).all()
        job_id_strs = [j.job_id_str for j in jobs]
    else:
        job_id_strs = []

    try:
        db.delete(dept)
        db.commit()
    except IntegrityError:
        db.rollback()
        log_action(
            user=current_user.username, event="DEPT_DELETE_FAILED",
            details=f"id={dept_id}, reason=integrity_error",
            level="ERROR", module="OrgMgmt", request=request
        )
        raise HTTPException(status_code=409, detail="Cannot delete the Department because it is referenced by other records.")

    # Clean up output files
    output_dir = "/app/output"
    refs_deleted = 0
    jobs_deleted = 0
    zips_deleted = 0
    delete_failures = 0
    for fid in flow_ids:
        # 1. Remove references
        ref_dir = os.path.join(output_dir, "references", str(fid))
        if os.path.exists(ref_dir): 
            try:
                shutil.rmtree(ref_dir)
                refs_deleted += 1
            except Exception as e:
                delete_failures += 1
                log_action(
                    user=current_user.username, event="OUTPUT_DELETE_FAILED",
                    details=f"target=ref_dir, path={ref_dir}, err={type(e).__name__}",
                    level="WARNING", module="OrgMgmt", request=request
                )

    # 2. Find jobs related to this flow to delete their folders and zips
    for jid_str in job_id_strs:
        job_dir = os.path.join(output_dir, "jobs", jid_str)
        if os.path.exists(job_dir):
            try:
                shutil.rmtree(job_dir)
                jobs_deleted += 1
            except Exception as e:
                delete_failures += 1
                log_action(
                    user=current_user.username, event="OUTPUT_DELETE_FAILED",
                    details=f"target=job_dir, path={job_dir}, err={type(e).__name__}",
                    level="WARNING", module="OrgMgmt", request=request
                )
            
        for z in glob.glob(f"{output_dir}/zips/*_{jid_str}.zip"):
            try:
                os.remove(z)
                zips_deleted += 1
            except Exception as e:
                delete_failures += 1
                log_action(
                    user=current_user.username, event="OUTPUT_DELETE_FAILED",
                    details=f"target=zip, path={z}, err={type(e).__name__}",
                    level="WARNING", module="OrgMgmt", request=request
                )

    # Broadcast event for real-time UI updates
    job_events.broadcast("dept_deleted", {"id": dept_id})
    log_action(
        user=current_user.username, event="DEPT_DELETED",
        details=f"name={dept.name}, flows_deleted={len(flow_ids)}, jobs_deleted={len(job_id_strs)}",
        level="WARNING", module="OrgMgmt", request=request
    )
    log_action(
        user=current_user.username, event="OUTPUT_FILES_DELETED",
        details=f"scope=department, dept_id={dept_id}, refs_deleted={refs_deleted}, jobs_deleted={jobs_deleted}, zips_deleted={zips_deleted}, failures={delete_failures}",
        level="INFO" if delete_failures == 0 else "WARNING", module="OrgMgmt", request=request
    )

    return {"message": f"Department '{dept.name}' deleted and linked files cleaned"}


# =============================================
# Squad CRUD
# =============================================
@router.get("/squads", response_model=List[SquadRead])
def list_squads(
    department_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """List squads, optionally filtered by department"""
    query = db.query(Squad)
    if department_id:
        query = query.filter(Squad.department_id == department_id)
        
    if current_user.role != "ADMIN" or current_user.custom_role_id:
        allowed_depts = []
        if current_user.department_id:
            allowed_depts.append(current_user.department_id)
        if current_user.support_roles:
            allowed_depts.extend([sr.department_id for sr in current_user.support_roles])
        if not allowed_depts:
            return []
        query = query.filter(Squad.department_id.in_(allowed_depts))
        
    squads = query.all()
    squads.sort(key=lambda s: s.name.lower())
    return squads


@router.post("/squads", response_model=SquadRead)
def create_squad(
    req: SquadCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Create a new squad"""
    if not check_dept_access(current_user, req.department_id):
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์สร้าง Squad ใน Department นี้")

    dept = db.query(Department).filter(Department.id == req.department_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    squad = Squad(name=req.name, department_id=req.department_id, description=req.description)
    db.add(squad)
    db.commit()
    db.refresh(squad)

    # Broadcast event for real-time UI updates
    job_events.broadcast("squad_created", {"id": squad.id, "name": squad.name, "department_id": squad.department_id})
    log_action(
        user=current_user.username, event="SQUAD_CREATED",
        details=f"name={squad.name}, dept_id={squad.department_id}",
        level="INFO", module="OrgMgmt", request=request
    )

    return squad


@router.put("/squads/{squad_id}", response_model=SquadRead)
def update_squad(
    squad_id: int,
    req: SquadUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Update squad"""
    squad = db.query(Squad).filter(Squad.id == squad_id).first()
    if not squad:
        raise HTTPException(status_code=404, detail="Squad not found")

    if not check_dept_access(current_user, squad.department_id):
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์แก้ไข Squad ใน Department นี้")

    # 💡 FIX: เช็คชื่อซ้ำใน Department เดียวกัน
    if req.name is not None and req.name != squad.name:
        existing = db.query(Squad).filter(Squad.name == req.name, Squad.department_id == squad.department_id).first()
        if existing:
            log_action(
                user=current_user.username, event="SQUAD_UPDATE_FAILED",
                details=f"id={squad_id}, reason=duplicate_name, name={req.name}",
                level="WARNING", module="OrgMgmt", request=request
            )
            raise HTTPException(status_code=400, detail=f"Squad '{req.name}' มีอยู่แล้วใน Department นี้")
        squad.name = req.name
        
    if req.description is not None:
        squad.description = req.description

    # 💡 FIX: ดักจับ Error ตอน Save ลงฐานข้อมูล
    try:
        db.commit()
        db.refresh(squad)
    except Exception as e:
        db.rollback()
        log_action(
            user=current_user.username, event="SQUAD_UPDATE_FAILED",
            details=f"id={squad_id}, reason=db_commit_failed, err={type(e).__name__}",
            level="ERROR", module="OrgMgmt", request=request
        )
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")
    
    # Broadcast event for real-time UI updates
    job_events.broadcast("squad_updated", {"id": squad.id, "name": squad.name, "department_id": squad.department_id})
    log_action(
        user=current_user.username, event="SQUAD_UPDATED",
        details=f"id={squad.id}, name={squad.name}",
        level="INFO", module="OrgMgmt", request=request
    )
    
    return squad


@router.delete("/squads/{squad_id}")
def delete_squad(
    squad_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Delete squad"""
    squad = db.query(Squad).filter(Squad.id == squad_id).first()
    if not squad:
        raise HTTPException(status_code=404, detail="Squad not found")

    if not check_dept_access(current_user, squad.department_id):
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ลบ Squad ใน Department นี้")

    from ..models import User
    users_in_squad = db.query(User).filter(User.squad_id == squad_id).count()
    if users_in_squad > 0:
        log_action(
            user=current_user.username, event="SQUAD_DELETE_FAILED",
            details=f"id={squad_id}, reason=users_assigned, users_in_squad={users_in_squad}",
            level="WARNING", module="OrgMgmt", request=request
        )
        raise HTTPException(status_code=409, detail="ไม่สามารถลบ Squad ได้ เนื่องจากยังมีผู้ใช้งานผูกอยู่")

    # Get all folders belonging to this squad
    folder_ids = [f.id for f in db.query(FlowFolder.id).filter(FlowFolder.squad_id == squad_id).all()]
    
    # Get all flows attached to this squad OR its folders
    if folder_ids:
        flows = db.query(Flow).filter( (Flow.squad_id == squad_id) | (Flow.folder_id.in_(folder_ids)) ).all()
    else:
        flows = db.query(Flow).filter(Flow.squad_id == squad_id).all()
        
    flow_ids = [f.id for f in flows]

    # Get all jobs BEFORE deleting
    from ..models import Job
    if flow_ids:
        jobs = db.query(Job).filter(Job.flow_id.in_(flow_ids)).all()
        job_id_strs = [j.job_id_str for j in jobs]
    else:
        job_id_strs = []

    dept_id = squad.department_id

    try:
        db.delete(squad)
        db.commit()
    except IntegrityError:
        db.rollback()
        log_action(
            user=current_user.username, event="SQUAD_DELETE_FAILED",
            details=f"id={squad_id}, reason=integrity_error",
            level="ERROR", module="OrgMgmt", request=request
        )
        raise HTTPException(status_code=409, detail="ไม่สามารถลบ Squad ได้ เนื่องจากมีข้อมูลอื่นอ้างอิงอยู่")

    # Clean up output files
    output_dir = "/app/output"
    refs_deleted = 0
    jobs_deleted = 0
    zips_deleted = 0
    delete_failures = 0
    for fid in flow_ids:
        ref_dir = os.path.join(output_dir, "references", str(fid))
        if os.path.exists(ref_dir): 
            try:
                shutil.rmtree(ref_dir)
                refs_deleted += 1
            except Exception as e:
                delete_failures += 1
                log_action(
                    user=current_user.username, event="OUTPUT_DELETE_FAILED",
                    details=f"target=ref_dir, path={ref_dir}, err={type(e).__name__}",
                    level="WARNING", module="OrgMgmt", request=request
                )

    for jid_str in job_id_strs:
        job_dir = os.path.join(output_dir, "jobs", jid_str)
        if os.path.exists(job_dir):
            try:
                shutil.rmtree(job_dir)
                jobs_deleted += 1
            except Exception as e:
                delete_failures += 1
                log_action(
                    user=current_user.username, event="OUTPUT_DELETE_FAILED",
                    details=f"target=job_dir, path={job_dir}, err={type(e).__name__}",
                    level="WARNING", module="OrgMgmt", request=request
                )
            
        for z in glob.glob(f"{output_dir}/zips/*_{jid_str}.zip"):
            try:
                os.remove(z)
                zips_deleted += 1
            except Exception as e:
                delete_failures += 1
                log_action(
                    user=current_user.username, event="OUTPUT_DELETE_FAILED",
                    details=f"target=zip, path={z}, err={type(e).__name__}",
                    level="WARNING", module="OrgMgmt", request=request
                )

    # Broadcast event for real-time UI updates
    job_events.broadcast("squad_deleted", {"id": squad_id, "department_id": dept_id})
    log_action(
        user=current_user.username, event="SQUAD_DELETED",
        details=f"name={squad.name}, flows_deleted={len(flow_ids)}, jobs_deleted={len(job_id_strs)}",
        level="WARNING", module="OrgMgmt", request=request
    )
    log_action(
        user=current_user.username, event="OUTPUT_FILES_DELETED",
        details=f"scope=squad, squad_id={squad_id}, refs_deleted={refs_deleted}, jobs_deleted={jobs_deleted}, zips_deleted={zips_deleted}, failures={delete_failures}",
        level="INFO" if delete_failures == 0 else "WARNING", module="OrgMgmt", request=request
    )

    return {"message": f"Squad '{squad.name}' deleted and linked files cleaned"}

