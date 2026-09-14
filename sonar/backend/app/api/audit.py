import hashlib
import hmac
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException

from sqlalchemy.orm import Session
from sqlalchemy import desc

from ..database import get_db
from ..models import AuditLog, User
from ..core.deps import get_current_user
from ..core.audit_logger import AUDIT_SALT, generate_log_hash

router = APIRouter()

# Schema for response
from pydantic import BaseModel

class AuditLogResponse(BaseModel):
    id: int
    timestamp: datetime
    username: Optional[str] = None
    action: str
    method: Optional[str] = None
    endpoint: Optional[str] = None
    details: Optional[str] = None
    ip_address: Optional[str] = None
    session_id: Optional[str] = None
    is_valid: bool = True # For UI to show if hash is intact

    class Config:
        from_attributes = True

@router.get("/", response_model=dict)
def get_audit_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=10000),
    username: Optional[str] = None,
    action: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    ip_address: Optional[str] = None,
    hide_system_events: bool = Query(True),
):
    """Get audit logs with filtering and pagination. Admin only."""
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Not authorized")

    query = db.query(AuditLog)

    if username:
        query = query.filter(AuditLog.username.ilike(f"%{username}%"))
    if action:
        query = query.filter(AuditLog.action == action)
    if ip_address:
        query = query.filter(AuditLog.ip_address.ilike(f"%{ip_address}%"))
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            query = query.filter(AuditLog.timestamp >= start_dt)
        except ValueError:
            pass
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date)
            query = query.filter(AuditLog.timestamp <= end_dt)
        except ValueError:
            pass

    if hide_system_events:
        query = query.filter(~AuditLog.action.startswith('API_CALL_'))

    total = query.count()
    logs = query.order_by(desc(AuditLog.timestamp), desc(AuditLog.id)).offset(skip).limit(limit).all()

    # Verify hashes on the fly for the response
    # In a real heavy production, you might do this via a background task or specific "Verify" button.
    # We do a basic self-check here.
    results = []
    for log in logs:
        expected_hash = generate_log_hash(
            timestamp_str=log.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            username=log.username or "",
            action=log.action,
            details=log.details or "-",
            ip=log.ip_address or "unknown",
            method=log.method or "-",
            endpoint=log.endpoint or "-",
            prev_hash=log.prev_hash or "GENESIS"
        )
        # We only check its own hash integrity against itself (not the full chain backwards for performance)
        is_valid = hmac.compare_digest(log.log_hash or "", expected_hash)
        
        results.append({
            "id": log.id,
            "timestamp": log.timestamp,
            "username": log.username,
            "action": log.action,
            "method": log.method,
            "endpoint": log.endpoint,
            "details": log.details,
            "ip_address": log.ip_address,
            "session_id": log.session_id,
            "is_valid": is_valid
        })

    return {
        "total": total,
        "items": results
    }

@router.get("/actions")
def get_unique_actions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get unique action types for the filter dropdown"""
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    actions = db.query(AuditLog.action).distinct().all()
    return [a[0] for a in actions if a[0]]

@router.get("/stats")
def get_audit_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get log stats for the last 7 days"""
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    from datetime import datetime, timedelta, timezone
    seven_days_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    
    # We only care about non-system noise for the dashboard
    logs = db.query(AuditLog.timestamp, AuditLog.details).filter(
        AuditLog.timestamp >= seven_days_ago,
        ~AuditLog.action.startswith('API_CALL_')
    ).all()
    
    stats = {}
    for log in logs:
        date_str = log.timestamp.strftime("%Y-%m-%d")
        if date_str not in stats:
            stats[date_str] = {"INFO": 0, "WARNING": 0, "ERROR": 0}
        
        # Parse level
        level = "INFO"
        if log.details:
            if "[WARNING]" in log.details.upper():
                level = "WARNING"
            elif "[ERROR]" in log.details.upper() or "[CRITICAL]" in log.details.upper():
                level = "ERROR"
                
        stats[date_str][level] += 1
        
    # Format as list sorted by date
    result = []
    for d in sorted(stats.keys()):
        result.append({
            "date": d,
            "info": stats[d]["INFO"],
            "warning": stats[d]["WARNING"],
            "error": stats[d]["ERROR"]
        })
        
    return result
