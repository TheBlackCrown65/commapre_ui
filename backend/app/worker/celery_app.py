import os
from celery import Celery

# อ่าน REDIS_URL จาก Environment Variable ถ้าไม่มีให้ใช้ localhost
redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# สร้าง Celery App ชื่อ 'tasks' (worker จะผูกกับชื่อนี้)
celery_app = Celery(
    "tasks",
    broker=redis_url,
    backend=redis_url,
    include=['app.worker.tasks'] # โฟลเดอร์ที่จะให้ Celery ไปหา Task Functions
)

# การตั้งค่าเพิ่มเติมของ Celery
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'], 
    result_serializer='json',
    timezone='Asia/Bangkok',
    enable_utc=True,
    # Worker Settings (ตาม Phase 2.4 Resource Limiting)
    worker_prefetch_multiplier=1, # ดึงคิวทีละ 1 งานเพื่อไม่ให้กั๊กคิว
    task_track_started=True,      # ทราบสถานะตอนเริ่มทำ (STARTED)
)
