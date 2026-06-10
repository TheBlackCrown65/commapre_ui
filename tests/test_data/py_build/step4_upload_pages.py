"""
Step 4: Upload 50 reference images to each flow (1F - 50F) — PARALLEL
        Images from: C:/Users/user/Desktop/load_test_master/

Usage: python step4_upload_pages.py
"""
import os
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from config import *

IMAGES_DIR = r"C:\Users\user\Desktop\load_test_master"
MAX_WORKERS = 10  # จำนวน threads พร้อมกัน (ไม่ควรเยอะเกินไปจะ overload server)


def upload_flow_pages(flow_id, f_name, image_files):
    """Upload all pages for one flow. Returns (flow_name, uploaded, skipped)."""
    headers = auth_headers()

    # Check existing pages
    res = requests.get(f"{BASE_URL}/api/v1/flows/{flow_id}", headers=auth_headers(content_json=True))
    existing_pages = set()
    if res.status_code == 200:
        existing_pages = {p["page_name"] for p in res.json().get("pages", [])}

    uploaded = 0
    skipped = 0

    for img_file in image_files:
        page_name = os.path.splitext(img_file)[0]

        if page_name in existing_pages:
            skipped += 1
            continue

        img_path = os.path.join(IMAGES_DIR, img_file)
        with open(img_path, "rb") as f:
            files = {"file": (img_file, f, "image/png")}
            data = {"flow_id": str(flow_id), "page_name": page_name}
            res = requests.post(f"{BASE_URL}/api/v1/pages", files=files, data=data, headers=headers)

        if res.status_code == 200:
            uploaded += 1
        else:
            print(f"    ❌ {f_name}/{page_name} — {res.status_code}")

    return f_name, flow_id, uploaded, skipped


def main():
    headers = auth_headers(content_json=True)

    res = requests.get(f"{BASE_URL}/api/v1/flows", headers=headers)
    flows = res.json() if res.status_code == 200 else []
    flow_map = {f["name"]: f["id"] for f in flows}

    image_files = sorted([f for f in os.listdir(IMAGES_DIR) if f.lower().endswith(('.png', '.jpg', '.jpeg'))])
    print(f"📷 Found {len(image_files)} images in {IMAGES_DIR}")

    if not image_files:
        print("❌ No images found!")
        return

    # Build task list
    tasks = []
    for i in range(1, DEPT_COUNT + 1):
        f_name = flow_name(i)
        if f_name in flow_map:
            tasks.append((flow_map[f_name], f_name))
        else:
            print(f"  ❌ Flow {f_name} not found! Run step3 first.")

    print(f"🚀 Uploading to {len(tasks)} flows in parallel ({MAX_WORKERS} threads)...\n")
    start = time.time()
    total_uploaded = 0
    total_skipped = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(upload_flow_pages, fid, fname, image_files): fname
            for fid, fname in tasks
        }

        done = 0
        for future in as_completed(futures):
            f_name, flow_id, uploaded, skipped = future.result()
            total_uploaded += uploaded
            total_skipped += skipped
            done += 1

            status = "⏭️  (all existed)" if uploaded == 0 and skipped > 0 else f"✅ {uploaded} uploaded"
            print(f"  [{done}/{len(tasks)}] {status} Flow {f_name} (id={flow_id})")

    elapsed = time.time() - start
    print(f"\n🏁 Done in {elapsed:.1f}s! Total uploaded: {total_uploaded}, Skipped: {total_skipped}")


if __name__ == "__main__":
    main()
