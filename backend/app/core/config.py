"""
Application Config
==================
อ่านค่า settings ทั้งหมดจาก environment variables
"""
import os


class Settings:
    # Database - Require configuration, no fallback to local sqlite in production configs
    DATABASE_URL: str = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL environment variable must be set")

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # JWT - Enforce secure key
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY")
    if not JWT_SECRET_KEY or JWT_SECRET_KEY == "change-me-in-production":
        raise ValueError("FATAL ERROR: JWT_SECRET_KEY environment variable is missing or insecure! Must set a secure key in production.")
    
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))  # 1 hour

    # CORS - Restrict by default
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "")

    # Admin Seed
    ADMIN_DEFAULT_PASSWORD: str = os.getenv("ADMIN_DEFAULT_PASSWORD", "").strip()
    if not ADMIN_DEFAULT_PASSWORD or ADMIN_DEFAULT_PASSWORD == "adminrobot":
        raise ValueError("FATAL ERROR: ADMIN_DEFAULT_PASSWORD environment variable is missing or insecure!")

    # LDAP Integration
    LDAP_SERVER_URL: str = os.getenv("LDAP_SERVER_URL", "")
    LDAP_BASE_DN: str = os.getenv("LDAP_BASE_DN", "")
    LDAP_USER_DOMAIN: str = os.getenv("LDAP_USER_DOMAIN", "")

    # App
    APP_NAME: str = "Robot Verify"
    API_V1_PREFIX: str = "/api/v1"

    def __init__(self):
        pass


settings = Settings()
