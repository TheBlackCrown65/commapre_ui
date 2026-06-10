"""
Login Rate Limiter (OWASP A07 - Identification and Authentication Failures)
============================================================================
In-memory rate limiter to prevent brute-force attacks on the login endpoint.
Limits login attempts per IP address.
"""
import time
import threading
from collections import defaultdict
from fastapi import Request, HTTPException, status


class LoginRateLimiter:
    """
    Rate limiter that tracks failed login attempts per IP address.
    
    Config:
        max_attempts: Maximum login attempts allowed within the window (default: 5)
        window_seconds: Time window in seconds (default: 300 = 5 minutes)
    """
    
    def __init__(self, max_attempts: int = 5, window_seconds: int = 300):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def _cleanup_expired(self, ip: str) -> None:
        """Remove expired attempts for an IP."""
        now = time.time()
        cutoff = now - self.window_seconds
        self._attempts[ip] = [t for t in self._attempts[ip] if t > cutoff]
        if not self._attempts[ip]:
            del self._attempts[ip]

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
            if ip:
                return ip
        return request.client.host if request.client else "unknown"

    def check(self, request: Request) -> None:
        """
        Check if the IP is rate-limited. Raises 429 if too many attempts.
        Call this BEFORE processing login.
        """
        ip = self._get_client_ip(request)
        
        with self._lock:
            self._cleanup_expired(ip)
            attempts = self._attempts.get(ip, [])
            
            if len(attempts) >= self.max_attempts:
                # Still rate-limited
                oldest = min(attempts)
                retry_after = int(self.window_seconds - (time.time() - oldest)) + 1
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many login attempts. Try again in {retry_after} seconds.",
                    headers={"Retry-After": str(retry_after)}
                )

    def record_attempt(self, request: Request) -> int:
        """
        Record a failed login attempt for the IP.
        Call this AFTER a failed login.
        Logs BRUTE_FORCE_DETECTED when threshold is reached.
        """
        ip = self._get_client_ip(request)
        
        with self._lock:
            self._cleanup_expired(ip)
            self._attempts[ip].append(time.time())
            remaining = max(0, self.max_attempts - len(self._attempts[ip]))
            
            # Log BRUTE_FORCE_DETECTED when threshold is reached
            if len(self._attempts[ip]) == self.max_attempts:
                from .audit_logger import log_action
                log_action(
                    user="-", event="BRUTE_FORCE_DETECTED",
                    details=f"ip={ip}, attempts={self.max_attempts}, window={self.window_seconds}s",
                    level="WARNING", module="SecurityService", request=request
                )
            return remaining

    def reset(self, request: Request) -> None:
        """
        Reset attempts for an IP after successful login.
        """
        ip = self._get_client_ip(request)
        
        with self._lock:
            if ip in self._attempts:
                del self._attempts[ip]


# Global singleton — 5 attempts per 5 minutes
login_rate_limiter = LoginRateLimiter(max_attempts=5, window_seconds=300)
