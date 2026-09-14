import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "robot_verify.db")

def migrate():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        cursor.execute("ALTER TABLE user_support_roles ADD COLUMN squad_id INTEGER REFERENCES squads(id) ON DELETE SET NULL")
        print("Added squad_id to user_support_roles.")
    except sqlite3.OperationalError as e:
        print(f"Error (maybe already exists?): {e}")
        
    conn.commit()
    conn.close()

if __name__ == "__main__":
    migrate()
