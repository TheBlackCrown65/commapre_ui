"""
Auth API Endpoints
==================
Login (JWT) + API Key management + Logout
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from starlette.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone

from ..database import get_db
from ..models import User, ApiKey, UserSession, LoginChallenge
from ..core.security import verify_password, create_access_token, generate_api_key, hash_api_key, decode_access_token
from ..core.deps import get_current_user, require_admin
from ..core.audit_logger import log_action
from ..core.rate_limiter import login_rate_limiter
from ..core.config import settings
from ..events import job_events
from uuid import uuid4

def authenticate_ldap(username, password):
    if not settings.LDAP_SERVER_URL:
        return False
    try:
        from ldap3 import Server, Connection, ALL
        server = Server(settings.LDAP_SERVER_URL, get_info=ALL, connect_timeout=5)
        user_principal = f"{username}@{settings.LDAP_USER_DOMAIN}" if settings.LDAP_USER_DOMAIN else username
        conn = Connection(server, user=user_principal, password=password, auto_bind=True)
        return True
    except Exception as e:
        print(f"LDAP Auth Failed: {e}")
        return False

router = APIRouter(prefix="/auth", tags=["Auth"])


# --- Pydantic Schemas ---
class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class RegisterRequest(BaseModel):
    username: str
    department_id: Optional[int] = None
    squad_id: Optional[int] = None
    position: Optional[str] = None
    custom_role_id: Optional[int] = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ApiKeyCreateRequest(BaseModel):
    name: str  # e.g. "Jenkins Production"


class ApiKeyCreateResponse(BaseModel):
    id: int
    name: str
    api_key: str  # ⚠️ แสดงครั้งเดียวเท่านั้น!
    message: str = "Store this API Key safely - it will only be shown once!"


class ApiKeyRead(BaseModel):
    id: int
    name: str
    is_active: bool
    created_at: datetime
    class Config:
        from_attributes = True


class UserRead(BaseModel):
    id: int
    username: str
    role: str
    status: str
    must_change_password: bool
    department_id: Optional[int] = None
    squad_id: Optional[int] = None
    position: Optional[str] = None
    department_name: Optional[str] = None
    squad_name: Optional[str] = None
    custom_role_id: Optional[int] = None
    custom_role_name: Optional[str] = None
    menu_permissions: List[str] = []
    support_roles: List[dict] = []
    expire_date: Optional[datetime] = None
    last_login: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class LoginChallengeDecisionRequest(BaseModel):
    decision: str


# --- Auth Endpoints ---

@router.post("/register")
def register(req: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    """Self-register a new user. Status will be PENDING. Password is auto-generated."""
    if db.query(User).filter(User.username == req.username).first():
        log_action(
            user=req.username, event="REGISTER_FAILED",
            details="reason=username_already_taken",
            level="WARNING", module="AuthService", request=request
        )
        raise HTTPException(status_code=400, detail="Username is already taken")
    
    from ..core.security import hash_password
    import string, secrets
    gen_pass = ''.join(secrets.choice(string.ascii_letters + string.digits + "!@#$%^&*") for _ in range(10))
    
    new_user = User(
        username=req.username,
        hashed_password=hash_password(gen_pass),
        role="USER",
        status="PENDING",
        must_change_password=True,
        is_active=1,
        department_id=req.department_id,
        squad_id=req.squad_id,
        position=req.position,
        custom_role_id=req.custom_role_id
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    log_action(
        user=req.username, event="REGISTER_REQUEST",
        details=f"dept_id={req.department_id}, squad_id={req.squad_id}, position={req.position}",
        level="INFO", module="AuthService", request=request
    )
    
    # Broadcast SSE event so admin sidebar updates pending count in real-time
    job_events.broadcast("user_registered", {"username": new_user.username, "id": new_user.id})
    
    return {"message": "Registration successful. Pending admin approval."}


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Login with username/password → get JWT token"""
    # Rate limit check (OWASP A07)
    login_rate_limiter.check(request)
    
    user = db.query(User).filter(User.username == req.username).first()
    
    ldap_success = authenticate_ldap(req.username, req.password)
    db_success = user and verify_password(req.password, user.hashed_password)

    if not ldap_success and not db_success:
        remaining_attempts = login_rate_limiter.record_attempt(request)
        log_action(
            user=req.username, event="LOGIN_FAILED",
            details="reason=invalid_credentials",
            level="WARNING", module="AuthService", request=request
        )
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={
                "detail": "Invalid Username or Password",
                "remaining_attempts": remaining_attempts
            }
        )

    # Auto-provision LDAP user if not in DB
    if ldap_success and not user:
        from ..core.security import hash_password
        import string, secrets
        gen_pass = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))
        user = User(
            username=req.username,
            hashed_password=hash_password(gen_pass),
            role="USER",
            status="ACTIVE",
            must_change_password=False,
            is_active=1
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    if user.expire_date and user.expire_date.replace(tzinfo=None) < datetime.now(timezone.utc).replace(tzinfo=None).replace(hour=0, minute=0, second=0, microsecond=0):
        user.status = "SUSPENDED"
        user.is_active = 0
        db.commit()
        log_action(
            user=req.username, event="LOGIN_BLOCKED",
            details="reason=account_expired",
            level="WARNING", module="AuthService", request=request
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has expired and is now suspended."
        )

    if user.status == "PENDING":
        log_action(
            user=req.username, event="LOGIN_BLOCKED",
            details="reason=account_pending",
            level="WARNING", module="AuthService", request=request
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is pending approval. Please contact Admin."
        )
    elif user.status == "SUSPENDED" or not user.is_active:
        log_action(
            user=req.username, event="LOGIN_BLOCKED",
            details="reason=account_suspended",
            level="WARNING", module="AuthService", request=request
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is suspended. Please contact Admin."
        )

    active_session = db.query(UserSession).filter(
        UserSession.user_id == user.id,
        UserSession.status.in_(["ACTIVE", "PENDING_LOGOUT"])
    ).first()

    # 💡 ป้องกันกรณีปิด Browser หนี (Session ค้าง)
    if active_session:
        if active_session.status == "PENDING_LOGOUT":
            # ผู้ใช้ปิด Browser ไปแล้ว และกำลังพยายามเข้าสู่ระบบใหม่
            active_session.status = "LOGGED_OUT"
            db.commit()
            active_session = None
        elif active_session.last_seen and (datetime.now(timezone.utc).replace(tzinfo=None) - active_session.last_seen).total_seconds() > 65:
            # ผู้ใช้อาจจะ Browser Crash หรือหลุดไปนานเกิน 65 วินาที
            active_session.status = "EXPIRED"
            db.commit()
            active_session = None

    if active_session:
        # เตะ session เก่าออกทันทีตามที่ user รีเควส
        active_session.status = "REVOKED"
        active_session.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        
        job_events.broadcast("session_revoked", {"user_id": user.id})
        log_action(
            user=req.username, event="LOGIN_TAKEOVER_FORCED",
            details="reason=concurrent_login_override",
            level="WARNING", module="AuthService", request=request
        )

    # Success — reset rate limiter for this IP
    login_rate_limiter.reset(request)
    token = create_access_token(data={"sub": str(user.id), "role": user.role})

    # Extract jti from the freshly created token for audit log
    payload = decode_access_token(token)
    jti = payload.get("jti", "-") if payload else "-"

    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() if request.headers.get("x-forwarded-for") else (request.client.host if request.client else "unknown")
    ua = request.headers.get("user-agent", "")
    db_session = UserSession(
        user_id=user.id,
        jti=jti,
        status="ACTIVE",
        ip=ip,
        user_agent=ua,
        last_seen=datetime.now(timezone.utc).replace(tzinfo=None)
    )
    db.add(db_session)
    user.last_login = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    log_action(
        user=req.username, event="LOGIN_SUCCESS",
        details=f"role={user.role}",
        level="INFO", module="AuthService", request=request, session_id=jti
    )
    return LoginResponse(
        access_token=token,
        user={
            "id": user.id, 
            "username": user.username, 
            "role": user.role,
            "status": user.status,
            "must_change_password": user.must_change_password,
            "department_id": user.department_id,
            "squad_id": user.squad_id,
            "custom_role_id": user.custom_role_id,
            "custom_role_name": user.custom_role.name if user.custom_role else None,
            "menu_permissions": [p.menu_key for p in user.custom_role.menu_permissions] if user.custom_role else [],
            "support_roles": [{"id": sr.id, "department_id": sr.department_id, "department_name": sr.department.name if sr.department else None, "squad_id": sr.squad_id, "squad_name": sr.squad.name if sr.squad else None, "custom_role_id": sr.custom_role_id, "custom_role_name": sr.custom_role.name if sr.custom_role else None} for sr in user.support_roles] if getattr(user, 'support_roles', None) else [],
            "last_login": user.last_login.isoformat() if user.last_login else None,
            "expire_date": user.expire_date.isoformat() if user.expire_date else None
        }
    )


@router.post("/logout")
def logout(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Logout — record the event for audit trail (AAA Accounting)"""
    jti = getattr(request.state, "session_id", None)
    if jti:
        sess = db.query(UserSession).filter(
            UserSession.user_id == current_user.id,
            UserSession.jti == jti,
            UserSession.status == "ACTIVE"
        ).first()
        if sess:
            sess.status = "LOGGED_OUT"
            sess.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
    log_action(
        user=current_user.username, event="LOGOUT_NORMAL",
        details="-",
        level="INFO", module="AuthService", request=request
    )
    return {"message": "Logged out successfully"}


@router.post("/unload")
def unload_session(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Called by beforeunload on the frontend. Marks session as PENDING_LOGOUT."""
    jti = getattr(request.state, "session_id", None)
    if jti:
        sess = db.query(UserSession).filter(
            UserSession.user_id == current_user.id,
            UserSession.jti == jti,
            UserSession.status == "ACTIVE"
        ).first()
        if sess:
            sess.status = "PENDING_LOGOUT"
            sess.last_seen = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
    return {"message": "Unload recorded"}


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """User changes their own password, clears must_change_password flag"""
    if not verify_password(req.old_password, current_user.hashed_password):
        log_action(
            user=current_user.username, event="PWD_CHANGE_FAILED",
            details="reason=incorrect_old_password",
            level="WARNING", module="AuthService", request=request
        )
        raise HTTPException(status_code=400, detail="Incorrect old password")
    
    from ..core.security import hash_password
    current_user.hashed_password = hash_password(req.new_password)
    current_user.must_change_password = False
    db.commit()
    log_action(
        user=current_user.username, event="PWD_CHANGED",
        details="-",
        level="INFO", module="AuthService", request=request
    )

    job_events.broadcast("user_password_changed", {"user_id": current_user.id})

    return {"message": "Password changed successfully"}


# --- Get Current User ---
@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)):
    """Get current logged-in user info"""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
        "status": current_user.status,
        "must_change_password": current_user.must_change_password,
        "department_id": current_user.department_id,
        "squad_id": current_user.squad_id,
        "position": current_user.position,
        "department_name": current_user.department.name if current_user.department else None,
        "squad_name": current_user.squad.name if current_user.squad else None,
        "custom_role_id": current_user.custom_role_id,
        "custom_role_name": current_user.custom_role.name if current_user.custom_role else None,
        "menu_permissions": [p.menu_key for p in current_user.custom_role.menu_permissions] if current_user.custom_role else [],
        "support_roles": [{"id": sr.id, "department_id": sr.department_id, "department_name": sr.department.name if sr.department else None, "squad_id": sr.squad_id, "squad_name": sr.squad.name if sr.squad else None, "custom_role_id": sr.custom_role_id, "custom_role_name": sr.custom_role.name if sr.custom_role else None} for sr in current_user.support_roles] if getattr(current_user, 'support_roles', None) else []
    }


@router.get("/login-challenges/{challenge_id}")
def get_login_challenge(challenge_id: str, db: Session = Depends(get_db)):
    challenge = db.query(LoginChallenge).filter(LoginChallenge.challenge_id == challenge_id).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    return {"status": challenge.status}


@router.post("/login-challenges/{challenge_id}/decision")
def decide_login_challenge(
    challenge_id: str,
    req: LoginChallengeDecisionRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    challenge = db.query(LoginChallenge).filter(LoginChallenge.challenge_id == challenge_id).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if challenge.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if challenge.status != "PENDING":
        return {"status": challenge.status}

    decision = (req.decision or "").upper()
    if decision not in {"ACCEPT", "DENY"}:
        raise HTTPException(status_code=400, detail="Invalid decision")

    from datetime import timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if decision == "ACCEPT":
        active_sessions = db.query(UserSession).filter(
            UserSession.user_id == current_user.id,
            UserSession.status == "ACTIVE"
        ).all()
        for s in active_sessions:
            s.status = "REVOKED"
            s.revoked_at = now
        challenge.status = "ACCEPTED"
        challenge.resolved_at = now
        db.commit()

        job_events.broadcast("login_challenge_resolved", {
            "user_id": current_user.id,
            "challenge_id": challenge_id,
            "status": "ACCEPTED"
        })
        job_events.broadcast("session_revoked", {"user_id": current_user.id})
        log_action(
            user=current_user.username, event="LOGIN_TAKEOVER_ACCEPTED",
            details=f"challenge_id={challenge_id}",
            level="WARNING", module="AuthService", request=request
        )
        return {"status": "ACCEPTED"}

    challenge.status = "DENIED"
    challenge.resolved_at = now
    db.commit()
    job_events.broadcast("login_challenge_resolved", {
        "user_id": current_user.id,
        "challenge_id": challenge_id,
        "status": "DENIED"
    })
    log_action(
        user=current_user.username, event="LOGIN_TAKEOVER_DENIED",
        details=f"challenge_id={challenge_id}",
        level="INFO", module="AuthService", request=request
    )
    return {"status": "DENIED"}


# --- API Key Management ---
@router.post("/api-keys", response_model=ApiKeyCreateResponse)
def create_api_key(
    req: ApiKeyCreateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new API Key (for Jenkins/CI)"""
    raw_key = generate_api_key()
    key_hash = hash_api_key(raw_key)

    db_key = ApiKey(
        key_hash=key_hash,
        name=req.name,
        user_id=current_user.id,
        is_active=1
    )
    db.add(db_key)
    db.commit()
    db.refresh(db_key)

    log_action(
        user=current_user.username, event="API_KEY_CREATED",
        details=f"name={req.name}",
        level="INFO", module="ApiKeyMgmt", request=request
    )
    return ApiKeyCreateResponse(
        id=db_key.id,
        name=db_key.name,
        api_key=raw_key  # แสดงครั้งเดียว!
    )


@router.get("/api-keys", response_model=List[ApiKeyRead])
def list_api_keys(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all API keys for current user"""
    return db.query(ApiKey).filter(ApiKey.user_id == current_user.id).all()


@router.delete("/api-keys/{key_id}")
def delete_api_key(
    key_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete an API key"""
    api_key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.user_id == current_user.id
    ).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API Key not found")
    key_name = api_key.name
    db.delete(api_key)
    db.commit()
    log_action(
        user=current_user.username, event="API_KEY_DELETED",
        details=f"id={key_id}, name={key_name}",
        level="INFO", module="ApiKeyMgmt", request=request
    )
    return {"message": "API Key deleted"}
