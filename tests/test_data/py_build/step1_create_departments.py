"""
Step 1: Create 50 Departments (1A - 50A)

Usage: python step1_create_departments.py
"""
import requests
from config import *

def main():
    headers = auth_headers(content_json=True)
    created = 0
    skipped = 0

    for i in range(1, DEPT_COUNT + 1):
        name = dept_name(i)
        res = requests.post(f"{BASE_URL}/api/v1/org/departments", json={"name": name}, headers=headers)

        if res.status_code == 200:
            print(f"  ✅ Created department: {name} (id={res.json()['id']})")
            created += 1
        elif res.status_code == 400 and "มีอยู่แล้ว" in res.text:
            print(f"  ⏭️  Skipped department: {name} (already exists)")
            skipped += 1
        else:
            print(f"  ❌ Failed department: {name} — {res.status_code} {res.text}")

    print(f"\n🏁 Done! Created: {created}, Skipped: {skipped}")

if __name__ == "__main__":
    main()
