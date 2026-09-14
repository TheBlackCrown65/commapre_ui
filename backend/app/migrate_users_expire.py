from sqlalchemy import text
from app.database import engine

def upgrade():
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN expire_date TIMESTAMP"))
            print("Added expire_date")
        except Exception as e:
            print(f"expire_date error: {e}")
            
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_login TIMESTAMP"))
            print("Added last_login")
        except Exception as e:
            print(f"last_login error: {e}")

if __name__ == "__main__":
    upgrade()
