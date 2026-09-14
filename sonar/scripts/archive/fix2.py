import os

path = 'c:/Users/user/Desktop/robot_verify/backend/app/api/endpoints.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# The section for delete_flow starts at line 396:
start_str = """@router.delete("/flows/{flow_id}")
def delete_flow(flow_id: int, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):"""

# Find where it starts
start_idx = content.find(start_str)

# Find the next section '--- Pages ---'
end_idx = content.find("# --- Pages ---")

correct_delete_flow = """@router.delete("/flows/{flow_id}")
def delete_flow(flow_id: int, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow:
        # Get jobs before deletion
        jobs = db.query(Job).filter(Job.flow_id == flow_id).all()
        active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]
        if active_jobs:
            raise HTTPException(status_code=400, detail="Cannot delete flow while jobs are QUEUED or PROCESSING")
        
        job_id_strs = [j.job_id_str for j in jobs]

        refs_deleted = 0
        jobs_deleted = 0
        zips_deleted = 0
        delete_failures = 0
        ref_dir = os.path.join(OUTPUT_DIR, "references", str(flow_id))
        if os.path.exists(ref_dir):
            try:
                shutil.rmtree(ref_dir)
                refs_deleted += 1
            except Exception as e:
                delete_failures += 1
                log_action(
                    user=current_user.username, event="OUTPUT_DELETE_FAILED",
                    details=f"target=ref_dir, path={ref_dir}, err={type(e).__name__}",
                    level="WARNING", module="FlowMgmt", request=request
                )
            
        for jid_str in job_id_strs:
            job_dir = os.path.join(OUTPUT_DIR, "jobs", jid_str)
            if os.path.exists(job_dir):
                try:
                    shutil.rmtree(job_dir)
                    jobs_deleted += 1
                except Exception as e:
                    delete_failures += 1
                    log_action(
                        user=current_user.username, event="OUTPUT_DELETE_FAILED",
                        details=f"target=job_dir, path={job_dir}, err={type(e).__name__}",
                        level="WARNING", module="FlowMgmt", request=request
                    )
            import glob
            for z in glob.glob(f"{OUTPUT_DIR}/zips/*_{jid_str}.zip"):
                try:
                    os.remove(z)
                    zips_deleted += 1
                except Exception as e:
                    delete_failures += 1
                    log_action(
                        user=current_user.username, event="OUTPUT_DELETE_FAILED",
                        details=f"target=zip, path={z}, err={type(e).__name__}",
                        level="WARNING", module="FlowMgmt", request=request
                    )
        log_action(
            user=current_user.username, event="OUTPUT_FILES_DELETED",
            details=f"scope=flow, flow_id={flow_id}, refs_deleted={refs_deleted}, jobs_deleted={jobs_deleted}, zips_deleted={zips_deleted}, failures={delete_failures}",
            level="INFO" if delete_failures == 0 else "WARNING", module="FlowMgmt", request=request
        )
                
        squad_id = flow.squad_id
        db.delete(flow)
        db.commit()
        job_events.broadcast("flow_deleted", {"squad_id": squad_id})
        log_action(
            user=current_user.username, event="FLOW_DELETED",
            details=f"id={flow_id}, name={flow.name}",
            level="WARNING", module="FlowMgmt", request=request
        )
    return {"status": "deleted"}

"""

new_content = content[:start_idx] + correct_delete_flow + content[end_idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Fixed delete_flow")
