"""
Security Utilities
===================
Password hashing, JWT token creation/verification, API Key verification
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
import secrets
import hashlib

from .config import settings

# --- Password Hashing ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a plain-text password"""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain-text password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


# --- JWT Token ---
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token with unique jti for session tracking"""
    import uuid
    to_encode = data.copy()
    expire = datetime.now(timezone.utc).replace(tzinfo=None) + (expires_delta or timedelta(minutes=settings.JWT_EXPIRE_MINUTES))
    jti = uuid.uuid4().hex[:8]  # Short unique session ID for audit trail
    to_encode.update({"exp": expire, "jti": jti})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """Decode and verify a JWT token. Returns payload or None if invalid."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


# --- API Key ---
def generate_api_key() -> str:
    """Generate a random API key (shown to user once)"""
    return f"rv_{secrets.token_urlsafe(32)}"


def hash_api_key(api_key: str) -> str:
    """Hash an API key for storage (one-way, can't retrieve original)"""
    return hashlib.sha256(api_key.encode()).hexdigest()
