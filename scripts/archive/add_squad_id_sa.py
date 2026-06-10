from sqlalchemy import create_engine, text
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/robot_verify.db")
engine = create_engine(DATABASE_URL)

def migrate():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE user_support_roles ADD COLUMN squad_id INTEGER REFERENCES squads(id) ON DELETE SET NULL;"))
            conn.commit()
            print("Added squad_id to user_support_roles.")
        except Exception as e:
            print(f"Error (maybe already exists?): {e}")

if __name__ == "__main__":
    migrate()
