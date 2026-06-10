import sqlite3

def migrate():
    # Connect to the SQLite database
    conn = sqlite3.connect('./data/robot_verify.db')
    cursor = conn.cursor()

    try:
        # Add custom_role_id to users
        cursor.execute("ALTER TABLE users ADD COLUMN custom_role_id INTEGER REFERENCES custom_roles(id)")
        print("Added custom_role_id to users table.")
    except sqlite3.OperationalError as e:
        print(f"custom_role_id column already exists or error: {e}")

    try:
        # Note: We will use SQLAlchemy to create the new tables
        pass
    except sqlite3.OperationalError as e:
        print(f"Error: {e}")

    conn.commit()
    conn.close()

if __name__ == "__main__":
    migrate()
    
    # Use SQLAlchemy to create new tables
    from app.database import engine
    from app.models import Base
    Base.metadata.create_all(bind=engine)
    print("SQLAlchemy create_all executed successfully.")
