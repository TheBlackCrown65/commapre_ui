"""
Database Configuration
======================
อ่านค่า DATABASE_URL จาก environment variable
- Docker: ใช้ PostgreSQL (ผ่าน docker-compose)
- Fallback: ใช้ SQLite สำหรับ dev ในเครื่อง (ไม่แนะนำสำหรับ production)
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# อ่านค่าจาก env — docker-compose จะ inject DATABASE_URL ให้อัตโนมัติ
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./data/robot_verify.db"  # fallback สำหรับ dev
)

# SQLite ต้องการ connect_args พิเศษ, PostgreSQL ไม่ต้อง
connect_args = {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=False,  # ปิด SQL logging ใน production (เปิดเฉพาะตอน debug)
    pool_pre_ping=True,  # เช็ค connection ก่อนใช้ — ป้องกัน stale connection
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI Dependency — ใช้ใน endpoint เพื่อได้ DB session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
