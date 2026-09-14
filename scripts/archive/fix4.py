import os
import subprocess

# 1. Pull the file from the old image
out = subprocess.check_output(['docker', 'run', '--rm', '--entrypoint', 'cat', 'robot_verify_deployment-backend:latest', '/app/app/api/endpoints.py'])
content = out.decode('utf-8')
lines = content.splitlines()

new_lines = []
for i, line in enumerate(lines):
    new_lines.append(line)
    
    # Target 1: inside delete_folder
    if "job_id_strs = [j.job_id_str for j in jobs]" in line and "def delete_folder" in "".join(lines[max(0, i-40):i]):
        # We need to insert the check BEFORE this line
        # The indentation is 12 spaces.
        indent = "            "
        new_lines.pop() # remove the line
        new_lines.append(indent + 'active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]')
        new_lines.append(indent + 'if active_jobs:')
        new_lines.append(indent + '    raise HTTPException(status_code=400, detail="Cannot delete folder while jobs are QUEUED or PROCESSING")')
        new_lines.append(line) # put the line back
        
    # Target 2: inside delete_flow
    elif "job_id_strs = [j.job_id_str for j in jobs]" in line and "def delete_flow" in "".join(lines[max(0, i-10):i]):
        # We need to insert the check BEFORE this line
        # The indentation is 8 spaces.
        indent = "        "
        new_lines.pop() # remove the line
        new_lines.append(indent + 'active_jobs = [j for j in jobs if j.status in ["QUEUED", "PROCESSING"]]')
        new_lines.append(indent + 'if active_jobs:')
        new_lines.append(indent + '    raise HTTPException(status_code=400, detail="Cannot delete flow while jobs are QUEUED or PROCESSING")')
        new_lines.append(line) # put the line back

with open('backend/app/api/endpoints.py', 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines) + '\n')

print("Endpoints successfully patched and restored!")
