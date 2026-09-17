import string
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Annotated
from datetime import datetime, timezone

from ..database import get_db
from ..models import User, CustomRole, UserSupportRole
from ..core.security import hash_password
from ..core.deps import require_admin, get_current_user, require_permission
from .auth import UserRead
from ..core.audit_logger import log_action
from ..events import job_events
from sqlalchemy.orm import joinedload

USER_NOT_FOUND = "User not found"
SUPER_ADMIN_ONLY = "Only Super Admins can modify Admin users"

router = APIRouter(prefix="/users", tags=["Users"])

class UserCreate(BaseModel):
    username: str
    role: str = "USER"
    department_id: Optional[int] = None
    squad_id: Optional[int] = None
    position: Optional[str] = None
    custom_role_id: Optional[int] = None
    support_roles: List[dict] = []
    expire_date: Optional[datetime] = None

class UserCreateResponse(BaseModel):
    user: UserRead
    generated_password: str

class UserStatusUpdate(BaseModel):
    status: str  # ACTIVE, PENDING, SUSPENDED

class UserRoleUpdate(BaseModel):
    role: str  # ADMIN, USER
    admin_password: str

class UserOrgUpdate(BaseModel):
    department_id: Optional[int] = None
    squad_id: Optional[int] = None
    position: Optional[str] = None
    custom_role_id: Optional[int] = None
    support_roles: Optional[List[dict]] = None

class UserExpireUpdate(BaseModel):
    expire_date: Optional[datetime] = None

def generate_random_password(length=10):
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(secrets.choice(chars) for _ in range(length))

def _format_support_role(sr):
    dept_name = sr.department.name if sr.department else None
    squad_name = sr.squad.name if sr.squad else None
    role_name = sr.custom_role.name if sr.custom_role else None
    return {
        "id": sr.id,
        "department_id": sr.department_id,
        "department_name": dept_name,
        "squad_id": sr.squad_id,
        "squad_name": squad_name,
        "custom_role_id": sr.custom_role_id,
        "custom_role_name": role_name
    }

def _serialize_user_read(u):
    dept_name = u.department.name if u.department else None
    squad_name = u.squad.name if u.squad else None
    role_name = u.custom_role.name if u.custom_role else None
    menu_perms = [p.menu_key for p in u.custom_role.menu_permissions] if u.custom_role else []
    support_roles = [_format_support_role(sr) for sr in getattr(u, 'support_roles', [])]
    expire_date = u.expire_date.isoformat() if u.expire_date else None
    last_login = u.last_login.isoformat() if u.last_login else None

    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "status": u.status,
        "must_change_password": u.must_change_password,
        "department_id": u.department_id,
        "squad_id": u.squad_id,
        "position": u.position,
        "department_name": dept_name,
        "squad_name": squad_name,
        "custom_role_id": u.custom_role_id,
        "custom_role_name": role_name,
        "menu_permissions": menu_perms,
        "support_roles": support_roles,
        "expire_date": expire_date,
        "last_login": last_login
    }

@router.get("", response_model=List[UserRead])
def list_users(db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(require_permission("manage-users"))]):
    users = db.query(User).options(
        joinedload(User.department),
        joinedload(User.squad),
        joinedload(User.custom_role),
        joinedload(User.support_roles).joinedload(UserSupportRole.department),
        joinedload(User.support_roles).joinedload(UserSupportRole.custom_role),
        joinedload(User.support_roles).joinedload(UserSupportRole.squad)
    ).order_by(User.id.asc()).all()
    return [_serialize_user_read(u) for u in users]

@router.post("", response_model=UserCreateResponse)
def create_user(req: UserCreate, request: Request, db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(require_permission("manage-users"))]):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username is already taken")  # NOSONAR
        
    if req.role == "ADMIN" and current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Only Super Admins can create Admin users")  # NOSONAR
        
    if req.expire_date and req.expire_date.replace(tzinfo=None) < datetime.now(timezone.utc).replace(tzinfo=None).replace(hour=0, minute=0, second=0, microsecond=0):
        raise HTTPException(status_code=400, detail="Expire date cannot be in the past")  # NOSONAR
    
    # Default to QA role if none provided
    custom_role_id = req.custom_role_id
    if not custom_role_id:
        qa_role = db.query(CustomRole).filter(CustomRole.name.ilike("QA")).first()
        if qa_role:
            custom_role_id = qa_role.id

    gen_pass = generate_random_password()
    new_user = User(
        username=req.username,
        hashed_password=hash_password(gen_pass),
        role=req.role,
        status="ACTIVE",
        must_change_password=True,
        is_active=1,
        department_id=req.department_id,
        squad_id=req.squad_id,
        position=req.position,
        custom_role_id=custom_role_id,
        expire_date=req.expire_date
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    if req.support_roles:
        for sr in req.support_roles:
            new_sr = UserSupportRole(
                user_id=new_user.id,
                department_id=sr["department_id"],
                custom_role_id=sr.get("custom_role_id"),
                squad_id=sr.get("squad_id")
            )
            db.add(new_sr)
        db.commit()
    
    log_action(
        user=current_user.username, event="USER_CREATED",
        details=f"username={req.username}, role={req.role}, dept={req.department_id}",
        level="INFO", module="UserMgmt", request=request
    )
    
    # แจ้งเตือนว่ามีการสร้าง User ให้ UI Refresh
    job_events.broadcast("user_created", {"user_id": new_user.id})
    return UserCreateResponse(
        user=UserRead(**_serialize_user_read(new_user)),
        generated_password=gen_pass
    )

@router.put("/{user_id}/expire")
def update_user_expire(user_id: int, req: UserExpireUpdate, request: Request, db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(require_permission("manage-users"))]):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)  # NOSONAR
        
    if user.role == "ADMIN" and current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail=SUPER_ADMIN_ONLY)  # NOSONAR
        
    if req.expire_date and req.expire_date.replace(tzinfo=None) < datetime.now(timezone.utc).replace(tzinfo=None).replace(hour=0, minute=0, second=0, microsecond=0):
        raise HTTPException(status_code=400, detail="Expire date cannot be in the past")  # NOSONAR
        
    user.expire_date = req.expire_date
    db.commit()
    
    log_action(
        user=current_user.username, event="USER_EXPIRE_UPDATED",
        details=f"target_user={user.username}, new_expire={req.expire_date}",
        level="INFO", module="UserMgmt", request=request
    )
    job_events.broadcast("user_updated", {"user_id": user.id})
    return {"message": "Expire date updated successfully"}

def _validate_role_assignment(current_user, user, user_id):
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")  # NOSONAR
    is_admin = current_user.role == "ADMIN"
    is_tm = bool(current_user.custom_role and current_user.custom_role.name.upper() == "TM")
    if not (is_admin or is_tm):
        raise HTTPException(status_code=403, detail="Only Admins and Test Managers can change user roles")  # NOSONAR
    if user.role == "ADMIN" and not is_admin:
        raise HTTPException(status_code=403, detail="Cannot change role of Admin users")  # NOSONAR

def _update_support_roles(db, user_id, support_roles):
    db.query(UserSupportRole).filter(UserSupportRole.user_id == user_id).delete()
    if support_roles:
        for sr in support_roles:
            db.add(UserSupportRole(
                user_id=user_id,
                department_id=sr["department_id"],
                custom_role_id=sr.get("custom_role_id"),
                squad_id=sr.get("squad_id")
            ))

@router.put("/{user_id}")
def update_user_org(user_id: int, req: UserOrgUpdate, request: Request, db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(require_permission("manage-users"))]):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)  # NOSONAR
        
    if user.role == "ADMIN" and current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail=SUPER_ADMIN_ONLY)  # NOSONAR
        
    update_data = req.dict(exclude_unset=True) if hasattr(req, "dict") else req.model_dump(exclude_unset=True)
    
    if "department_id" in update_data:
        user.department_id = update_data["department_id"]
    if "squad_id" in update_data:
        user.squad_id = update_data["squad_id"]
    if "position" in update_data:
        user.position = update_data["position"]
    if "custom_role_id" in update_data:
        _validate_role_assignment(current_user, user, user_id)
        user.custom_role_id = update_data["custom_role_id"]
        
    if "support_roles" in update_data:
        _update_support_roles(db, user.id, update_data["support_roles"])
        
    db.commit()
    db.refresh(user)
    
    log_action(
        user=current_user.username, event="USER_ORG_UPDATED",
        details=f"target_user={user.username}, dept={user.department_id}, squad={user.squad_id}",
        level="INFO", module="UserMgmt", request=request
    )
    
    # แจ้งเตือนว่ามีการเปลี่ยน Organization
    job_events.broadcast("user_org_updated", {"user_id": user_id})
    job_events.broadcast("user_access_updated", {"user_id": user_id})
    
    return user

@router.put("/{user_id}/status")
def update_user_status(user_id: int, req: UserStatusUpdate, request: Request, db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(require_permission("manage-users"))]):
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own status")  # NOSONAR
        
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)  # NOSONAR
        
    if user.role == "ADMIN" and current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail=SUPER_ADMIN_ONLY)  # NOSONAR
        
    if req.status not in ["ACTIVE", "PENDING", "SUSPENDED"]:
        raise HTTPException(status_code=400, detail="Invalid status")  # NOSONAR
    
    old_status = user.status
    generated_password = None
    
    if old_status == "PENDING" and req.status == "ACTIVE":
        generated_password = generate_random_password()
        user.hashed_password = hash_password(generated_password)
        user.must_change_password = True
        
    user.status = req.status
    if req.status == "SUSPENDED":
        user.is_active = 0
    elif req.status == "ACTIVE":
        user.is_active = 1
        
    db.commit()
    db.refresh(user)
    
    log_action(
        user=current_user.username, event="USER_STATUS_CHANGED",
        details=f"target_user={user.username}, {old_status}→{req.status}",
        level="INFO", module="UserMgmt", request=request
    )
    
    if req.status == "ACTIVE" and old_status == "PENDING":
        job_events.broadcast("user_approved", {"user_id": user_id})
        
    # 💡 1. แจ้งเตือนให้ทุกหน้าจอ Refresh ตาราง 
    job_events.broadcast("user_status_changed", {"user_id": user_id, "status": req.status})
    
    # 💡 2. ถ้าปรับสถานะเป็น "SUSPENDED" (ถูกระงับ) ให้ส่งสัญญาณเตะออกจากระบบทันที!
    if req.status == "SUSPENDED":
        job_events.broadcast("force_logout", {"user_id": user_id, "reason": "account_suspended"})
    
    result = {
        "id": user.id, "username": user.username, "role": user.role, "status": user.status,
        "must_change_password": user.must_change_password,
        "department_id": user.department_id, "squad_id": user.squad_id, "position": user.position,
        "department_name": user.department.name if user.department else None,
        "squad_name": user.squad.name if user.squad else None,
    }
    
    if generated_password:
        result["generated_password"] = generated_password
    
    return result

@router.put("/{user_id}/role", response_model=UserRead)
def update_user_role(user_id: int, req: UserRoleUpdate, request: Request, db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(require_permission("manage-users"))]):
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Only Admins can change user roles")  # NOSONAR
        
    from ..core.security import verify_password
    if not verify_password(req.admin_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid Admin password")  # NOSONAR
        
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")  # NOSONAR
        
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)  # NOSONAR
        
    if user.role == "ADMIN" and current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail=SUPER_ADMIN_ONLY)  # NOSONAR
        
    if req.role not in ["ADMIN", "USER"]:
        raise HTTPException(status_code=400, detail="Invalid role")  # NOSONAR
        
    user.role = req.role
    db.commit()
    db.refresh(user)
    log_action(
        user=current_user.username, event="USER_ROLE_CHANGED",
        details=f"target_user={user.username}, role={req.role}",
        level="INFO", module="UserMgmt", request=request
    )
    
    # แจ้งเตือนว่ามีการเปลี่ยน Role
    job_events.broadcast("user_role_changed", {"user_id": user_id, "role": req.role})
    return _serialize_user_read(user)

@router.post("/{user_id}/reset-password")
def reset_user_password(user_id: int, request: Request, db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(require_permission("manage-users"))]):
    """Admin resets user password. Returns new generated password."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)  # NOSONAR
        
    if user.role == "ADMIN" and current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail=SUPER_ADMIN_ONLY)  # NOSONAR
        
    gen_pass = generate_random_password()
    user.hashed_password = hash_password(gen_pass)
    user.must_change_password = True
    db.commit()
    
    log_action(
        user=current_user.username, event="PWD_RESET",
        details=f"target_user={user.username}",
        level="INFO", module="UserMgmt", request=request
    )
    
    # Don't kick out the admin immediately if they are resetting their own password
    if user_id != current_user.id:
        job_events.broadcast("force_logout", {"user_id": user_id, "reason": "password_reset"})
        
    job_events.broadcast("user_password_changed", {"user_id": user_id})
    
    return {"message": "Password reset successful", "generated_password": gen_pass}

@router.get("/pending-count")
def get_pending_count(db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(get_current_user)]):
    count = db.query(User).filter(User.status == "PENDING").count()
    return {"count": count}

class DeleteUserRequest(BaseModel):
    admin_password: str

@router.post("/{user_id}/delete")
def delete_user(user_id: int, req: DeleteUserRequest, request: Request, db: Annotated[Session, Depends(get_db)], current_user: Annotated[User, Depends(require_permission("manage-users"))]):
    from ..core.security import verify_password
    if not verify_password(req.admin_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid Admin password")  # NOSONAR

    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")  # NOSONAR

    user_to_delete = db.query(User).filter(User.id == user_id).first()
    if not user_to_delete:
        raise HTTPException(status_code=404, detail=USER_NOT_FOUND)  # NOSONAR
        
    if user_to_delete.role == "ADMIN" and current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Only Super Admins can delete Admin users")  # NOSONAR

    username = user_to_delete.username
    
    # Clean up related records to prevent ForeignKey constraint errors
    from ..models import UserSession, LoginChallenge, ApiKey
    db.query(UserSession).filter(UserSession.user_id == user_id).delete()
    db.query(LoginChallenge).filter(LoginChallenge.user_id == user_id).delete()
    db.query(ApiKey).filter(ApiKey.user_id == user_id).delete()
    
    db.delete(user_to_delete)
    db.commit()
    
    log_action(
        user=current_user.username, event="USER_DELETED",
        details=f"target_user={username}",
        level="WARNING", module="UserMgmt", request=request
    )
    
    # 💡 แจ้งเตือนตาราง Refresh และบังคับเตะออกจากระบบถ้าคนนั้นออนไลน์อยู่
    job_events.broadcast("user_deleted", {"user_id": user_id})
    job_events.broadcast("force_logout", {"user_id": user_id, "reason": "account_deleted"})
    
    return {"message": "User deleted successfully"}