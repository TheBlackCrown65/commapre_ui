import os
import zipfile
import fnmatch

def create_deployment_export():
    # เปลี่ยน Path ไปที่ root ของโปรเจกต์ก่อนเริ่มทำงาน
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.chdir(project_root)
    
    output_filename = 'robot_verify_deployment.zip'
    
    # โฟลเดอร์และไฟล์ที่ไม่ควรเอาไป Deploy บนเครื่องใหม่ (เอาไปเฉพาะโค้ดและคอนฟิก)
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
        
        # Database & Docker Volumes (ขยะข้อมูลทดสอบ)
        'data',
        'pg_data',
        'redis_data',
        
        # CI/CD & Temporary scripts
        'Jenkinsfile',
        'sonar-project.properties',
        'fix*.py',
        'original_*.py',
        'recover.py',
        'scripts/archive*',
        '*.pdf',
        'sqlite.db',
        
        # Generated Files
        '*.zip',        # ป้องกันการ zip ตัวมันเอง
        '*.log',
    ]

    print(f"📦 กำลังแพ็คไฟล์โปรเจกต์ (Clean Version) ลงใน: {output_filename}")
    
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk('.'):
            # กรองโฟลเดอร์ที่ไม่ต้องการออก (Modify dirs in-place)
            dirs[:] = [d for d in dirs if not any(fnmatch.fnmatch(d, pat) for pat in exclude_patterns)]
            
            for file in files:
                if any(fnmatch.fnmatch(file, pat) for pat in exclude_patterns):
                    continue
                
                # จัดการโฟลเดอร์ output: เคลียร์ข้อมูลในโฟลเดอร์ย่อยทั้งหมดแต่เก็บโครงสร้างไว้
                if 'output' in root.split(os.sep):
                    output_subdirs = ['jobs', 'references', 'zips']
                    if any(subdir in root.split(os.sep) for subdir in output_subdirs):
                        if file != '.gitkeep':
                            continue
                
                # ข้ามไฟล์นี้เอง
                if file == 'export_for_deployment.py':
                    continue

                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, '.')
                zipf.write(file_path, arcname)
                print(f"  + Added: {arcname}")

    print("\n✅ เสร็จสิ้น! คุณสามารถนำไฟล์", output_filename, "ไปแตกไฟล์ที่เครื่อง Mac Mini แล้วรัน docker-compose up -d ได้เลยครับ")

if __name__ == '__main__':
    create_deployment_export()
