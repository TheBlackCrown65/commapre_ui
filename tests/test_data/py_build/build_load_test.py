"""
🚀 Run All Setup Steps (1-4) in sequence
==========================================
1. Create 50 Departments (1A - 50A)
2. Create 50 Squads (1T - 50T)
3. Create 50 Flows (1F - 50F) + Folders
4. Upload 50 reference images to each flow (parallel)

Usage: python build_load_test.py
       python build_load_test.py --34.15.136.254
"""
import time
import importlib

STEPS = [
    ("step1_create_departments", "Step 1: Create 50 Departments"),
    ("step2_create_squads",      "Step 2: Create 50 Squads"),
    ("step3_create_flows",       "Step 3: Create 50 Flows + Folders"),
    ("step4_upload_pages",       "Step 4: Upload Pages (parallel)"),
]

def main():
    total_start = time.time()
    print("=" * 60)
    print("🚀 SETUP ALL: Creating 50 Departments → Squads → Flows → Pages")
    print("=" * 60)

    for i, (module_name, label) in enumerate(STEPS, 1):
        print(f"\n{'─' * 60}")
        print(f"▶ [{i}/{len(STEPS)}] {label}")
        print(f"{'─' * 60}")

        step_start = time.time()
        module = importlib.import_module(module_name)
        module.main()
        elapsed = time.time() - step_start

        print(f"⏱  {label} completed in {elapsed:.1f}s")

    total = time.time() - total_start
    print(f"\n{'=' * 60}")
    print(f"✅ ALL DONE in {total:.1f}s ({total/60:.1f} min)")
    print(f"{'=' * 60}")

if __name__ == "__main__":
    main()
