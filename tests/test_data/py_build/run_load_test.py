"""
🚀 Load Test: 50 Flows Compare Simultaneously
===============================================
Usage: python run_load_test.py --flows 10
       python run_load_test.py --flows 10 --34.15.136.254
"""
import os
import io
import time
import zipfile
import argparse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from config import *

COMPARE_DIR = r"C:\Users\user\Desktop\load_test_compare"
POLL_INTERVAL = 2  # seconds


def create_zip_buffer(folder_path):
    """Create an in-memory ZIP from a folder of images."""
    buf = io.BytesIO()
    image_files = sorted([f for f in os.listdir(folder_path) if f.lower().endswith(('.png', '.jpg', '.jpeg'))])
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for img in image_files:
            zf.write(os.path.join(folder_path, img), img)
    buf.seek(0)
    size_mb = len(buf.getvalue()) / (1024 * 1024)
    print(f"📦 ZIP created: {len(image_files)} images, {size_mb:.1f} MB")
    return buf.getvalue(), len(image_files)


def submit_job(flow_id, flow_name_str, zip_data, use_ocr, target_url):
    """Submit a compare job and return job info."""
    headers = auth_headers()
    start = time.time()

    try:
        res = requests.post(
            f"{target_url}/api/v1/jobs/compare",
            files={"file": ("compare.zip", zip_data, "application/zip")},
            data={"flow_id": str(flow_id), "use_ocr": "true" if use_ocr else "false"},
            headers=headers,
            timeout=60
        )

        elapsed = time.time() - start

        if res.status_code == 200:
            job_id = res.json().get("job_id")
            return {"flow": flow_name_str, "flow_id": flow_id, "job_id": job_id, "submit_time": elapsed, "status": "QUEUED"}
        else:
            return {"flow": flow_name_str, "flow_id": flow_id, "job_id": None, "submit_time": elapsed, "status": f"SUBMIT_FAILED ({res.status_code})", "error": res.text}

    except Exception as e:
        return {"flow": flow_name_str, "flow_id": flow_id, "job_id": None, "submit_time": time.time() - start, "status": "SUBMIT_ERROR", "error": str(e)}


def poll_job(job_id, target_url, timeout=1800):
    """Poll a job until COMPLETED or FAILED."""
    headers = auth_headers(content_json=True)
    start = time.time()

    while time.time() - start < timeout:
        try:
            res = requests.get(f"{target_url}/api/v1/jobs/{job_id}/status", headers=headers, timeout=10)
            if res.status_code == 200:
                data = res.json()
                status = data.get("status", "UNKNOWN")
                if status in ("COMPLETED", "FAILED"):
                    return status, time.time() - start
        except:
            pass

        time.sleep(POLL_INTERVAL)

    return "TIMEOUT", time.time() - start


def main():
    parser = argparse.ArgumentParser(description="Load Test: Flows compare simultaneously")
    parser.add_argument("--flows", type=int, default=50, help="Number of flows to test (default: 50)")
    parser.add_argument("--ocr", action="store_true", help="Enable OCR verification")
    parser.add_argument("--ip", type=str, help="Target server IP (e.g., 34.15.136.254)")
    args = parser.parse_args()

    num_flows = args.flows
    use_ocr = args.ocr
    
    # 🌟 กำหนดเป้าหมาย URL ถ้าใส่ --ip มา จะวิ่งไปที่ Server เลย
    target_url = f"http://{args.ip}:8001" if args.ip else BASE_URL

    print(f"{'='*60}")
    print(f"🚀 LOAD TEST: {num_flows} Flows")
    print(f"  Target URL:          {target_url}")
    print(f"  OCR Enabled:         {use_ocr}")
    print(f"{'='*60}")

    # Step 0: Get flow IDs
    headers = auth_headers(content_json=True)
    try:
        res = requests.get(f"{target_url}/api/v1/flows", headers=headers)
        all_flows = res.json() if res.status_code == 200 else []
    except Exception as e:
        print(f"❌ Could not connect to {target_url}. Error: {e}")
        return
        
    flow_map = {f["name"]: f["id"] for f in all_flows}

    test_flows = []
    for i in range(1, num_flows + 1):
        f_name = flow_name(i)
        if f_name in flow_map:
            test_flows.append((flow_map[f_name], f_name))

    if not test_flows:
        print("❌ No test flows found on server!")
        return

    print(f"📋 Found {len(test_flows)} flows to test")

    # Step 1: Create ZIP
    print(f"\n--- Step 1: Creating ZIP from {COMPARE_DIR} ---")
    zip_data, img_count = create_zip_buffer(COMPARE_DIR)

    # Step 2: Submit all jobs simultaneously
    print(f"\n--- Step 2: Submitting {len(test_flows)} jobs simultaneously ---")
    submit_start = time.time()
    job_results = []

    with ThreadPoolExecutor(max_workers=len(test_flows)) as executor:
        futures = {
            executor.submit(submit_job, fid, fname, zip_data, use_ocr, target_url): fname
            for fid, fname in test_flows
        }

        for future in as_completed(futures):
            result = future.result()
            job_results.append(result)
            status_icon = "✅" if result["status"] == "QUEUED" else "❌"
            print(f"  {status_icon} {result['flow']}: {result['status']} (submit: {result['submit_time']:.1f}s)" +
                  (f" job_id={result['job_id']}" if result['job_id'] else ""))

    submit_elapsed = time.time() - submit_start
    queued_jobs = [j for j in job_results if j["job_id"]]
    print(f"\n  📊 Submitted: {len(queued_jobs)}/{len(test_flows)} in {submit_elapsed:.1f}s")

    if not queued_jobs:
        return

    # Step 3: Poll all jobs until done
    print(f"\n--- Step 3: Waiting for {len(queued_jobs)} jobs to complete ---")
    poll_start = time.time()

    with ThreadPoolExecutor(max_workers=len(queued_jobs)) as executor:
        futures = {
            executor.submit(poll_job, j["job_id"], target_url): j
            for j in queued_jobs
        }

        completed = 0
        for future in as_completed(futures):
            job_info = futures[future]
            status, duration = future.result()
            job_info["final_status"] = status
            job_info["processing_time"] = duration
            completed += 1

            icon = "✅" if status == "COMPLETED" else "❌"
            print(f"  {icon} [{completed}/{len(queued_jobs)}] {job_info['flow']}: {status} in {duration:.1f}s")

    total_elapsed = time.time() - submit_start

    # Step 4: Report
    print(f"\n{'='*60}")
    print(f"📊 LOAD TEST RESULTS")
    print(f"{'='*60}")
    
    completed_jobs = [j for j in queued_jobs if j.get("final_status") == "COMPLETED"]
    
    print(f"  Jobs submitted:      {len(queued_jobs)}")
    print(f"  Jobs completed:      {len(completed_jobs)}")
    print(f"  Total time:          {total_elapsed:.1f}s")

if __name__ == "__main__":
    main()