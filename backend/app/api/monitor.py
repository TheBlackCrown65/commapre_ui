from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
import psutil
import os
import shutil
import time
import subprocess
from ..database import SessionLocal
from ..models import Job, Flow, User
from ..core.deps import require_admin

router = APIRouter(prefix="/monitor", tags=["Monitor"])

def get_dir_size(path):
    if not os.path.exists(path): return 0
    try:
        out = subprocess.check_output(['du', '-sb', path], stderr=subprocess.DEVNULL)
        return int(out.split()[0])
    except:
        total = 0
        for dirpath, _, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp): total += os.path.getsize(fp)
        return total

_storage_cache = {
    "data": None,
    "last_updated": 0,
    "is_calculating": False
}

_cpu_cache = {
    "percent": 0.0,
    "last_updated": 0
}

CACHE_TTL = 60

def invalidate_storage_cache():
    _storage_cache["last_updated"] = 0

def calculate_storage_background():
    db = SessionLocal()
    try:
        # 1. Map Flow ID -> "Dept / Squad"
        flows = db.query(Flow).all()
        flow_group_map = {}
        for f in flows:
            squad = None
            if hasattr(f, 'squad') and f.squad:
                squad = f.squad
            elif f.folder and hasattr(f.folder, 'squad') and f.folder.squad:
                squad = f.folder.squad
            
            if squad:
                dept_name = squad.department.name if squad.department else "Uncategorized"
                squad_name = squad.name
                group_name = f"{dept_name} / {squad_name}"
            else:
                group_name = "Uncategorized / No Squad"
            
            flow_group_map[f.id] = group_name

        # 2. Map Job ID -> "Dept / Squad"
        jobs = db.query(Job).all()
        job_group_map = {}
        for j in jobs:
            if j.flow_id and j.flow_id in flow_group_map:
                job_group_map[j.job_id_str] = flow_group_map[j.flow_id]
            else:
                job_group_map[j.job_id_str] = "Uncategorized / No Squad"

        # 3. เตรียมที่เก็บสถิติ
        usage_stats = {}
        def add_usage(group, category, size):
            if group not in usage_stats:
                usage_stats[group] = {"jobs": 0, "references": 0, "total": 0}
            usage_stats[group][category] += size
            usage_stats[group]["total"] += size

        # คำนวณ Jobs (โฟลเดอร์รันเทส)
        jobs_dir = "/app/output/jobs"
        if os.path.exists(jobs_dir):
            for j_id in os.listdir(jobs_dir):
                if j_id.isdigit():
                    group = job_group_map.get(j_id, "Uncategorized / No Squad")
                    add_usage(group, "jobs", get_dir_size(os.path.join(jobs_dir, j_id)))

        # คำนวณ References (รูป Master)
        refs_dir = "/app/output/references"
        if os.path.exists(refs_dir):
            for f_id in os.listdir(refs_dir):
                if f_id.isdigit():
                    group = flow_group_map.get(int(f_id), "Uncategorized / No Squad")
                    add_usage(group, "references", get_dir_size(os.path.join(refs_dir, f_id)))

        # แปลงเป็น List เพื่อเรียงลำดับ
        detailed_stats = []
        for group, stats in usage_stats.items():
            if stats["total"] > 0:
                detailed_stats.append({
                    "name": group,
                    "jobs_bytes": stats["jobs"],
                    "refs_bytes": stats["references"],
                    "total_bytes": stats["total"]
                })
        
        detailed_stats.sort(key=lambda x: x["total_bytes"], reverse=True)

        # 4. Calculate Project OS bytes
        try:
            db_size_query = text("SELECT pg_database_size(current_database());")
            db_size_bytes = db.execute(db_size_query).scalar() or 0
        except Exception:
            db_size_bytes = 0

        app_size = get_dir_size("/app")
        packages_size = get_dir_size("/usr/local/lib/python3.11/site-packages")
        base_docker_images_estimate = 300 * 1024 * 1024 # ~300 MB for redis, postgres, node base images
        
        # /app includes the output directory (which is the App Data). We must subtract the App Data size to get the pure OS/Code size.
        app_data_size = sum(stats["total_bytes"] for stats in detailed_stats)
        pure_app_size = max(0, app_size - app_data_size)

        project_os_bytes = pure_app_size + packages_size + db_size_bytes + base_docker_images_estimate

        _storage_cache["data"] = {
            "detailed": detailed_stats,
            "project_os_bytes": project_os_bytes
        }
        _storage_cache["last_updated"] = time.time()
    except Exception as e:
        print(f"Storage calc error: {e}")
    finally:
        _storage_cache["is_calculating"] = False
        db.close()

@router.get("/stats")
def get_system_stats(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_admin)
):
    global _cpu_cache
    current_time = time.time()
    
    # 💡 2. ดึงค่าเฉลี่ย CPU ทุกๆ 2 วินาที แทนการดึงแบบเสี้ยววินาที ทำให้กราฟนิ่งขึ้นมาก
    if current_time - _cpu_cache["last_updated"] >= 2.0:
        val = psutil.cpu_percent(interval=None)
        _cpu_cache["percent"] = val if val > 0.0 else psutil.cpu_percent(interval=0.1)
        _cpu_cache["last_updated"] = current_time
        
    cpu_percent = _cpu_cache["percent"]
    
    mem = psutil.virtual_memory()
    disk = shutil.disk_usage("/")
    
    if _storage_cache["data"] is None or (current_time - _storage_cache["last_updated"] > CACHE_TTL):
        if not _storage_cache["is_calculating"]:
            _storage_cache["is_calculating"] = True
            background_tasks.add_task(calculate_storage_background)
            
    storage_breakdown = _storage_cache["data"] or {"detailed": [], "project_os_bytes": 0}
    response_storage = dict(storage_breakdown)
    response_storage["is_calculating"] = _storage_cache["is_calculating"]
    
    # Calculate total app storage used
    app_storage_used = sum(item["total_bytes"] for item in storage_breakdown.get("detailed", []))
    
    project_os_bytes = storage_breakdown.get("project_os_bytes", 0)

    return {
        "cpu_percent": cpu_percent,
        "ram": {
            "total": mem.total,
            "used": mem.used,
            "percent": mem.percent
        },
        "disk": {
            "total": disk.total,
            "used": disk.used,
            "free": disk.free,
            "percent": round((disk.used / disk.total) * 100, 1) if disk.total > 0 else 0
        },
        "app_storage": {
            "used": app_storage_used
        },
        "project_os_bytes": project_os_bytes,
        "storage_breakdown": response_storage
    }