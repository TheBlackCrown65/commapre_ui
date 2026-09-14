import sys
import os

# Append current directory to path to allow imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import engine
from sqlalchemy import text
from app.models import Base

def migrate():
    with engine.connect() as conn:
        try:
            # Try to add custom_role_id to users
            # The syntax for PostgreSQL and SQLite is the same for simple ADD COLUMN
            conn.execute(text("ALTER TABLE users ADD COLUMN custom_role_id INTEGER REFERENCES custom_roles(id)"))
            conn.commit()
            print("Added custom_role_id to users table.")
        except Exception as e:
            print(f"Column might already exist or another error occurred: {e}")
            conn.rollback()

    print("Creating new tables...")
    Base.metadata.create_all(bind=engine)
    print("Migration completed.")

if __name__ == "__main__":
    migrate()
