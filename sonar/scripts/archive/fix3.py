import subprocess

# 1. First, pull the file from the old image
out = subprocess.check_output(['docker', 'run', '--rm', '--entrypoint', 'cat', 'robot_verify_deployment-backend:latest', '/app/app/api/endpoints.py'])
content = out.decode('utf-8')

# 2. Re-apply target 1
target1 = """        job_id_strs = []
        if flow_ids:
            jobs = db.query(Job).filter(Job.flow_id.in_(flow_ids)).all()
            job_id_strs = [j.job_id_str for j in jobs]"""

replace1 = """        job_id_strs = []
        if flow_ids:
            jobs = db.query(Job).filter(Job.flow_id.in_(flow_ids)).all()
            active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]
            if active_jobs:
                raise HTTPException(status_code=400, detail="Cannot delete folder while jobs are QUEUED or PROCESSING")
            job_id_strs = [j.job_id_str for j in jobs]"""

# 3. Re-apply target 2
target2 = """        # Get jobs before deletion
        jobs = db.query(Job).filter(Job.flow_id == flow_id).all()
        job_id_strs = [j.job_id_str for j in jobs]"""

replace2 = """        # Get jobs before deletion
        jobs = db.query(Job).filter(Job.flow_id == flow_id).all()
        active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]
        if active_jobs:
            raise HTTPException(status_code=400, detail="Cannot delete flow while jobs are QUEUED or PROCESSING")
        job_id_strs = [j.job_id_str for j in jobs]"""

new_content = content.replace(target1, replace1)
new_content = new_content.replace(target2, replace2)

with open('backend/app/api/endpoints.py', 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"File updated. Replaced 1: {target1 in content}. Replaced 2: {target2 in content}")
