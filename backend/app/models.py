from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship, backref
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timezone

def get_utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)
from .database import Base


# =============================================
# Organization Models (Phase 1.5)
# =============================================
class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_utcnow)
    max_images_per_flow = Column(Integer, nullable=True)

    squads = relationship("Squad", back_populates="department", cascade="all, delete-orphan", order_by="Squad.name")


class Squad(Base):
    __tablename__ = "squads"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_utcnow)

    department = relationship("Department", back_populates="squads")
    folders = relationship("FlowFolder", back_populates="squad", cascade="all, delete-orphan")
    flows = relationship("Flow", back_populates="squad", cascade="all, delete-orphan")


# --- Flow Management Models ---
class FlowFolder(Base):
    __tablename__ = "flow_folders"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    parent_id = Column(Integer, ForeignKey("flow_folders.id"), nullable=True)
    squad_id = Column(Integer, ForeignKey("squads.id"), nullable=True)

    squad = relationship("Squad", back_populates="folders")
    children = relationship("FlowFolder", backref=backref('parent', remote_side=[id]), cascade="all, delete-orphan")
    flows = relationship("Flow", back_populates="folder", cascade="all, delete-orphan")

class Flow(Base):
    __tablename__ = "flows"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    folder_id = Column(Integer, ForeignKey("flow_folders.id"), nullable=True)
    squad_id = Column(Integer, ForeignKey("squads.id"), nullable=True)
    sort_order = Column(Integer, default=0)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_utcnow)
    
    folder = relationship("FlowFolder", back_populates="flows")
    squad = relationship("Squad", back_populates="flows")
    pages = relationship("Page", back_populates="flow", cascade="all, delete-orphan")
    masks = relationship("Mask", back_populates="flow", cascade="all, delete-orphan", foreign_keys="[Mask.flow_id]")
    jobs = relationship("Job", back_populates="flow", cascade="all, delete-orphan")

class Page(Base):
    __tablename__ = "pages"
    id = Column(Integer, primary_key=True, index=True)
    flow_id = Column(Integer, ForeignKey("flows.id"))
    page_name = Column(String, index=True)
    image_path = Column(String)
    step_order = Column(Integer, default=0)
    sort_order = Column(Integer, default=0)
    
    flow = relationship("Flow", back_populates="pages")
    masks = relationship("Mask", back_populates="page", cascade="all, delete-orphan")

class Mask(Base):
    __tablename__ = "masks"
    id = Column(Integer, primary_key=True, index=True)
    flow_id = Column(Integer, ForeignKey("flows.id"), nullable=True)
    page_id = Column(Integer, ForeignKey("pages.id"), nullable=True)
    type = Column(String)
    x = Column(Integer)
    y = Column(Integer)
    width = Column(Integer)
    height = Column(Integer)
    
    page = relationship("Page", back_populates="masks")
    flow = relationship("Flow", back_populates="masks", foreign_keys=[flow_id])

class Job(Base):
    __tablename__ = "jobs"
    id = Column(Integer, primary_key=True, index=True)
    job_id_str = Column(String, unique=True, index=True, nullable=False) # e.g. "20260220235020"
    flow_id = Column(Integer, ForeignKey("flows.id"))
    status = Column(String, default="QUEUED") # QUEUED -> PROCESSING -> COMPLETED / FAILED
    results_path = Column(String, nullable=True) # เก็บ path ไปยัง report.json (ถ้ามี)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_utcnow)
    completed_at = Column(DateTime, nullable=True)
    
    flow = relationship("Flow", back_populates="jobs")


# =============================================
# Auth & Audit Models (Phase 1.4 & Role Mgmt)
# =============================================
class CustomRole(Base):
    __tablename__ = "custom_roles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_utcnow)

    menu_permissions = relationship("RoleMenuPermission", back_populates="role", cascade="all, delete-orphan")
    users = relationship("User", back_populates="custom_role")


class RoleMenuPermission(Base):
    __tablename__ = "role_menu_permissions"
    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("custom_roles.id"), nullable=False)
    menu_key = Column(String, nullable=False)  # e.g., 'dashboard', 'run', 'manage-users'

    role = relationship("CustomRole", back_populates="menu_permissions")


class UserSupportRole(Base):
    __tablename__ = "user_support_roles"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=False)
    custom_role_id = Column(Integer, ForeignKey("custom_roles.id", ondelete="SET NULL"), nullable=True)
    squad_id = Column(Integer, ForeignKey("squads.id", ondelete="SET NULL"), nullable=True)

    department = relationship("Department")
    custom_role = relationship("CustomRole")
    squad = relationship("Squad")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="USER")  # System privilege: ADMIN or USER
    custom_role_id = Column(Integer, ForeignKey("custom_roles.id"), nullable=True) # User's custom job role
    is_active = Column(Integer, default=1)  # Legacy: 1=active, 0=disabled (keep for compatibility if needed)
    status = Column(String, default="ACTIVE")  # PENDING, ACTIVE, SUSPENDED
    must_change_password = Column(Boolean, default=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True) # Primary Department
    squad_id = Column(Integer, ForeignKey("squads.id"), nullable=True)
    position = Column(String, nullable=True)  # Job position e.g. QA, DEV, BA
    expire_date = Column(DateTime, nullable=True)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=get_utcnow)

    department = relationship("Department")
    squad = relationship("Squad")
    custom_role = relationship("CustomRole", back_populates="users")
    support_roles = relationship("UserSupportRole", backref="user", cascade="all, delete-orphan")
    api_keys = relationship("ApiKey", back_populates="user", cascade="all, delete-orphan")


class ApiKey(Base):
    __tablename__ = "api_keys"
    id = Column(Integer, primary_key=True, index=True)
    key_hash = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)  # e.g. "Jenkins Production"
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=get_utcnow)

    user = relationship("User", back_populates="api_keys")


class SystemConfig(Base):
    __tablename__ = "system_configs"
    key = Column(String, primary_key=True, index=True) # e.g. "max_image_size_mb"
    value = Column(String, nullable=False)             # e.g. "5"
    description = Column(String, nullable=True)
    updated_at = Column(DateTime, default=get_utcnow, onupdate=get_utcnow)

# =============================================
# Session Models (Single Login)
# =============================================
class UserSession(Base):
    __tablename__ = "user_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    jti = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, default="ACTIVE", index=True)
    ip = Column(String, nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_utcnow)
    last_seen = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User")


class LoginChallenge(Base):
    __tablename__ = "login_challenges"
    challenge_id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    status = Column(String, default="PENDING", index=True)
    requested_ip = Column(String, nullable=True)
    requested_user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_utcnow)
    resolved_at = Column(DateTime, nullable=True)

    user = relationship("User")

# =============================================
# Audit Log Models (Phase 6)
# =============================================
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=get_utcnow, index=True)
    user_id = Column(String, index=True, nullable=True) # Can be 'SYSTEM' or numeric ID string
    username = Column(String, index=True, nullable=True)
    action = Column(String, index=True, nullable=False)
    method = Column(String, nullable=True) # GET, POST, PUT, DELETE
    endpoint = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String, nullable=True)
    session_id = Column(String, nullable=True)
    prev_hash = Column(String, nullable=True)
    log_hash = Column(String, nullable=True)


# --- Pydantic Schemas ---
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime as dt
class MaskSchema(BaseModel):
    id: Optional[int] = None
    type: str
    x: int
    y: int
    width: int
    height: int
    page_id: Optional[int] = None
    class Config: from_attributes = True

class MaskUpdateRequest(BaseModel):
    x: int
    y: int
    width: int
    height: int

class PageCreate(BaseModel):
    page_name: str
    flow_id: int 

class PageRead(BaseModel):
    id: int
    page_name: str
    image_path: str
    step_order: int
    sort_order: int = 0
    masks: List[MaskSchema] = []
    class Config: from_attributes = True

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    squad_id: Optional[int] = None

class FolderRead(BaseModel):
    id: int
    name: str
    parent_id: Optional[int] = None
    squad_id: Optional[int] = None
    class Config: from_attributes = True

class FlowCreate(BaseModel):
    name: str
    folder_id: Optional[int] = None
    squad_id: Optional[int] = None

class FlowRead(BaseModel):
    id: int
    name: str
    folder_id: Optional[int] = None
    sort_order: int = 0
    note: Optional[str] = None
    page_count: int = 0
    pages: List[PageRead] = []
    class Config: from_attributes = True

class MaskCreateRequest(BaseModel):
    flow_id: int
    page_id: Optional[int] = None
    type: str 
    x: int
    y: int
    width: int
    height: int

class JobRead(BaseModel):
    id: int
    flow_id: int
    status: str
    created_at: dt
    flow_name: Optional[str] = None
    class Config: from_attributes = True

class SystemConfigUpdate(BaseModel):
    value: str

class SystemConfigRead(BaseModel):
    key: str
    value: str
    description: Optional[str] = None
    updated_at: dt
    class Config: from_attributes = True
