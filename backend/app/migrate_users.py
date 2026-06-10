import os
import sqlite3
import psycopg2
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

def get_connection():
    if DATABASE_URL and DATABASE_URL.startswith("postgresql"):
        result = urlparse(DATABASE_URL)
        username = result.username
        password = result.password
        database = result.path[1:]
        hostname = result.hostname
        port = result.port
        return psycopg2.connect(
            database=database,
            user=username,
            password=password,
            host=hostname,
            port=port
        ), "postgres"
    else:
        return sqlite3.connect("./robot_verify.db"), "sqlite"

def upgrade():
    conn, db_type = get_connection()
    cursor = conn.cursor()
    
    try:
        if db_type == "postgres":
            # Check if columns exist
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='status'")
            if not cursor.fetchone():
                print("Adding 'status' column to 'users' table...")
                cursor.execute("ALTER TABLE users ADD COLUMN status VARCHAR DEFAULT 'ACTIVE'")
            
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='must_change_password'")
            if not cursor.fetchone():
                print("Adding 'must_change_password' column to 'users' table...")
                cursor.execute("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE")
                
            conn.commit()
            print("Migration successful.")
        else:
            # SQLite fallback
            try:
                cursor.execute("ALTER TABLE users ADD COLUMN status VARCHAR DEFAULT 'ACTIVE'")
            except sqlite3.OperationalError:
                pass
            try:
                cursor.execute("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT 0")
            except sqlite3.OperationalError:
                pass
            conn.commit()
            print("Migration successful for SQLite.")
            
    except Exception as e:
        print(f"Error during migration: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    upgrade()
