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







def is_different_page(a_gray, b_gray, ssim_threshold=0.60):
    """
    ตรวจสอบว่ารูปสองรูปเป็นคนละหน้า (different page) หรือไม่
    โดยใช้ SSIM (Structural Similarity Index) บนภาพย่อขนาดเล็ก

    SSIM ≈ 1.0 = ภาพเหมือนกัน, SSIM < threshold = คนละหน้า
    Returns: (is_different: bool, ssim_score: float)
    """
    # Crop ส่วน status bar (บน 6%) และ home indicator (ล่าง 4%) ออก
    # เพื่อไม่ให้ส่วนที่เหมือนกันทุกหน้า (เวลา, แบตเตอรี่, สัญญาณ) ทำให้ SSIM สูงเกินจริง
    h_orig, _ = a_gray.shape
    top = int(h_orig * 0.06)
    bottom = int(h_orig * 0.04)
    a_crop = a_gray[top:h_orig - bottom, :]
    b_crop = b_gray[top:h_orig - bottom, :]

    # ใช้ thumbnail ขนาดใหญ่ขึ้น (192x384) เพื่อจับความต่างของตัวอักษร/ภาษาได้ดีขึ้น
    small_size = (192, 384)  # width x height
    a_small = cv2.resize(a_crop, small_size, interpolation=cv2.INTER_AREA)
    b_small = cv2.resize(b_crop, small_size, interpolation=cv2.INTER_AREA)

    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2

    a_f = a_small.astype(np.float64)
    b_f = b_small.astype(np.float64)

    mu_a = cv2.GaussianBlur(a_f, (11, 11), 1.5)
    mu_b = cv2.GaussianBlur(b_f, (11, 11), 1.5)

    sigma_a_sq = cv2.GaussianBlur(a_f ** 2, (11, 11), 1.5) - mu_a ** 2
    sigma_b_sq = cv2.GaussianBlur(b_f ** 2, (11, 11), 1.5) - mu_b ** 2
    sigma_ab = cv2.GaussianBlur(a_f * b_f, (11, 11), 1.5) - mu_a * mu_b

    ssim_map = ((2 * mu_a * mu_b + C1) * (2 * sigma_ab + C2)) / \
               ((mu_a ** 2 + mu_b ** 2 + C1) * (sigma_a_sq + sigma_b_sq + C2))

    mean_ssim = float(ssim_map.mean())
    return mean_ssim < ssim_threshold, mean_ssim


def merge_bounding_boxes(boxes, max_dx, max_dy):
    """
    รวม Bounding Box ที่อยู่ใกล้กันหรือซ้อนทับกัน (Smart Box Clustering)
    เพื่อไม่ให้เกิดเส้นซ้อนกันหลายชั้นเมื่อ Element ในหน้า UI เลื่อนตำแหน่ง
    boxes: list of [x1, y1, x2, y2]
    """
    if not boxes:
        return []

    merged = [list(b) for b in boxes]
    changed = True

    while changed:
        changed = False
        new_merged = []
        visited = [False] * len(merged)

        for i in range(len(merged)):
            if visited[i]:
                continue
            cur_x1, cur_y1, cur_x2, cur_y2 = merged[i]
            visited[i] = True

            for j in range(i + 1, len(merged)):
                if visited[j]:
                    continue
                nx1, ny1, nx2, ny2 = merged[j]

                dist_x = max(0, max(cur_x1, nx1) - min(cur_x2, nx2))
                dist_y = max(0, max(cur_y1, ny1) - min(cur_y2, ny2))

                horiz_overlap = min(cur_x2, nx2) - max(cur_x1, nx1)
                vert_overlap = min(cur_y2, ny2) - max(cur_y1, ny1)

                # 1) ซ้อนทับกันโดยตรง
                is_overlap = (dist_x == 0 and dist_y == 0)

                # 2) อยู่ในแนวตั้งโซนเดียวกัน (มีความกว้างเหลื่อมกัน และระยะห่างแนวตั้ง <= max_dy)
                nearby_vertical = (horiz_overlap >= -max_dx * 0.5) and (dist_y <= max_dy)

                # 3) อยู่ในแนวนอนบรรทัดเดียวกัน (มีความสูงเหลื่อมกัน และระยะห่างแนวนอน <= max_dx)
                nearby_horizontal = (vert_overlap >= -max_dy * 0.5) and (dist_x <= max_dx)

                if is_overlap or nearby_vertical or nearby_horizontal:
                    cur_x1 = min(cur_x1, nx1)
                    cur_y1 = min(cur_y1, ny1)
                    cur_x2 = max(cur_x2, nx2)
                    cur_y2 = max(cur_y2, ny2)
                    visited[j] = True
                    changed = True

            new_merged.append([cur_x1, cur_y1, cur_x2, cur_y2])
        merged = new_merged

    # เรียงลำดับจากบนลงล่าง ซ้ายไปขวา
    merged.sort(key=lambda b: (b[1], b[0]))
    return merged


def merge_touching_boxes(boxes, touch_dist=3):
    """
    รวม Bounding Box ที่แตะโดนกันหรือซ้อนทับกัน (Touching / Overlapping Bounding Boxes)
    ให้กลายเป็นก้อนเดียวกัน ตามความต้องการ: 'ถ้าวงแดงแตะโดนกันให้รวมเป็นก้อนเดียวกันเลย'
    boxes: list of [x1, y1, x2, y2]
    touch_dist: ระยะห่างสูงสุดที่ถือว่าแตะโดนกัน (รวมถึงความหนาของเส้น stroke)
    """
    if not boxes:
        return []

    merged = [list(b) for b in boxes]
    changed = True

    while changed:
        changed = False
        new_merged = []
        visited = [False] * len(merged)

        for i in range(len(merged)):
            if visited[i]:
                continue
            cur_x1, cur_y1, cur_x2, cur_y2 = merged[i]
            visited[i] = True

            for j in range(i + 1, len(merged)):
                if visited[j]:
                    continue
                nx1, ny1, nx2, ny2 = merged[j]

                # ระยะห่างในแนวแกน X และ Y (ถ้าค่า <= 0 หมายถึง overlap กัน)
                gap_x = max(cur_x1, nx1) - min(cur_x2, nx2)
                gap_y = max(cur_y1, ny1) - min(cur_y2, ny2)

                # ถ้าแตะโดนกันทั้งในแกน X และ Y (ระยะห่าง <= touch_dist) ให้รวมเป็นก้อนเดียวกัน
                if gap_x <= touch_dist and gap_y <= touch_dist:
                    cur_x1 = min(cur_x1, nx1)
                    cur_y1 = min(cur_y1, ny1)
                    cur_x2 = max(cur_x2, nx2)
                    cur_y2 = max(cur_y2, ny2)
                    visited[j] = True
                    changed = True

            new_merged.append([cur_x1, cur_y1, cur_x2, cur_y2])
        merged = new_merged

    merged.sort(key=lambda b: (b[1], b[0]))
    return merged


def compare_images_and_save(path_a, path_b, path_diff, masks=[], enable_alignment=True, mismatch_threshold_percent=30.0, page_similarity_threshold=0.60):
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

        # หาจุดต่าง (Diff) พร้อม Tolerance สำหรับแก้ปัญหาขอบเลื่อม (Pixel Shift)
        a_gray = np.array(img_a.convert('L'))
        b_gray = np.array(img_b.convert('L'))

        # 0. Pre-check: SSIM-based Page Mismatch Detection
        # ตรวจว่ารูปเป็นคนละหน้าหรือไม่ ก่อนเริ่ม pixel-level comparison (เร็วกว่า jitter loop มาก)
        is_diff_page, ssim_score = is_different_page(a_gray, b_gray, ssim_threshold=page_similarity_threshold)
        print(f"  📊 Page SSIM = {ssim_score:.4f} (threshold={page_similarity_threshold})")
        if is_diff_page:
            h, w = a_gray.shape
            sc = w / 375.0
            result_vis = np.array(img_a)
            overlay = result_vis.copy()
            cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.5, result_vis, 0.5, 0, result_vis)

            label = f"[ PAGE MISMATCH - SSIM {ssim_score:.2f} ]"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = max(1.2, 1.8 * (sc / 3.3))
            thickness = max(2, int(round(4 * (sc / 3.3))))
            text_size = cv2.getTextSize(label, font, font_scale, thickness)[0]
            text_x = (w - text_size[0]) // 2
            text_y = (h + text_size[1]) // 2

            cv2.putText(result_vis, label, (text_x, text_y), font, font_scale, (0, 0, 255), thickness + 2)
            cv2.putText(result_vis, label, (text_x, text_y), font, font_scale, (255, 255, 255), thickness)

            final_img = Image.fromarray(result_vis)
            final_img.save(path_diff)
            return "MISMATCH", 0

        height, width = a_gray.shape
        scale = width / 375.0  # Base scale relative to mobile screen width (e.g. 1.0 for 375px, ~3.3 for 1242px)

        # 1. Content Alignment (แก้ปัญหา Webview เลื่อนหรือตำแหน่ง Layout ขยับ 1-5px บนมือถือ โดยไม่กระทบ Header/Footer)
        aligned_a = a_gray
        if enable_alignment:
            aligned_a = a_gray.copy()
            diff_raw = cv2.absdiff(a_gray, b_gray)
            diff_raw[:int(round(35 * scale)), :] = 0  # Ignore status bar
            diff_raw[:, -int(round(6 * scale)):] = 0  # Ignore scrollbar
            row_d = np.sum(diff_raw[:, 50:width - 50] > 25, axis=1)

            # ตรวจสอบขอบเขตบน-ล่างที่มีการเคลื่อนที่จริง โดยไม่ไปแตะแถบ Header และ Footer/ปุ่ม ที่ตรงกันอยู่แล้ว
            y_top_limit = int(round(35 * scale))
            y_top = y_top_limit
            for y in range(y_top_limit, height - int(round(50 * scale))):
                if row_d[y] > 5:
                    y_top = max(y_top_limit, y - 5)
                    break

            y_bot = height
            for y in range(height - 1, int(round(50 * scale)), -1):
                if row_d[y] > 5:
                    y_bot = min(height, y + 6)
                    break

            if y_bot > y_top + 100:
                mid_a = a_gray[y_top:y_bot, 50:width - 50]
                mid_b = b_gray[y_top:y_bot, 50:width - 50]
                base_d = np.sum(cv2.absdiff(mid_a, mid_b))
                best_dy = 0
                best_d = base_d
                for dy in range(-5, 6):
                    if dy == 0: continue
                    shifted = cv2.warpAffine(a_gray, np.float32([[1, 0, 0], [0, 1, dy]]), (width, height), borderMode=cv2.BORDER_REPLICATE)[y_top:y_bot, 50:width - 50]
                    d = np.sum(cv2.absdiff(shifted, mid_b))
                    if d < best_d:
                        best_d = d
                        best_dy = dy

                if best_dy != 0 and best_d < base_d * 0.7:
                    aligned_a[y_top:y_bot, :] = cv2.warpAffine(a_gray, np.float32([[1, 0, 0], [0, 1, best_dy]]), (width, height), borderMode=cv2.BORDER_REPLICATE)[y_top:y_bot, :]

        # 2. Axial Jitter Tolerance (แก้ปัญหาขอบเลื่อม subpixel jitter / font anti-aliasing ในแนวราบและแนวดิ่ง
        # โดยใช้การ shift เฉพาะแกนตั้งและนอน เพื่อไม่ให้จุดเครื่องหมายวรรคตอนขนาดเล็ก เช่น โคลอน : หรือจุด . ถูกเฉือนหายไปจากแนวทแยง)
        shifts = [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]
        diffs = []
        for dx, dy in shifts:
            M = np.float32([[1, 0, dx], [0, 1, dy]])
            shifted_a = cv2.warpAffine(aligned_a, M, (width, height), borderMode=cv2.BORDER_REPLICATE)
            diffs.append(cv2.absdiff(shifted_a, b_gray))
        diff_np = np.min(diffs, axis=0)

        # 2. กรอง Scrollbar ชั่วคราวบริเวณขอบขวาของจอ (Ephemeral Mobile Scrollbar)
        # แถบ scrollbar บนมือถือมักจะแสดงตอนเลื่อนหน้าจอและจางหายไป ทำให้เกิด False Positive ที่ขอบขวา 10-20px
        scrollbar_w = max(10, int(round(6 * scale)))
        diff_np[:, width - scrollbar_w:] = 0

        # 3. กำหนดค่า Threshold ที่เสถียร (ตัด noise จาก anti-aliasing และเส้นขอบสีเทาอ่อนที่ไม่ใช่บั๊ก)
        # ค่าความต่าง <= 18 เป็นเพียงความแตกต่างของ subpixel anti-aliasing หรือเงาเส้นขอบ
        thresh_val = 20
        _, thresh = cv2.threshold(diff_np, thresh_val, 255, cv2.THRESH_BINARY)

        if np.max(thresh) == 0:
            img_a.save(path_diff)
            return "PASS", 0

        # 4. ตรวจสอบ Page Mismatch แบบฉลาด (Smart Page Mismatch)
        # คำนวณ % diff จากภาพที่ผ่าน tolerance แล้ว และเช็ค scroll offset ก่อนตัดสินใจว่าเป็นคนละหน้า
        diff_pixels = cv2.countNonZero(thresh)
        diff_ratio = (diff_pixels / (width * height)) * 100.0

        if diff_ratio >= mismatch_threshold_percent:
            # ตรวจสอบว่าเป็นการเลื่อนหน้าจอ (Vertical Scroll Shift) หรือไม่ ก่อนตัดสินว่าเป็น MISMATCH
            best_scrolled_ratio = diff_ratio
            for sdy in [-60, -40, -20, 20, 40, 60]:
                M = np.float32([[1, 0, 0], [0, 1, sdy]])
                s_a = cv2.warpAffine(a_gray, M, (width, height), borderMode=cv2.BORDER_REPLICATE)
                s_diff = cv2.absdiff(s_a, b_gray)
                s_diff[:, width - scrollbar_w:] = 0
                _, s_th = cv2.threshold(s_diff, thresh_val, 255, cv2.THRESH_BINARY)
                r = (cv2.countNonZero(s_th) / (width * height)) * 100.0
                if r < best_scrolled_ratio:
                    best_scrolled_ratio = r

            if best_scrolled_ratio >= mismatch_threshold_percent:
                # Draw PAGE MISMATCH on the result image directly
                result_vis = np.array(img_a)
                overlay = result_vis.copy()
                cv2.rectangle(overlay, (0, 0), (width, height), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.5, result_vis, 0.5, 0, result_vis)

                text = f"[ PAGE MISMATCH - {diff_ratio:.1f}% DIFF ]"
                font = cv2.FONT_HERSHEY_SIMPLEX
                font_scale = max(1.2, 1.8 * (scale / 3.3))
                thickness = max(2, int(round(4 * (scale / 3.3))))
                text_size = cv2.getTextSize(text, font, font_scale, thickness)[0]
                text_x = (width - text_size[0]) // 2
                text_y = (height + text_size[1]) // 2

                cv2.putText(result_vis, text, (text_x, text_y), font, font_scale, (0, 0, 255), thickness + 2)
                cv2.putText(result_vis, text, (text_x, text_y), font, font_scale, (255, 255, 255), thickness)

                final_img = Image.fromarray(result_vis)
                final_img.save(path_diff)
                return "MISMATCH", 0

        # 5. รวมจุดต่าง (Morphological Dilation) แบบวงเผื่อพอดีๆ ดูสบายตา ไม่ยาวเกินไป
        kw = max(3, int(round(2.0 * scale)))
        kh = max(2, int(round(1.2 * scale)))
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, kh))
        dilated = cv2.dilate(thresh, kernel, iterations=1)

        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        diff_count = 0
        result_vis = np.array(img_a)
        result_vis = cv2.cvtColor(result_vis, cv2.COLOR_RGB2BGR)

        # 6. กรอง Noise ขนาดเล็กมาก (Subpixel Noise Filter) และรวบรวม Raw Bounding Boxes
        min_pts = max(2, int(round(0.7 * scale)))
        raw_boxes = []
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            pts = cv2.countNonZero(thresh[y:y+h, x:x+w])
            if pts >= min_pts:
                raw_boxes.append([x, y, x + w, y + h])

        if not raw_boxes:
            img_a.save(path_diff)
            return "PASS", 0

        # 7. Smart Box Clustering: รวมกรอบที่อยู่กลุ่มเดียวกันแบบพอดี ไม่เชื่อมโยงข้ามคำหรือข้ามบล็อก
        max_dx = max(4, int(round(2.5 * scale)))
        max_dy = max(4, int(round(2.5 * scale)))
        merged_boxes = merge_bounding_boxes(raw_boxes, max_dx, max_dy)

        # 8. วาดกรอบสีแดงพร้อม Hilight บางๆ ให้ดูชัดเจน สบายตา โดยวงเผื่อขอบพอดีๆ (ไม่เบียดชิดเกินไป และไม่ยาวเกินไป)
        pad_x = max(5, int(round(2.8 * scale)) + 1)
        pad_y = max(5, int(round(2.8 * scale)) + 1)
        stroke = max(2, int(round(1.2 * scale)))

        # คำนวณพิกัดที่มีการเผื่อขอบ (Padding)
        padded_boxes = []
        for (bx1, by1, bx2, by2) in merged_boxes:
            x1 = max(0, bx1 - pad_x)
            y1 = max(0, by1 - pad_y)
            x2 = min(width - 1, bx2 + pad_x)
            y2 = min(height - 1, by2 + pad_y)
            padded_boxes.append([x1, y1, x2, y2])

        # ถ้าวงแดงแตะโดนกันหรือซ้อนทับกัน ให้รวมเป็นก้อนเดียวกันเลย
        touch_dist = max(stroke + 1, int(round(1.5 * scale)))
        final_boxes = merge_touching_boxes(padded_boxes, touch_dist=touch_dist)

        result_vis = np.array(img_a)
        result_vis = cv2.cvtColor(result_vis, cv2.COLOR_RGB2BGR)

        # ไฮไลต์สีแดงโปร่งแสง 8% ภายในกล่อง
        overlay = result_vis.copy()
        for (x1, y1, x2, y2) in final_boxes:
            cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 0, 255), -1)
        cv2.addWeighted(overlay, 0.08, result_vis, 0.92, 0, result_vis)

        # วาดเส้นขอบสีแดงล้อมรอบกล่อง
        for (x1, y1, x2, y2) in final_boxes:
            cv2.rectangle(result_vis, (x1, y1), (x2, y2), (0, 0, 255), stroke)

        diff_count = len(final_boxes)
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
            except Exception:
                pass

        try:

            fr = db.execute(text("SELECT name FROM flows WHERE id = :fid"), {"fid": flow_id}).fetchone()
            if fr:
                flow_name = fr[0]

            mismatch_threshold = 30.0
            config_mismatch = db.execute(text("SELECT value FROM system_configs WHERE key = 'mismatch_threshold_percent'")).fetchone()
            if config_mismatch and config_mismatch[0]:
                try:
                    mismatch_threshold = float(config_mismatch[0])
                except ValueError:
                    pass

            page_sim_threshold = 0.60
            config_page_sim = db.execute(text("SELECT value FROM system_configs WHERE key = 'page_similarity_threshold'")).fetchone()
            if config_page_sim and config_page_sim[0]:
                try:
                    page_sim_threshold = float(config_page_sim[0])
                except ValueError:
                    pass

            masks_rows = db.execute(text("SELECT type, x, y, width, height, page_id FROM masks WHERE flow_id = :fid"), {"fid": flow_id}).fetchall()

            p_rows = db.execute(text("SELECT id, page_name, sort_order, image_path FROM pages WHERE flow_id = :fid ORDER BY sort_order ASC, id ASC"), {"fid": flow_id}).fetchall()

            dept_row = db.execute(text("""
                SELECT COALESCE(s_folder.department_id, s_direct.department_id)
                FROM flows f
                LEFT JOIN flow_folders ff ON f.folder_id = ff.id
                LEFT JOIN squads s_folder ON ff.squad_id = s_folder.id
                LEFT JOIN squads s_direct ON f.squad_id = s_direct.id
                WHERE f.id = :fid
            """), {"fid": flow_id}).fetchone()
            dept_id = dept_row[0] if (dept_row and dept_row[0]) else None
            if not dept_id and "department_id" in meta:
                dept_id = meta.get("department_id")

            pages_map = {}
            pages_ordered = []
            page_path_map = {}
            for p in p_rows:
                pid = p[0]
                pname = str(p[1])
                porder = p[2] if len(p) > 2 and p[2] is not None else 999
                pimg = str(p[3]) if len(p) > 3 and p[3] else None

                pname_clean = pname.lower().strip()
                pages_map[pid] = pname
                page_sort_map[pname_clean] = porder
                pages_ordered.append(pname_clean)
                if pimg:
                    page_path_map[pname_clean] = pimg
                    img_base = os.path.splitext(os.path.basename(pimg))[0].lower().strip()
                    page_path_map[img_base] = pimg
                    if img_base not in page_sort_map:
                        page_sort_map[img_base] = porder

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

        try:
            requests.post("http://backend:8000/api/v1/jobs/notify_progress", json={  # NOSONAR
                "job_id": job_id_str, "department_id": dept_id,
                "progress": {"current": 0, "total": total_files, "percent": 0}
            }, timeout=1)
        except Exception: pass

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

            # Master file resolution:
            # 1. Look up via page_path_map (from DB page.image_path)
            ref_src = None
            if ref_page_name and ref_page_name in page_path_map and page_path_map[ref_page_name]:
                candidate = os.path.join("/app/output", page_path_map[ref_page_name].lstrip("/"))
                if os.path.exists(candidate):
                    ref_src = candidate

            # 2. Fallback to ref_lookup directory scanning
            if not ref_src and ref_page_name:
                ref_src = ref_lookup.get(ref_page_name)
            if not ref_src and fname_no_ext:
                ref_src = ref_lookup.get(fname_no_ext)
            if not ref_src and fname_key:
                ref_src = ref_lookup.get(fname_key)

            if ref_src:
                p_b_in_job = os.path.join(dir_b, filename)
                shutil.copy2(ref_src, p_b_in_job)
                current_masks = global_masks.copy()
                if ref_page_name in page_masks_map: current_masks.extend(page_masks_map[ref_page_name])

                status, count = compare_images_and_save(p_a, p_b_in_job, p_diff, masks=current_masks, enable_alignment=enable_alignment, mismatch_threshold_percent=mismatch_threshold, page_similarity_threshold=page_sim_threshold)
                results.append({"filename": filename, "status": status, "diff_count": count})

            try:
                requests.post("http://backend:8000/api/v1/jobs/notify_progress", json={  # NOSONAR
                    "job_id": job_id_str, "department_id": dept_id,
                    "progress": {"current": idx + 1, "total": total_files, "percent": round(((idx + 1) / total_files) * 100)}
                }, timeout=1)
            except Exception: pass

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
        except Exception: pass

        return job_id_str

    except Exception as e:
        traceback.print_exc()
        job.status = "FAILED"
        job.error_message = str(e)
        job.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        try: requests.post("http://backend:8000/api/v1/jobs/notify", json={"job_id": job.job_id_str, "status": "FAILED"}, timeout=2)  # NOSONAR
        except Exception: pass
        raise self.retry(exc=e)

    finally:
        db.close()