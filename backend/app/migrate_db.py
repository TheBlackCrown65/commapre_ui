import sys
import os

from app.database import engine
from sqlalchemy import text
from app.models import Base

def migrate():
    print("Creating new tables first...")
    Base.metadata.create_all(bind=engine)
    
    with engine.connect() as conn:
        try:
            # Try to add custom_role_id to users now that custom_roles exists
            conn.execute(text("ALTER TABLE users ADD COLUMN custom_role_id INTEGER REFERENCES custom_roles(id)"))
            conn.commit()
            print("Added custom_role_id to users table.")
        except Exception as e:
            print(f"Column might already exist or another error occurred: {e}")
            conn.rollback()

    print("Migration completed.")

if __name__ == "__main__":
    migrate()
