"""
Reset admin password in existing database.
Usage: python reset_admin_password.py
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app.database import SessionLocal
from app.models import User
from app.core.security import hash_password

def main():
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "admin").first()
        if not user:
            print("❌ Admin user not found!")
            return

        new_password = "adminrobot"
        user.hashed_password = hash_password(new_password)
        db.commit()
        print(f"✅ Admin password has been reset to: {new_password}")
    except Exception as e:
        print(f"❌ Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    main()
