"""
FastAPI Dependencies
====================
Reusable dependencies for authentication and database session
"""
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from ..database import get_db
from .security import decode_access_token, hash_api_key
from datetime import datetime, timezone

# HTTP Bearer scheme — extracts token from "Authorization: Bearer <token>"
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db)
):
    """
    Authenticate the request — supports both JWT and API Key.
    
    - JWT token: starts with "eyJ..." (standard JWT)
    - API Key: starts with "rv_" (our custom prefix)
    
    Returns the User object if authenticated.
    Raises 401 if not authenticated.
    Also stores session_id on request.state for audit logging.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ไม่พบ Token — กรุณา Login หรือแนบ API Key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    # --- API Key Authentication ---
    if token.startswith("rv_"):
        from ..models import ApiKey, User
        key_hash = hash_api_key(token)
        api_key = db.query(ApiKey).filter(
            ApiKey.key_hash == key_hash,
            ApiKey.is_active == 1
        ).first()
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="API Key ไม่ถูกต้องหรือถูกปิดใช้งาน"
            )
        # Return the user who owns this API key (or a synthetic user for machine access)
        user = db.query(User).filter(User.id == api_key.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="ไม่พบผู้ใช้ที่ผูกกับ API Key นี้"
            )
        # Store API Key ID as session identifier for audit trail
        request.state.session_id = f"apikey-{api_key.id}"
        request.state.user = user
        return user

    # --- JWT Authentication ---
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token หมดอายุหรือไม่ถูกต้อง — กรุณา Login ใหม่",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token ไม่ถูกต้อง (missing sub)"
        )

    from ..models import User
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ไม่พบผู้ใช้ในระบบ"
        )

    # Store JWT jti as session identifier for audit trail
    jti = payload.get("jti", "-")
    request.state.session_id = jti

    from ..models import UserSession
    active_session = db.query(UserSession).filter(
        UserSession.user_id == user.id,
        UserSession.jti == jti,
        UserSession.status.in_(["ACTIVE", "PENDING_LOGOUT"])
    ).first()
    if not active_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session ถูกยกเลิกหรือถูกแทนที่ — กรุณา Login ใหม่",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if active_session.status == "PENDING_LOGOUT":
        active_session.status = "ACTIVE"
        
    active_session.last_seen = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    if user.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="ผู้ใช้ถูกระงับการใช้งาน")

    request.state.user = user
    return user


def require_admin(current_user=Depends(get_current_user)):
    """Dependency that requires the user to be an ADMIN"""
    if current_user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ต้องเป็น Admin เท่านั้น"
        )
    return current_user

def require_permission(menu_keys):
    """Dependency that requires the user to have ANY of the specified menu permissions, or be a Super Admin."""
    if isinstance(menu_keys, str):
        menu_keys = [menu_keys]
        
    def dependency(current_user=Depends(get_current_user)):
        # Super Admin bypass (ADMIN without custom role)
        if current_user.role == "ADMIN" and not current_user.custom_role_id:
            return current_user
            
        # Check custom role permissions
        if current_user.custom_role:
            user_perms = [p.menu_key for p in current_user.custom_role.menu_permissions]
            if any(key in user_perms for key in menu_keys):
                return current_user
                
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ไม่มีสิทธิ์เข้าถึงข้อมูลนี้"
        )
    return dependency
