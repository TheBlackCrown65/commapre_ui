import sys
import os
import json
import urllib.request
import urllib.parse
from io import BytesIO

try:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader
except ImportError:
    print("❌ Error: Please install required libraries by running:")
    print("   pip install reportlab pillow")
    sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print("Usage: python save_pdf.py <job_id>")
        sys.exit(1)
        
    job_id = sys.argv[1]
    output_pdf = f"api_report_{job_id}.pdf"
    
    # 💡 ใช้ API_URL จาก Jenkins Environment
    api_url = os.environ.get("API_URL", "http://127.0.0.1:8000/api/v1")
    base_output_url = api_url.replace("/api/v1", "") + "/output/jobs"
    api_key = os.environ.get("API_KEY", "")
    
    print(f"Fetching data for Job ID: {job_id}...")
    
    # 💡 FIX: เพิ่ม User-Agent เพื่อหลบการบล็อกของ Firewall / Cloudflare บน Production
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    
    # 1. ดึงข้อมูล Job Detail จาก API โดยตรง
    try:
        req = urllib.request.Request(f"{api_url}/jobs/{job_id}", headers=headers)
        with urllib.request.urlopen(req) as response:
            job_data = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP Error: {e.code} - {e.reason}")
        print(f"Server Response: {e.read().decode('utf-8')}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Failed to fetch job data: {e}")
        sys.exit(1)
        
    results = job_data.get("results", [])
    if not results and "files" in job_data:
        results = [{"filename": f, "status": "DONE", "diff_count": 0} for f in job_data["files"]]
        
    print(f"Generating PDF for {len(results)} images...")
    
    # 2. สร้างไฟล์ PDF ด้วย ReportLab
    c = canvas.Canvas(output_pdf, pagesize=landscape(A4))
    width, height = landscape(A4)
    margin = 30
    
    # --- หน้า 1: Summary ---
    c.setFont("Helvetica-Bold", 24)
    c.drawString(margin, height - 60, f"Robot Verify - Test Report #{job_id}")
    
    total = len(results)
    failed = sum(1 for r in results if r.get('status') == 'FAIL')
    passed = total - failed
    
    c.setFont("Helvetica", 16)
    c.drawString(margin, height - 120, f"Total Files: {total}")
    c.setFillColorRGB(0, 0.6, 0)
    c.drawString(margin, height - 150, f"Passed: {passed}")
    c.setFillColorRGB(0.8, 0, 0)
    c.drawString(margin, height - 180, f"Failed: {failed}")
    c.showPage()
    
    # --- หน้าต่อๆ ไป: วาดรูปทีละไฟล์ ---
    for r in results:
        fname = r.get("filename", "")
        status = r.get("status", "DONE")
        diff = r.get("diff_count", 0)
        
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(margin, height - margin, f"File: {fname}")
        
        if status == "FAIL":
            c.setFillColorRGB(0.8, 0, 0)
            c.drawString(margin + 400, height - margin, f"[ FAIL - {diff} Spots ]")
        elif status == "WARNING":
            c.setFillColorRGB(0.8, 0.5, 0)
            c.drawString(margin + 400, height - margin, f"[ WARNING - OCR ]")
        else:
            c.setFillColorRGB(0, 0.6, 0)
            c.drawString(margin + 400, height - margin, f"[ PASS ]")
            
        # ฟังก์ชันวาดรูป 3 คอลัมน์
        def draw_img(folder, x_pos, title):
            c.setFillColorRGB(0.3, 0.3, 0.3)
            c.setFont("Helvetica-Bold", 10)
            c.drawString(x_pos, height - 70, title)
            
            img_url = f"{base_output_url}/{job_id}/{folder}/{fname}"
            try:
                img_url_safe = urllib.parse.quote(img_url, safe=':/')
                # 💡 แนบ Header ใส่รูปภาพด้วย
                img_req = urllib.request.Request(img_url_safe, headers=headers)
                    
                with urllib.request.urlopen(img_req) as img_resp:
                    img_data = BytesIO(img_resp.read())
                    img = ImageReader(img_data)
                    c.drawImage(img, x_pos, 40, width=240, height=430, preserveAspectRatio=True, anchor='sw')
            except Exception as ex:
                print(f"Warning: Could not load image {img_url} - {ex}")
                c.setFillColorRGB(0.9, 0.9, 0.9)
                c.rect(x_pos, 40, 240, 430, fill=1)
                c.setFillColorRGB(0, 0, 0)
                c.drawString(x_pos + 80, 250, "Image Error")

        # สั่งวาด Master, New, Diff
        draw_img("device_b", margin, "Reference (Master)")
        draw_img("device_a", margin + 260, "New Image")
        draw_img("diff", margin + 520, "Difference")
        
        c.showPage()
        
    c.save()
    print(f"✅ Successfully generated PDF: {output_pdf}")

if __name__ == "__main__":
    main()