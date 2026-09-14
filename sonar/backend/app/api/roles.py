from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from ..database import get_db
from ..models import CustomRole, RoleMenuPermission, User
from ..core.deps import require_admin, require_permission
from ..events import job_events
from ..core.audit_logger import log_action

router = APIRouter(prefix="/roles", tags=["Roles"])

# --- Schemas ---
class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    menu_permissions: List[str] = []

class RoleRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    menu_permissions: List[str] = []

    class Config:
        from_attributes = True

# --- Endpoints ---
@router.get("/public", response_model=List[RoleRead])
def get_public_roles(db: Session = Depends(get_db)):
    roles = db.query(CustomRole).order_by(CustomRole.id.asc()).all()
    result = []
    for role in roles:
        permissions = [p.menu_key for p in role.menu_permissions]
        result.append(RoleRead(
            id=role.id,
            name=role.name,
            description=role.description,
            menu_permissions=permissions
        ))
    return result

@router.get("", response_model=List[RoleRead])
def get_roles(db: Session = Depends(get_db), current_user: User = Depends(require_permission(["manage-roles", "manage-users"]))):
    roles = db.query(CustomRole).order_by(CustomRole.id.asc()).all()
    result = []
    for role in roles:
        permissions = [p.menu_key for p in role.menu_permissions]
        result.append(RoleRead(
            id=role.id,
            name=role.name,
            description=role.description,
            menu_permissions=permissions
        ))
    return result

@router.post("", response_model=RoleRead)
def create_role(req: RoleCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("manage-roles"))):
    if db.query(CustomRole).filter(CustomRole.name == req.name).first():
        raise HTTPException(status_code=400, detail="Role name already exists")
    
    new_role = CustomRole(
        name=req.name,
        description=req.description
    )
    db.add(new_role)
    db.commit()
    db.refresh(new_role)
    
    for perm in req.menu_permissions:
        db.add(RoleMenuPermission(role_id=new_role.id, menu_key=perm))
    db.commit()
    
    log_action(
        user=current_user.username, event="ROLE_CREATED",
        details=f"role_name={req.name}", level="INFO", module="RoleMgmt", request=request
    )
    job_events.broadcast("role_created", {"role_id": new_role.id})
    
    return RoleRead(
        id=new_role.id,
        name=new_role.name,
        description=new_role.description,
        menu_permissions=req.menu_permissions
    )

@router.put("/{role_id}", response_model=RoleRead)
def update_role(role_id: int, req: RoleCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("manage-roles"))):
    role = db.query(CustomRole).filter(CustomRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
        
    existing_name = db.query(CustomRole).filter(CustomRole.name == req.name, CustomRole.id != role_id).first()
    if existing_name:
        raise HTTPException(status_code=400, detail="Role name already exists")
        
    role.name = req.name
    role.description = req.description
    
    db.query(RoleMenuPermission).filter(RoleMenuPermission.role_id == role_id).delete()
    for perm in req.menu_permissions:
        db.add(RoleMenuPermission(role_id=role_id, menu_key=perm))
        
    db.commit()
    
    log_action(
        user=current_user.username, event="ROLE_UPDATED",
        details=f"role_name={req.name}", level="INFO", module="RoleMgmt", request=request
    )
    job_events.broadcast("role_updated", {"role_id": role_id})
    
    return RoleRead(
        id=role.id,
        name=role.name,
        description=role.description,
        menu_permissions=req.menu_permissions
    )

@router.delete("/{role_id}")
def delete_role(role_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("manage-roles"))):
    role = db.query(CustomRole).filter(CustomRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
        
    if db.query(User).filter(User.custom_role_id == role_id).first():
        raise HTTPException(status_code=400, detail="Cannot delete role because it is assigned to one or more users")
        
    role_name = role.name
    db.delete(role)
    db.commit()
    
    log_action(
        user=current_user.username, event="ROLE_DELETED",
        details=f"role_name={role_name}", level="WARNING", module="RoleMgmt", request=request
    )
    job_events.broadcast("role_deleted", {"role_id": role_id})
    
    return {"message": "Role deleted successfully"}
