"""
Step 2: Create 50 Squads (1T - 50T) — one per department

Usage: python step2_create_squads.py
"""
import requests
from config import *

def main():
    headers = auth_headers(content_json=True)

    res = requests.get(f"{BASE_URL}/api/v1/org/departments", headers=headers)
    if res.status_code != 200:
        print(f"❌ Failed to list departments: {res.status_code}")
        return

    departments = res.json()
    dept_map = {d["name"]: d["id"] for d in departments}

    created = 0
    skipped = 0

    for i in range(1, DEPT_COUNT + 1):
        d_name = dept_name(i)
        s_name = squad_name(i)

        if d_name not in dept_map:
            print(f"  ❌ Department {d_name} not found! Run step1 first.")
            continue

        dept_id = dept_map[d_name]

        existing_squads = [s["name"] for d in departments if d["name"] == d_name for s in d.get("squads", [])]
        if s_name in existing_squads:
            print(f"  ⏭️  Skipped squad: {s_name} (already exists in {d_name})")
            skipped += 1
            continue

        res = requests.post(f"{BASE_URL}/api/v1/org/squads", json={
            "name": s_name,
            "department_id": dept_id
        }, headers=headers)

        if res.status_code == 200:
            print(f"  ✅ Created squad: {s_name} in {d_name} (id={res.json()['id']})")
            created += 1
        else:
            print(f"  ❌ Failed squad: {s_name} — {res.status_code} {res.text}")

    print(f"\n🏁 Done! Created: {created}, Skipped: {skipped}")

if __name__ == "__main__":
    main()
