"""
Step 3: Create 50 Flows (1F - 50F) — one per squad

Usage: python step3_create_flows.py
"""
import requests
from config import *

def main():
    headers = auth_headers(content_json=True)

    res = requests.get(f"{BASE_URL}/api/v1/org/departments", headers=headers)
    departments = res.json()

    squad_map = {}
    for dept in departments:
        for squad in dept.get("squads", []):
            squad_map[squad["name"]] = squad["id"]

    res = requests.get(f"{BASE_URL}/api/v1/folders", headers=headers)
    folders = res.json() if res.status_code == 200 else []
    folder_map = {(f["name"], f["squad_id"]): f["id"] for f in folders}

    res = requests.get(f"{BASE_URL}/api/v1/flows", headers=headers)
    flows = res.json() if res.status_code == 200 else []
    existing_flow_names = {f["name"] for f in flows}

    created_folders = 0
    created_flows = 0
    skipped = 0

    for i in range(1, DEPT_COUNT + 1):
        s_name = squad_name(i)
        f_name = flow_name(i)

        if s_name not in squad_map:
            print(f"  ❌ Squad {s_name} not found! Run step2 first.")
            continue

        squad_id = squad_map[s_name]
        folder_key = (f_name, squad_id)

        if folder_key not in folder_map:
            res = requests.post(f"{BASE_URL}/api/v1/folders", json={
                "name": f_name,
                "squad_id": squad_id
            }, headers=headers)
            if res.status_code == 200:
                folder_id = res.json()["id"]
                folder_map[folder_key] = folder_id
                created_folders += 1
                print(f"  📁 Created folder: {f_name} (id={folder_id})")
            else:
                print(f"  ❌ Failed folder: {f_name} — {res.status_code} {res.text}")
                continue
        else:
            folder_id = folder_map[folder_key]

        if f_name in existing_flow_names:
            print(f"  ⏭️  Skipped flow: {f_name} (already exists)")
            skipped += 1
            continue

        res = requests.post(f"{BASE_URL}/api/v1/flows", json={
            "name": f_name,
            "folder_id": folder_id
        }, headers=headers)

        if res.status_code == 200:
            print(f"  ✅ Created flow: {f_name} (id={res.json()['id']})")
            created_flows += 1
            existing_flow_names.add(f_name)
        else:
            print(f"  ❌ Failed flow: {f_name} — {res.status_code} {res.text}")

    print(f"\n🏁 Done! Folders: {created_folders}, Flows: {created_flows}, Skipped: {skipped}")

if __name__ == "__main__":
    main()
