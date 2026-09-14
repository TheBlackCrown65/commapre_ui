import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "robot_verify.db")

def migrate():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if user_support_roles exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_support_roles'")
    if cursor.fetchone():
        print("Table user_support_roles already exists.")
    else:
        print("Creating user_support_roles table...")
        cursor.execute("""
            CREATE TABLE user_support_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                department_id INTEGER NOT NULL,
                custom_role_id INTEGER,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE,
                FOREIGN KEY(custom_role_id) REFERENCES custom_roles(id) ON DELETE SET NULL
            )
        """)
        
        # Check if old table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_departments_access'")
        if cursor.fetchone():
            print("Migrating data from user_departments_access...")
            cursor.execute("""
                INSERT INTO user_support_roles (user_id, department_id)
                SELECT user_id, department_id FROM user_departments_access
            """)
            print(f"Migrated {cursor.rowcount} rows.")
            
            # We don't drop the old table just in case, but we can if we want
            cursor.execute("DROP TABLE user_departments_access")
            print("Dropped user_departments_access.")
            
        conn.commit()
    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    migrate()
