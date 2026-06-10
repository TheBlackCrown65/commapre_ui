"""
Audit Trail Logger (AAA Compliance) - DB Edition (Tamper-Evident)
===================================================================
เก็บ log การกระทำของ user ลง Database พร้อม Hashing (HMAC-SHA256) ป้องกันการแก้ไข
"""
import os
import hmac
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional

from ..database import SessionLocal
from ..models import AuditLog

# Thailand Timezone
TZ_TH = timezone(timedelta(hours=7))

# Secret Salt สำหรับ Hashing (ควรเก็บใน .env แต่ตั้ง default เผื่อไว้)
AUDIT_SALT = os.getenv("AUDIT_SALT", "SecureSuperSecretRobotVerifySalt!")

def _extract_ip(request) -> str:
    """Extract client IP from FastAPI Request object."""
    if request is None:
        return "internal"
    try:
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host
    except Exception:
        pass
    return "unknown"

def generate_log_hash(timestamp_str: str, username: str, action: str, details: str, ip: str, method: str, endpoint: str, prev_hash: str) -> str:
    """Generate HMAC-SHA256 for a log entry to ensure tamper evidence."""
    msg = f"{timestamp_str}|{username}|{action}|{details}|{ip}|{method}|{endpoint}|{prev_hash}"
    return hmac.new(AUDIT_SALT.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).hexdigest()

def log_action(
    user: str,
    event: str,
    details: str = "-",
    level: str = "INFO",
    module: str = "SystemService",
    request=None,
    session_id: str = None,
    method: str = "-",
    endpoint: str = "-",
) -> None:
    """
    Write a structured audit log entry to the Database with Tamper-Evident Hashing.
    """
    try:
        # Use UTC and strictly strip microseconds for hashing exact match
        now = datetime.now(timezone.utc).replace(tzinfo=None).replace(microsecond=0)
        timestamp_str = now.strftime("%Y-%m-%d %H:%M:%S")
        
        # Source IP
        source_ip = _extract_ip(request)

        # Session ID resolution
        if session_id is None:
            if request is not None:
                session_id = getattr(request.state, "session_id", None) if hasattr(request, "state") else None
            if session_id is None:
                session_id = "SYSTEM" if user == "SYSTEM" else "-"
                
        # Auto-extract method and endpoint if request is provided
        if request is not None:
            if method == "-":
                method = request.method
            if endpoint == "-":
                endpoint = request.url.path
            
            # Prevent double-logging by middleware
            if hasattr(request, "state"):
                request.state.audit_logged = True

        # Combine old fields
        combined_details = f"[{level}] [{module}] {details}"

        # DB Session context
        db = SessionLocal()
        try:
            # 1. Fetch the last log to get prev_hash
            last_log = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
            prev_hash = last_log.log_hash if last_log and last_log.log_hash else "GENESIS"
            
            # 2. Calculate new hash
            new_hash = generate_log_hash(
                timestamp_str=timestamp_str,
                username=user,
                action=event,
                details=combined_details,
                ip=source_ip,
                method=method,
                endpoint=endpoint,
                prev_hash=prev_hash
            )
            
            # 3. Insert into DB
            audit_entry = AuditLog(
                timestamp=now,
                user_id=None, # user param is often just the username in legacy calls
                username=user,
                action=event,
                method=method,
                endpoint=endpoint,
                details=combined_details,
                ip_address=source_ip,
                session_id=session_id,
                prev_hash=prev_hash,
                log_hash=new_hash
            )
            db.add(audit_entry)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        # Audit logging should never crash the application
        print(f"⚠️ Audit log DB write error: {e}")

def cleanup_old_logs() -> int:
    """
    Legacy method override - delete old .txt / .log files
    """
    deleted = 0
    AUDIT_LOG_DIR = "/app/output/audit_logs"
    if os.path.exists(AUDIT_LOG_DIR):
        try:
            for filename in os.listdir(AUDIT_LOG_DIR):
                if filename.startswith("audit_") and (filename.endswith(".log") or filename.endswith(".txt")):
                    filepath = os.path.join(AUDIT_LOG_DIR, filename)
                    os.remove(filepath)
                    deleted += 1
                    print(f"🗑️ Deleted legacy audit log: {filename}")
        except Exception as e:
            print(f"⚠️ Legacy audit log cleanup error: {e}")
    return deleted
