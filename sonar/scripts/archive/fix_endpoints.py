import os

path = 'c:/Users/user/Desktop/robot_verify/backend/app/api/endpoints.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

missing_part = """
        refs_deleted = 0
        jobs_deleted = 0
        zips_deleted = 0
        delete_failures = 0
        for fid in flow_ids:
            ref_dir = os.path.join(OUTPUT_DIR, "references", str(fid))
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
            details=f"scope=folder, folder_id={folder_id}, refs_deleted={refs_deleted}, jobs_deleted={jobs_deleted}, zips_deleted={zips_deleted}, failures={delete_failures}",
            level="INFO" if delete_failures == 0 else "WARNING", module="FlowMgmt", request=request
        )
                
    return {"status": "deleted"}

# --- Flows ---
@router.get("/flows", response_model=List[FlowRead])
def read_flows(squad_id: Optional[int] = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    query = db.query(Flow).order_by(Flow.sort_order.asc(), Flow.id.desc())
    if squad_id:
        # Filter flows by folders that belong to this squad OR root flows with this squad_id
        squad_folder_ids = [f.id for f in db.query(FlowFolder.id).filter(FlowFolder.squad_id == squad_id).all()]
        query = query.filter(
            (Flow.folder_id.in_(squad_folder_ids)) | (Flow.squad_id == squad_id)
        )
        
    flows = query.offset(skip).limit(limit).all()
    out = []
    
    for flow in flows:
        page_count = db.query(Page).filter(Page.flow_id == flow.id).count()
        f_dict = {
            "id": flow.id,
            "name": flow.name,
            "folder_id": flow.folder_id,
            "sort_order": flow.sort_order,
            "note": flow.note,
            "page_count": page_count,
            "pages": flow.pages
        }
        out.append(f_dict)
    
    return out

@router.post("/flows", response_model=FlowRead)
def create_flow(flow: FlowCreate, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    db_flow = Flow(name=flow.name, folder_id=flow.folder_id, squad_id=flow.squad_id)
    db.add(db_flow)
    db.commit()
    db.refresh(db_flow)
    
    job_events.broadcast("flow_created", {"squad_id": db_flow.squad_id})
    log_action(
        user=current_user.username, event="FLOW_CREATED",
        details=f"name={flow.name}, folder_id={flow.folder_id}",
        level="INFO", module="FlowMgmt", request=request
    )
    
    # Return as dict matching FlowRead format
    return {
        "id": db_flow.id,
        "name": db_flow.name,
        "folder_id": db_flow.folder_id,
        "sort_order": db_flow.sort_order,
        "page_count": 0,
        "pages": []
    }

@router.put("/flows/reorder")
def reorder_flows(req: ReorderRequest, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    try:
        squad_id = None
        if req.ids:
            first_flow = db.query(Flow).filter(Flow.id == req.ids[0]).first()
            if first_flow:
                squad_id = first_flow.squad_id

        for index, flow_id in enumerate(req.ids):
            db.execute(text("UPDATE flows SET sort_order = :idx WHERE id = :fid"), {"idx": index, "fid": flow_id})
        db.commit()
        
        if squad_id:
            job_events.broadcast("flows_reordered", {"squad_id": squad_id})
            
        return {"message": "Flows reordered"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/flows/{flow_id}")
def update_flow(flow_id: int, req: FlowUpdate, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")
        
    try:
        update_data = req.model_dump(exclude_unset=True)
    except AttributeError:
        update_data = req.dict(exclude_unset=True)
        
    if "name" in update_data:
        flow.name = update_data["name"]
    if "folder_id" in update_data:
        flow.folder_id = update_data["folder_id"]
    if "note" in update_data:
        note_val = update_data["note"]
        if note_val is not None:
            # Validate max length from config
            config = db.query(SystemConfig).filter(SystemConfig.key == "max_flow_note_length").first()
            max_len = int(config.value) if config and config.value.isdigit() else 500
            if len(note_val) > max_len:
                raise HTTPException(status_code=400, detail=f"Note exceeds {max_len} characters")
            flow.note = note_val if note_val.strip() else None
        else:
            flow.note = None
    
    db.commit()
    job_events.broadcast("flow_updated", {"squad_id": flow.squad_id})
    log_action(
        user=current_user.username, event="FLOW_UPDATED",
        details=f"id={flow_id}",
        level="INFO", module="FlowMgmt", request=request
    )
    return {"status": "success"}

@router.delete("/flows/{flow_id}")
def delete_flow(flow_id: int, request: Request, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow:
        # Get jobs before deletion
        jobs = db.query(Job).filter(Job.flow_id == flow_id).all()
        active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]
        if active_jobs:
            raise HTTPException(status_code=400, detail="Cannot delete flow while jobs are QUEUED or PROCESSING")
        
        job_id_strs = [j.job_id_str for j in jobs]
"""

# I need to find where to inject `missing_part`.
# It should be injected right before `delete_failures = 0` and after the messed up `from fastapi import APIRouter...` block.
# Let's just fix it properly. The messed up block started around line 104 in the CURRENT file.
# The `delete_folder` function looks like this currently:
#         all_folder_ids = get_all_folder_ids(folder_id)
#         flows = db.query(Flow.id).filter(Flow.folder_id.in_(all_folder_ids)).all()
#         flow_ids = [f.id for f in flows]
#         
#         job_id_strs = []
#         if flow_ids:
#             jobs = db.query(Job).filter(Job.flow_id.in_(flow_ids)).all()
#             active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]
#             if active_jobs:
#                 raise HTTPException(status_code=400, detail="Cannot delete folder while jobs are QUEUED or PROCESSING")
#             job_id_strs = [j.job_id_str for j in jobs]
#         
#         squad_id = folder.squad_id
#         db.delete(folder)
#         db.commit()
#         job_events.broadcast("folder_deleted", {"squad_id": squad_id})
#         log_action(
#             user=current_user.username, event="FOLDER_DELETED",
#             details=f"id={folder_id}, flows_affected={len(flow_ids)}",
#             level="WARNING", module="FlowMgmt", request=request
#         )
#         

# So I can just read the current file up to `level="WARNING", module="FlowMgmt", request=request\n        )`
# Wait, let's just find that block and replace the whole corrupted area.

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

out_lines = []
in_corrupted = False
for i, line in enumerate(lines):
    if line.strip() == 'level="WARNING", module="FlowMgmt", request=request':
        out_lines.append(line)
        # the next line should be '        )'
        continue
    if line.strip() == ')' and len(out_lines) > 0 and out_lines[-1].strip() == 'level="WARNING", module="FlowMgmt", request=request':
        out_lines.append(line)
        # Add our missing part!
        out_lines.append(missing_part)
        in_corrupted = True
        continue
    
    if in_corrupted:
        if line.strip() == 'delete_failures = 0':
            in_corrupted = False
            out_lines.append(line)
        continue
    
    out_lines.append(line)

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)

print("Fixed")
