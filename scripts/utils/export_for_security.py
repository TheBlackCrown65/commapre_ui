import os
import zipfile
import fnmatch

def create_security_export():
    output_filename = 'robot_verify_security_scan.zip'
    
    # โฟลเดอร์และไฟล์ที่ไม่ควรเอาไปให้ทีม Security สแกน (ลด False Positive และลดขนาดไฟล์)
    exclude_patterns = [
        # Version Control
        '.git*',
        
        # IDE / Editor
        '.vscode*',
        '.agent*',
        '.gemini*',
        '.cursor*',
        
        # Python
        '__pycache__*',
        '*.pyc',
        'venv*',
        'env*',
        '.pytest_cache*',
        
        # Node / Frontend
        'node_modules*',
        'dist*',
        'build*',
        
        # Database & Docker Volumes
        'data',
        'pg_data',
        'redis_data',
        
        # Generated Files & Secrets
        'output*',
        '.env',         # เราจะส่งไปแค่ .env.example
        '*.zip',        # ป้องกันการ zip ตัวมันเอง
        '*.log',
    ]

    print(f"📦 กำลังแพ็คไฟล์โปรเจกต์ลงใน: {output_filename}")
    
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk('.'):
            # กรองโฟลเดอร์ที่ไม่ต้องการออก (Modify dirs in-place)
            dirs[:] = [d for d in dirs if not any(fnmatch.fnmatch(d, pat) for pat in exclude_patterns)]
            
            for file in files:
                if any(fnmatch.fnmatch(file, pat) for pat in exclude_patterns):
                    continue
                
                # ถ้าเป็น export_for_security.py ก็ไม่ต้องแพ็คไปด้วย
                if file == 'export_for_security.py':
                    continue

                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, '.')
                zipf.write(file_path, arcname)
                print(f"  + Added: {arcname}")

    print("\n✅ เสร็จสิ้น! คุณสามารถนำไฟล์", output_filename, "ส่งให้ทีม Security ได้เลยครับ")

if __name__ == '__main__':
    create_security_export()
