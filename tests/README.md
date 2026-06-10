# 🧪 Performance Testing Guide

## Prerequisites

1. **k6** ติดตั้งแล้ว (`winget install k6 --source winget`)
2. **Python 3** + **Pillow** สำหรับสร้าง test data
3. **ระบบกำลังทำงาน** (`docker compose up -d`)
4. **Flow ที่มี reference images** อยู่ในระบบ

---

## Step 1: สร้าง Test Data

```powershell
# สร้าง ZIP ที่มี 10 pages
python tests/generate_test_data.py --pages 10

# สร้าง ZIP ที่มี 50 pages
python tests/generate_test_data.py --pages 50

# สร้าง ZIP ที่มี 50 pages ขนาดเล็กลง (เร็วขึ้น)
python tests/generate_test_data.py --pages 50 --width 540 --height 960
```

ไฟล์จะอยู่ที่ `tests/test_data/`

---

## Step 2: เตรียม API Key

สร้าง API Key ที่หน้า API Keys ในระบบ หรือใช้ JWT token จาก login

---

## Step 3: รัน Load Test

### 🟢 Debug (1 request)
```powershell
k6 run tests/load_test.js --env SCENARIO=single --env FLOW_ID=1 --env API_KEY=your_api_key_here
```

### 🟡 Baseline (1 user × 3 iterations)
```powershell
k6 run tests/load_test.js --env FLOW_ID=1 --env API_KEY=your_api_key_here
```

### 🟠 Ramp Up (1 → 10 users)
```powershell
k6 run tests/load_test.js --env SCENARIO=ramp --env FLOW_ID=1 --env API_KEY=your_api_key_here
```

### 🔴 Stress Test (30 concurrent flows)
```powershell
k6 run tests/load_test.js --env SCENARIO=stress --env FLOW_ID=1 --env API_KEY=your_api_key_here
```

### ใช้ไฟล์ ZIP อื่น
```powershell
k6 run tests/load_test.js --env ZIP_FILE=tests/test_data/test_50pages.zip --env FLOW_ID=1 --env API_KEY=your_api_key_here
```

### ยิงไปที่ Ubuntu Server
```powershell
k6 run tests/load_test.js --env BASE_URL=http://your-ubuntu-ip --env FLOW_ID=1 --env API_KEY=your_api_key_here
```

---

## Step 4: อ่านผลลัพธ์

k6 จะแสดง metrics ดังนี้:

| Metric | ความหมาย |
|--------|---------|
| `http_req_duration` | เวลาส่ง HTTP request (submit job) |
| `job_processing_duration` | เวลาประมวลผลทั้ง job (submit → completed) |
| `jobs_queued` | จำนวน jobs ที่ submit สำเร็จ |
| `jobs_completed` | จำนวน jobs ที่เสร็จ |
| `jobs_failed` | จำนวน jobs ที่ fail หรือ timeout |
| `job_success_rate` | อัตราสำเร็จ (%) |

---

## Benchmark Targets (Ubuntu 1 core / 4GB RAM)

| Scenario | Target |
|----------|--------|
| 1 flow × 10 pages (OCR OFF) | < 30 วินาที |
| 1 flow × 50 pages (OCR OFF) | < 2 นาที |
| 30 flows × 50 pages (OCR OFF) | < 60 นาที total |
| 30 flows × 50 pages (OCR ON) | < 3 ชั่วโมง total |

---

## Troubleshooting

- **`max_queue_size` error (HTTP 429)**: เพิ่มค่าใน System Config
- **`dial tcp: connection refused`**: ตรวจสอบว่า server กำลังรันอยู่
- **ZIP file not found**: รัน `python tests/generate_test_data.py` ก่อน
