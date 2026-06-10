"""Server-side PDF export for Jenkins/CI pipelines.
This module generates PDF reports with the same layout as the frontend,
reading images directly from the Docker filesystem."""

import os
import io
import re
import json

from PIL import Image
from fastapi import HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .database import get_db
from .models import Job
from .core.deps import get_current_user
from .core.audit_logger import log_action


def register_pdf_export(app):
    """Register the PDF export endpoint on the FastAPI app."""

    @app.get("/api/v1/jobs/{job_id}/export/pdf")
    def export_job_pdf(
        job_id: str,
        request: Request,
        current_user=Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        """Server-side PDF generation for Jenkins/CI pipelines.
        Images are read directly from the filesystem inside Docker."""
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.pdfgen import canvas as pdf_canvas
        from reportlab.lib.utils import ImageReader
        from reportlab.lib.colors import HexColor

        job_dir = f"/app/output/jobs/{job_id}"
        report_path = os.path.join(job_dir, "report.json")

        if not os.path.exists(job_dir):
            raise HTTPException(status_code=404, detail="Job not found")

        db_job = db.query(Job).filter(Job.job_id_str == str(job_id)).first()
        flow_name = db_job.flow.name if db_job and db_job.flow else "job"
        status = db_job.status if db_job else "COMPLETED"

        if status in ["QUEUED", "PROCESSING"]:
            raise HTTPException(
                status_code=409, detail="Job is still processing"
            )

        # Load report results
        results = []
        if os.path.exists(report_path):
            try:
                with open(report_path, "r") as f:
                    results = json.load(f)
            except Exception:
                pass

        if not results:
            device_a_path = os.path.join(job_dir, "device_a")
            if os.path.exists(device_a_path):
                files_list = [
                    f
                    for f in os.listdir(device_a_path)
                    if f.lower().endswith((".png", ".jpg", ".jpeg"))
                ]
                files_list.sort()
                results = [
                    {"filename": f, "status": "DONE", "diff_count": 0}
                    for f in files_list
                ]

        if not results:
            raise HTTPException(status_code=404, detail="No results found")

        # Generate PDF
        buf = io.BytesIO()
        cvs = pdf_canvas.Canvas(buf, pagesize=landscape(A4))
        pw, ph = landscape(A4)
        mg = 30

        # Colors (matching frontend Tailwind palette)
        clr_pass = HexColor("#16a34a")  # green-600
        clr_fail = HexColor("#dc2626")  # red-600
        clr_warn = HexColor("#ca8a04")  # yellow-600
        clr_dark = HexColor("#1e293b")  # slate-800
        clr_gray = HexColor("#64748b")  # slate-500
        clr_light = HexColor("#e2e8f0")  # slate-200
        clr_bg = HexColor("#f8fafc")  # slate-50

        total = len(results)
        n_fail = sum(1 for r in results if r.get("status") == "FAIL")
        n_warn = sum(1 for r in results if r.get("status") == "WARNING")
        n_pass = total - n_fail - n_warn
        n_diff = sum(
            r.get("diff_count", 0)
            for r in results
            if r.get("diff_count", 0) > 0
        )

        # ======= PAGE 1: Summary =======
        # Dark header bar
        cvs.setFillColor(clr_dark)
        cvs.rect(0, ph - 80, pw, 80, fill=1, stroke=0)
        cvs.setFillColor(HexColor("#ffffff"))
        cvs.setFont("Helvetica-Bold", 22)
        cvs.drawString(mg, ph - 50, "Robot Verify - Test Report")
        cvs.setFont("Helvetica", 12)
        cvs.drawString(mg, ph - 70, f"Job #{job_id}  |  Flow: {flow_name}")

        # Background
        cvs.setFillColor(clr_bg)
        cvs.rect(0, 0, pw, ph - 80, fill=1, stroke=0)

        # Summary cards
        card_y = ph - 180
        card_w = (pw - mg * 2 - 40) / 4
        card_h = 70

        def draw_card(x, y, label, value, color):
            cvs.setFillColor(HexColor("#ffffff"))
            cvs.roundRect(x, y, card_w, card_h, 6, fill=1, stroke=0)
            cvs.setStrokeColor(clr_light)
            cvs.setLineWidth(0.5)
            cvs.roundRect(x, y, card_w, card_h, 6, fill=0, stroke=1)
            cvs.setFillColor(color)
            cvs.setFont("Helvetica-Bold", 28)
            cvs.drawCentredString(
                x + card_w / 2, y + card_h - 30, str(value)
            )
            cvs.setFillColor(clr_gray)
            cvs.setFont("Helvetica-Bold", 9)
            cvs.drawCentredString(x + card_w / 2, y + 12, label.upper())

        draw_card(mg, card_y, "Total Files", total, clr_dark)
        draw_card(mg + card_w + 13, card_y, "Passed", n_pass, clr_pass)
        draw_card(
            mg + (card_w + 13) * 2, card_y, "Failed", n_fail, clr_fail
        )
        draw_card(
            mg + (card_w + 13) * 3,
            card_y,
            "Diff Points",
            n_diff,
            HexColor("#2563eb"),
        )
        cvs.showPage()

        # ======= PAGE 2+: Per-file comparison =======
        for idx, r in enumerate(results):
            fname = r.get("filename", "")
            fstatus = r.get("status", "DONE")
            fdiff = r.get("diff_count", 0)

            # Page background
            cvs.setFillColor(clr_bg)
            cvs.rect(0, 0, pw, ph, fill=1, stroke=0)

            # 💡 ปรับลด Margin เฉพาะหน้าที่ 2 เป็นต้นไป เพื่อให้รูปขยายได้ใหญ่ที่สุด
            p2_mg = 15        # เดิม 30 -> ลด Margin ซ้ายขวาให้ชิดขอบ
            p2_gap = 5        # เดิม 10 -> ลดช่องว่างระหว่าง 3 รูป
            
            # Status-colored header bar
            if fstatus == "FAIL":
                bar_c, bdr_c = HexColor("#fef2f2"), clr_fail
            elif fstatus == "WARNING":
                bar_c, bdr_c = HexColor("#fefce8"), clr_warn
            else:
                bar_c, bdr_c = HexColor("#f0fdf4"), clr_pass

            cvs.setFillColor(bar_c)
            cvs.rect(p2_mg, ph - 45, pw - p2_mg * 2, 30, fill=1, stroke=0)
            cvs.setStrokeColor(bdr_c)
            cvs.setLineWidth(2)
            cvs.line(p2_mg, ph - 45, p2_mg, ph - 15)

            # File name
            cvs.setFillColor(clr_dark)
            cvs.setFont("Helvetica-Bold", 12)
            cvs.drawString(p2_mg + 8, ph - 37, f"File: {fname}")

            # Status badge
            if fstatus == "FAIL":
                cvs.setFillColor(clr_fail)
                badge = f"FAIL - {fdiff} Spots"
            elif fstatus == "WARNING":
                cvs.setFillColor(clr_warn)
                badge = "WARNING - OCR Mismatch"
            else:
                cvs.setFillColor(clr_pass)
                badge = "PASS"

            cvs.setFont("Helvetica-Bold", 10)
            cvs.drawRightString(pw - p2_mg - 8, ph - 37, f"[ {badge} ]")

            # Page counter
            cvs.setFillColor(clr_gray)
            cvs.setFont("Helvetica", 8)
            cvs.drawRightString(pw - p2_mg, ph - 7, f"({idx + 1}/{total})")

            # 💡 คำนวณความสูงใหม่ เพื่อให้รูปใหญ่ทะลุจอ
            img_top = ph - 55  # เดิม 65 -> ดันหัวรูปขึ้นไปให้ชิด Header
            img_bot = 15       # เดิม 30 -> ดันขอบล่างให้ชิดสุดกระดาษ
            
            colw = (pw - p2_mg * 2 - p2_gap * 2) / 3
            imgh = img_top - img_bot - 15

            columns = [
                ("device_b", "Reference (Master)"),
                ("device_a", "New Image"),
                ("diff", "Difference"),
            ]

            for ci, (folder, label) in enumerate(columns):
                x = p2_mg + ci * (colw + p2_gap)
                cvs.setFillColor(clr_gray)
                cvs.setFont("Helvetica-Bold", 9)
                cvs.drawString(x, img_top, label)

                ipath = os.path.join(job_dir, folder, fname)
                if os.path.exists(ipath):
                    try:
                        # 💡 ท่าไม้ตาย! ลดขนาดไฟล์ PDF ด้วย PIL (Pillow) ก่อนโยนเข้า ReportLab
                        with Image.open(ipath) as pil_img:
                            # 1. ลบ Alpha Channel (ความโปร่งใส) ทิ้ง เพื่อให้เซฟเป็น JPEG ได้
                            if pil_img.mode in ("RGBA", "P", "LA"):
                                pil_img = pil_img.convert("RGB")
                            
                            # 2. ถ้ารูปสูงเกิน 1200px ให้ย่อลงมา (ความสูง 1200 ชัดระดับ Retina แล้วในกระดาษ A4)
                            MAX_HEIGHT = 1200
                            orig_w, orig_h = pil_img.size
                            if orig_h > MAX_HEIGHT:
                                ratio = MAX_HEIGHT / float(orig_h)
                                new_w = int(orig_w * ratio)
                                # ใช้ LANCZOS รักษาความคมชัดของตัวอักษรไว้ให้กริ๊บที่สุด
                                pil_img = pil_img.resize((new_w, MAX_HEIGHT), Image.Resampling.LANCZOS)
                            
                            # 3. เซฟลง Memory เป็น JPEG (Quality 85 จะทำให้ไฟล์เล็กจิ๋ว แต่ตาคนแยกไม่ออกว่าแตก)
                            img_buffer = io.BytesIO()
                            pil_img.save(img_buffer, format="JPEG", quality=85, optimize=True)
                            img_buffer.seek(0)
                            
                            # ส่งรูปที่ถูกบีบอัดแล้วให้ ReportLab วาด
                            ir = ImageReader(img_buffer)
                            
                        iw, ih = ir.getSize()
                        sc = min(colw / iw, imgh / ih)
                        dw, dh = iw * sc, ih * sc
                        dx = x + (colw - dw) / 2
                        dy = img_top - 12 - dh
                        
                        cvs.drawImage(
                            ir, dx, dy,
                            width=dw, height=dh,
                            preserveAspectRatio=True,
                        )
                        cvs.setStrokeColor(clr_light)
                        cvs.setLineWidth(0.5)
                        cvs.rect(dx, dy, dw, dh, fill=0, stroke=1)
                    except Exception:
                        _draw_placeholder(
                            cvs, x, img_bot, colw, imgh,
                            clr_light, clr_gray, "Image Error"
                        )
                else:
                    _draw_placeholder(
                        cvs, x, img_bot, colw, imgh,
                        clr_light, clr_gray, "No Image"
                    )

            cvs.showPage()

        cvs.save()
        buf.seek(0)
        buf.seek(0)

        # Build safe filename
        sfn = re.sub(r"[^\w\s-]", "", flow_name).strip()
        sfn = re.sub(r"[-\s]+", "_", sfn) or "job"
        pdf_filename = f"{sfn}_{job_id}.pdf"

        log_action(
            user=current_user.username,
            event="DATA_EXPORTED",
            details=f"type=pdf, job_id={job_id}, filename={pdf_filename}",
            level="INFO",
            module="ExportService",
            request=request,
        )

        return StreamingResponse(
            buf,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{pdf_filename}"'
            },
        )


def _draw_placeholder(cvs, x, y, w, h, stroke_color, text_color, text):
    """Draw a gray placeholder box when an image is missing or broken."""
    from reportlab.lib.colors import HexColor

    cvs.setFillColor(HexColor("#f5f5f5"))
    cvs.rect(x, y, w, h, fill=1, stroke=0)
    cvs.setStrokeColor(stroke_color)
    cvs.rect(x, y, w, h, fill=0, stroke=1)
    cvs.setFillColor(text_color)
    cvs.setFont("Helvetica", 8)
    cvs.drawCentredString(x + w / 2, y + h / 2, text)
