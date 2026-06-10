"""
Step 5: Delete all test departments (1A - 50A)

Usage: python cleanup.py
       python cleanup.py --34.15.136.254
"""
import requests
from config import *

def main():
    headers = auth_headers(content_json=True)

    res = requests.get(f"{BASE_URL}/api/v1/org/departments", headers=headers)
    departments = res.json() if res.status_code == 200 else []

    test_depts = [d for d in departments if d["name"] in [dept_name(i) for i in range(1, DEPT_COUNT + 1)]]

    if not test_depts:
        print("⚠️  No test departments found (1A - 50A). Nothing to delete.")
        return

    print(f"🗑️  Found {len(test_depts)} test departments to delete:")
    for d in test_depts:
        squad_count = len(d.get("squads", []))
        print(f"  - {d['name']} (id={d['id']}, {squad_count} squads)")

    confirm = input(f"\n⚠️  Delete ALL {len(test_depts)} departments? This cannot be undone! (yes/no): ")
    if confirm.lower() != "yes":
        print("❌ Cancelled.")
        return

    deleted = 0
    for d in test_depts:
        res = requests.delete(f"{BASE_URL}/api/v1/org/departments/{d['id']}", headers=headers)
        if res.status_code == 200:
            print(f"  ✅ Deleted: {d['name']}")
            deleted += 1
        else:
            print(f"  ❌ Failed: {d['name']} — {res.status_code} {res.text}")

    print(f"\n🏁 Done! Deleted: {deleted}/{len(test_depts)} departments")

if __name__ == "__main__":
    main()
