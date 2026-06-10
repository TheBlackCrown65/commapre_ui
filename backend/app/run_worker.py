import os
import sys
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import SystemConfig

def get_concurrency():
    db: Session = SessionLocal()
    try:
        config = db.query(SystemConfig).filter(SystemConfig.key == "worker_concurrency").first()
        if config and config.value.isdigit():
            return int(config.value)
    except Exception as e:
        print(f"Error reading worker_concurrency: {e}")
    finally:
        db.close()
    return 2 # Default fallback

if __name__ == "__main__":
    concurrency = get_concurrency()
    print(f"Starting Celery worker with concurrency: {concurrency}")
    # Replace the current process with the celery worker process
    os.system(f"celery -A app.worker.celery_app worker --concurrency={concurrency} --loglevel=info")
