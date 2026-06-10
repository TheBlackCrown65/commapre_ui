import os
import subprocess
import argparse
import sys
import zipfile

## Run
   # python deploy.py --db ubuntu
# --- Config ---
REMOTE_HOST = "ronnakorn@34.15.136.254"
SSH_KEY = os.path.expanduser(r"~/.ssh/google_cloud/id_rsa")
DESKTOP_PATH = os.path.expanduser(r"~/Desktop")
PROJECT_DIR = os.path.join(DESKTOP_PATH, "robot_verify")
ZIP_PATH = os.path.join(DESKTOP_PATH, "robot_verify.zip")
BACKUP_SQL_PATH = os.path.join(PROJECT_DIR, "backup.sql")

def run_cmd(cmd, shell=True):
    print(f"👉 Running: {cmd}")
    result = subprocess.run(cmd, shell=shell)
    if result.returncode != 0:
        print(f"❌ Error executing: {cmd}")
        sys.exit(1)

def run_ssh(commands):
    cmd_str = " && ".join(commands)
    ssh_cmd = f'ssh -i "{SSH_KEY}" {REMOTE_HOST} "{cmd_str}"'
    print(f"📡 Executing remote commands...")
    result = subprocess.run(ssh_cmd, shell=True)
    if result.returncode != 0:
        print(f"❌ Error executing remote SSH commands")
        sys.exit(1)

def zip_project(include_output=False):
    print(f"📦 Zipping project (Include 'output' folder: {include_output})...")
    if os.path.exists(ZIP_PATH):
        try: os.remove(ZIP_PATH)
        except: pass
        
    parent_dir = os.path.dirname(PROJECT_DIR)
    
    with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(PROJECT_DIR):
            exclude_dirs = ['.git', 'node_modules', 'venv', '__pycache__', '.pytest_cache']
            if not include_output:
                exclude_dirs.append('output')
                
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if file.endswith('.zip') or file in ['backup.sql', 'db.sqlite3']:
                    continue
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, parent_dir)
                zipf.write(file_path, rel_path)
    print("✅ Zipping complete!")

def main():
    parser = argparse.ArgumentParser(description="Deploy Robot Verify to Ubuntu Server")
    parser.add_argument("--db", choices=["windows", "ubuntu"], default="windows", 
                        help="Choose database: 'windows' (wipe & upload local DB) OR 'ubuntu' (keep remote DB data)")
    parser.add_argument("--skip-zip", action="store_true", help="Skip zipping process if you already have robot_verify.zip")
    
    args = parser.parse_args()

    print(f"🚀 Starting Clean Deployment (Target DB: {args.db})...")
    
    if not args.skip_zip:
        zip_project(include_output=(args.db == "windows"))

    if args.db == "windows":
        print("💾 Dumping Windows local database (Safe UTF-8 mode)...")
        with open(BACKUP_SQL_PATH, "wb") as f:
            subprocess.run(['docker', 'exec', 'robot_verify-db-1', 'pg_dump', '-U', 'robot_user', 'robot_verify_db'], stdout=f)

    print("📤 Uploading robot_verify.zip to Ubuntu server...")
    run_cmd(f'scp -i "{SSH_KEY}" "{ZIP_PATH}" {REMOTE_HOST}:~/')

    if args.db == "windows":
        print("📤 Uploading backup.sql to Ubuntu server...")
        run_cmd(f'scp -i "{SSH_KEY}" "{BACKUP_SQL_PATH}" {REMOTE_HOST}:~/')

    print("🌐 Connecting to Server for Clean Build...")
    
    ssh_commands = [
        "cd ~/robot_verify/robot_verify || true",
    ]
    
    if args.db == "windows":
        ssh_commands.append("sudo docker compose down -v --rmi all --remove-orphans || true")
    else:
        ssh_commands.append("sudo docker compose down --rmi all --remove-orphans || true")
        
    ssh_commands.extend([
        "cd ~",
        "echo '📦 สำรองโฟลเดอร์รูปภาพ (output) บน Server ก่อนทำการลบโค้ดเก่า...'",
        "sudo cp -r ~/robot_verify/robot_verify/output ~/output_backup || true",
        "sudo rm -rf ~/robot_verify",
        "unzip -o ~/robot_verify.zip -d ~/robot_verify/",
        "echo '♻️ กำลังจัดการโฟลเดอร์รูปภาพ...'",
        "sudo mkdir -p ~/robot_verify/robot_verify/output",
        "sudo cp -a ~/output_backup/. ~/robot_verify/robot_verify/output/ || true",
        "sudo rm -rf ~/output_backup",
        "cd ~/robot_verify/robot_verify",
        "sudo docker builder prune -af",          
        "sudo docker compose build --no-cache --pull",   
        "sudo docker compose up -d --force-recreate -V"  
    ])

    if args.db == "windows":
        ssh_commands.extend([
            "echo '⏳ Waiting 15 seconds for DB to wake up...'",
            "sleep 15",
            "echo '📥 Importing database backup...'",
            "cat ~/backup.sql | sudo docker compose exec -T db psql -U robot_user -d robot_verify_db",
            "sudo rm ~/backup.sql"
        ])
        
    run_ssh(ssh_commands)
    
    if os.path.exists(BACKUP_SQL_PATH):
        try: os.remove(BACKUP_SQL_PATH)
        except: pass

    print("🎉 Deployment Completed Successfully! 100% Clean Code applied.")

if __name__ == "__main__":
    main()