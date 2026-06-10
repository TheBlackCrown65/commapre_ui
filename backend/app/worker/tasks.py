import os
import shutil
import json
import gc
import traceback

from datetime import datetime, timezone
import requests
from PIL import Image, ImageChops, ImageDraw
import numpy as np
import cv2
from .celery_app import celery_app
from sqlalchemy import text
from ..database import SessionLocal
from ..models import Job
import re







def compare_images_and_save(path_a, path_b, path_diff, masks=[], enable_alignment=True):
    try:
        img_a = Image.open(path_a).convert("RGB")
        img_b = Image.open(path_b).convert("RGB")




        # 💡 วาด Mask ทับลงไป
        if masks and len(masks) > 0:
            draw_a = ImageDraw.Draw(img_a)
            draw_b = ImageDraw.Draw(img_b)
            for m in masks:
                x = m.get('x', 0) if isinstance(m, dict) else getattr(m, 'x', 0)
                y = m.get('y', 0) if isinstance(m, dict) else getattr(m, 'y', 0)
                w = m.get('width', m.get('w', 0)) if isinstance(m, dict) else getattr(m, 'width', getattr(m, 'w', 0))
                h = m.get('height', m.get('h', 0)) if isinstance(m, dict) else getattr(m, 'height', getattr(m, 'h', 0))

                rect = [x, y, x + w, y + h]
                draw_a.rectangle(rect, fill=(0,0,0))
                draw_b.rectangle(rect, fill=(0,0,0))

        # หาจุดต่าง (Diff)
        diff = ImageChops.difference(img_a, img_b)

        if not diff.getbbox():
            img_a.save(path_diff)
            return "PASS", 0

        diff_np = np.array(diff.convert('L'))

        _, thresh = cv2.threshold(diff_np, 10, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        diff_count = 0
        result_vis = np.array(img_a)
        result_vis = cv2.cvtColor(result_vis, cv2.COLOR_RGB2BGR)

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area > 1:
                diff_count += 1
                x, y, w, h = cv2.boundingRect(cnt)
                cv2.rectangle(result_vis, (x-2, y-2), (x + w+2, y + h+2), (0, 0, 255), 2)

        if diff_count == 0:
            img_a.save(path_diff)
            return "PASS", 0

        final_img = Image.fromarray(cv2.cvtColor(result_vis, cv2.COLOR_BGR2RGB))
        final_img.save(path_diff)

        return "FAIL", diff_count

    except Exception as e:
        print(f"Error comparing: {e}")
        Image.new('RGB', (100, 100), (0, 0, 0)).save(path_diff)
        return "ERROR", 0

@celery_app.task(bind=True, max_retries=2)
def process_comparison_job(self, job_db_id: int):
    db = SessionLocal()
    job = db.query(Job).filter(Job.id == job_db_id).first()
    if not job:
        db.close()
        return

    try:
        job.status = "PROCESSING"
        db.commit()

        job_id_str = job.job_id_str
        flow_id = job.flow_id

        print(f"🚀 Worker Picked Up Job #{job_id_str} for Flow #{flow_id}")

        base_path = f"/app/output/jobs/{job_id_str}"
        dir_a = os.path.join(base_path, "device_a")
        dir_b = os.path.join(base_path, "device_b")
        dir_diff = os.path.join(base_path, "diff")

        for d in [dir_a, dir_b, dir_diff]:
            os.makedirs(d, exist_ok=True)

        global_masks = []
        page_masks_map = {}
        page_sort_map = {}

        flow_name = "job"
        compare_by_order = False
        enable_alignment = True

        meta_path = os.path.join(base_path, "meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                    compare_by_order = meta.get("compare_by_order", False)
            except:
                pass

        try:

            fr = db.execute(text("SELECT name FROM flows WHERE id = :fid"), {"fid": flow_id}).fetchone()
            if fr:
                flow_name = fr[0]

            masks_rows = db.execute(text("SELECT type, x, y, width, height, page_id FROM masks WHERE flow_id = :fid"), {"fid": flow_id}).fetchall()

            p_rows = db.execute(text("SELECT id, page_name, sort_order FROM pages WHERE flow_id = :fid ORDER BY sort_order ASC, id ASC"), {"fid": flow_id}).fetchall()

            dept_row = db.execute(text("""
                SELECT s.department_id 
                FROM flows f
                JOIN flow_folders ff ON f.folder_id = ff.id
                JOIN squads s ON ff.squad_id = s.id
                WHERE f.id = :fid
            """), {"fid": flow_id}).fetchone()
            dept_id = dept_row[0] if dept_row else None

            pages_map = {}
            pages_ordered = []
            for p in p_rows:
                pid = p[0]
                pname = str(p[1])
                porder = p[2] if len(p) > 2 and p[2] is not None else 999

                pages_map[pid] = pname
                page_sort_map[pname.lower().strip()] = porder
                pages_ordered.append(pname.lower().strip())

            for m in masks_rows:
                m_type, x, y, w, h, pid = m
                mask_obj = {"x": x, "y": y, "w": w, "h": h}
                if m_type == 'GLOBAL':
                    global_masks.append(mask_obj)
                elif m_type == 'PAGE' and pid in pages_map:
                    p_name = pages_map[pid].lower().strip()
                    if p_name not in page_masks_map: page_masks_map[p_name] = []
                    page_masks_map[p_name].append(mask_obj)
        except Exception as e:
            print(f"DB Fetch Error: {e}")

        print(f"⚙️ Alignment: ON | CompareByOrder: {'ON' if compare_by_order else 'OFF'}")

        saved_files = sorted(os.listdir(dir_a))
        total_files = len(saved_files)

        results = []
        ref_base_dir = f"/app/output/references/{flow_id}"

        ref_lookup = {}
        if os.path.isdir(ref_base_dir):
            for ref_file in os.listdir(ref_base_dir):
                ref_base = os.path.splitext(ref_file)[0].lower().strip()
                ref_lookup[ref_base] = os.path.join(ref_base_dir, ref_file)

        for idx, filename in enumerate(saved_files):
            fname_key = filename.lower().strip()
            fname_no_ext = os.path.splitext(fname_key)[0]
            ref_page_name = None

            if compare_by_order:
                if idx < len(pages_ordered):
                    ref_page_name = pages_ordered[idx]
                else:
                    continue
            else:
                if fname_key in page_sort_map:
                    ref_page_name = fname_key
                elif fname_no_ext in page_sort_map:
                    ref_page_name = fname_no_ext
                else:
                    continue

            p_a = os.path.join(dir_a, filename)
            p_diff = os.path.join(dir_diff, filename)
            ref_src = ref_lookup.get(ref_page_name)

            if ref_src:
                p_b_in_job = os.path.join(dir_b, filename)
                shutil.copy2(ref_src, p_b_in_job)
                current_masks = global_masks.copy()
                if ref_page_name in page_masks_map: current_masks.extend(page_masks_map[ref_page_name])


                status, count = compare_images_and_save(p_a, p_b_in_job, p_diff, masks=current_masks, enable_alignment=enable_alignment)
                results.append({"filename": filename, "status": status, "diff_count": count})

            try:
                requests.post("http://backend:8000/api/v1/jobs/notify_progress", json={  # NOSONAR
                    "job_id": job_id_str, "department_id": dept_id,
                    "progress": {"current": idx + 1, "total": total_files, "percent": round(((idx + 1) / total_files) * 100)}
                }, timeout=1)
            except: pass

            if (idx + 1) % 10 == 0:
                gc.collect()

        def get_sort_key(res_item):
            if compare_by_order: return res_item["filename"]
            fn = res_item["filename"].lower().strip()
            fn_no_ext = os.path.splitext(fn)[0]
            if fn in page_sort_map: return page_sort_map[fn]
            if fn_no_ext in page_sort_map: return page_sort_map[fn_no_ext]
            return 999

        results.sort(key=get_sort_key)
        report_path = os.path.join(base_path, "report.json")
        with open(report_path, "w") as f: json.dump(results, f)

        meta_path = os.path.join(base_path, "meta.json")
        meta_data = {}
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f: meta_data = json.load(f)
        meta_data["flow_name"] = flow_name
        with open(meta_path, "w") as f: json.dump(meta_data, f)

        job.status = "COMPLETED"
        job.results_path = report_path
        job.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()

        webhook_url = meta_data.get("webhook_url")
        if webhook_url:
            try:
                payload = {"job_id": job_id_str, "status": "COMPLETED", "flow_id": flow_id, "flow_name": flow_name, "results": results}
                requests.post(webhook_url, json=payload, timeout=5)
            except Exception as e: pass

        gc.collect()
        try: requests.post("http://backend:8000/api/v1/jobs/notify", json={"job_id": job_id_str, "status": "COMPLETED", "flow_id": flow_id}, timeout=2)  # NOSONAR
        except: pass

        return job_id_str

    except Exception as e:
        traceback.print_exc()
        job.status = "FAILED"
        job.error_message = str(e)
        job.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        try: requests.post("http://backend:8000/api/v1/jobs/notify", json={"job_id": job.job_id_str, "status": "FAILED"}, timeout=2)  # NOSONAR
        except: pass
        raise self.retry(exc=e)

    finally:
        db.close()