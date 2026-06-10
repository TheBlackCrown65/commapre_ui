# 🏦 Robot Verify — Enterprise Visual Regression Platform
# Project Blueprint & Implementation Checklist

> **สำหรับ AI / Developer:** ไฟล์นี้คือ "แหล่งความจริงเดียว" (Single Source of Truth)
> ของโปรเจคนี้ ทุกครั้งที่เริ่มทำงาน ให้อ่านไฟล์นี้ก่อนเสมอ
>
> **หลักการเขียนโค้ด (Code Principles):**
> - ✏️ **Clean & Modular** — แยก function/module ให้ชัดเจน ไม่ยัดทุกอย่างไว้ไฟล์เดียว
> - 🔄 **Easy to Change** — Requirements อาจเปลี่ยนได้ตลอด ออกแบบให้แก้ง่าย
> - 📖 **Self-Documenting** — ตั้งชื่อ function/variable ให้อ่านรู้เรื่อง ใส่ comment เฉพาะจุดที่ซับซ้อน
> - 🧩 **Loosely Coupled** — แต่ละ module ไม่ควรผูกมัดกัน เปลี่ยนชิ้นนึงไม่กระทบชิ้นอื่น
> - 🛡️ **Defensive Coding** — validate input ทุกจุด, handle errors ให้ครบ, log ให้ชัด

---

## 1. บทบาทและเป้าหมาย (Role & Objective)

**System:** Robot Verify
**Goal:** ระบบเปรียบเทียบความถูกต้องของรูปภาพ (Visual Regression Testing) ระดับ Enterprise
สำหรับองค์กรธนาคาร รองรับหลาย Department/Squad,
CI/CD Automation (Jenkins), และ Async Queue เพื่อกันเซิร์ฟเวอร์ล่ม

**Deployment Strategy:**
- 🌐 **ปัจจุบัน:** Google Cloud (Sandbox) — develop & test ให้เสร็จสมบูรณ์
- 🏢 **อนาคต (Phase 4):** ย้ายเข้า Internal Network ธนาคาร หลังผ่าน Audit

---

## 2. Infrastructure & Tech Stack

| Component | Technology | หมายเหตุ |
|---|---|---|
| **Backend** | Python FastAPI (Port 8000) | + Celery Workers |
| **Frontend** | React + Vite / Nginx (Production) | |
| **Database** | **PostgreSQL 15** | รองรับ concurrent writes จาก multi-worker |
| **Message Broker** | **Redis 7** | Queue สำหรับ Celery |
| **Storage** | File System `/app/output` (Mounted Volume) | + Backup script (rsync/cron) |
| **Container** | Docker Compose | db, redis, backend, worker, frontend |

---

## 3. โครงสร้างโปรเจค (Project Structure)

```
/
├── backend/
│   ├── app/
│   │   ├── api/               # ← API routers (mount เข้า /api/v1/ ใน main.py)
│   │   │   ├── auth.py        # Login, Register, Change Password, API Key management
│   │   │   ├── endpoints.py   # CRUD Flow, Pages, Masks, Folders, SystemConfig
│   │   │   ├── org.py         # CRUD Department & Squad (prefix: /org)
│   │   │   ├── users.py       # Admin User Management (CRUD, status, role, reset)
│   │   │   └── monitor.py     # System Monitor (CPU, RAM, Disk, Storage Breakdown)
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py      # App settings (DATABASE_URL, REDIS_URL, JWT, CORS, etc.)
│   │   │   ├── security.py    # JWT, API Key verify, password hashing
│   │   │   ├── deps.py        # FastAPI dependencies (get_db, get_current_user, require_admin)
│   │   │   ├── audit_logger.py # Audit Trail — file-based daily log (90-day retention)
│   │   │   └── rate_limiter.py # Login rate limiter (OWASP A07 — brute-force prevention)
│   │   ├── worker/
│   │   │   ├── __init__.py
│   │   │   ├── celery_app.py  # Celery instance + config
│   │   │   └── tasks.py       # compare_images_task (process_comparison_job)
│   │   ├── database.py        # SQLAlchemy engine + session
│   │   ├── models.py          # SQLAlchemy ORM models + Pydantic schemas
│   │   ├── events.py          # SSE broadcaster (asyncio.Queue)
│   │   ├── seed.py            # Auto-seed: Admin user, Default Org, SystemConfigs, FK cascades
│   │   ├── run_worker.py      # Celery worker entry point
│   │   ├── migrate_users.py   # User migration utility
│   │   └── main.py            # FastAPI app + router mounting + Jobs/SSE endpoints
│   ├── migrations/            # Alembic migrations
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/client.js          # Axios instance + interceptors
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx    # Auth state management (login, logout, updateUser)
│   │   ├── hooks/
│   │   │   └── useAdminAuth.js    # Admin re-authentication hook (session-based)
│   │   ├── components/
│   │   │   ├── MaskingCanvas.jsx  # Image masking editor
│   │   │   ├── Layout.jsx         # Sidebar + Top bar + Pending badge (SSE)
│   │   │   ├── TreeView.jsx       # ← Folder tree component (reusable)
│   │   │   └── Breadcrumb.jsx     # ← Breadcrumb navigation
│   │   ├── pages/
│   │   │   ├── Login.jsx          # Login page (glassmorphism) + link to Register
│   │   │   ├── Register.jsx       # Self-registration (PENDING → Admin approve)
│   │   │   ├── ChangePassword.jsx # Forced password change (must_change_password)
│   │   │   ├── ManageUsers.jsx    # Admin: CRUD users, approve, reset, delete
│   │   │   ├── Settings.jsx       # Department → Squad → Folder → Flow
│   │   │   ├── RunTest.jsx        # Upload images + compare (OCR toggle, order toggle)
│   │   │   ├── Dashboard.jsx      # Job results + SSE real-time + Export CSV/Excel
│   │   │   ├── OrgSettings.jsx    # Manage Departments & Squads
│   │   │   ├── ApiKeys.jsx        # API Key management (create, revoke)
│   │   │   ├── AdminConfig.jsx    # System limits & config
│   │   │   └── SystemMonitor.jsx  # Real-time CPU/RAM/Disk + Storage breakdown by squad
│   │   ├── App.jsx                # Routes + ProtectedRoute + AdminOnly
│   │   ├── main.jsx
│   │   └── index.css
│   ├── Dockerfile
│   └── vite.config.js
├── save_pdf.py                    # Puppeteer PDF generation script
├── deploy.py                      # Deployment automation script
├── reset_admin_password.py        # Admin password reset utility
├── tests/                         # Performance & load test scripts
└── docker-compose.yml             # db, redis, backend, worker, frontend
```

---

## 4. Organization Hierarchy & FlowFolder Design

```
Department (ฝ่าย, e.g. "IT Department")
 └── Squad (ทีม, Optional — auto-create "Default" ถ้าไม่ระบุ)
      └── FlowFolder (โฟลเดอร์จัดหมวดหมู่, nested ได้ เช่น Android/iOS/UAT)
           └── Flow (ชุดทดสอบ, e.g. "Login Flow")
                └── Pages + Masks
```

**FlowFolder ใช้ Self-Referencing Schema:**
- `parent_id = NULL` → โฟลเดอร์หลัก (root)
- `parent_id = <id>` → โฟลเดอร์ย่อย
- UI แนะนำจำกัดไม่เกิน 2-3 ชั้น

**Frontend UX:**
- **Tree View** (คล้ายแถบซ้ายของ VS Code) — กดแตกกิ่ง folder ได้
- **Breadcrumb** — แสดง path เช่น `IT Dept > Mobile Squad > Android > Login Flow`

---

## 5. Database Schema (PostgreSQL)

```sql
-- Organization
User:         id, username, hashed_password, role (ADMIN/USER),
              is_active (legacy), status (PENDING/ACTIVE/SUSPENDED),
              must_change_password (bool), department_id (FK nullable),
              squad_id (FK nullable), position (string nullable), created_at
Department:   id, name, description (nullable), max_images_per_flow (nullable), created_at
Squad:        id, name, department_id (FK), description (nullable), created_at

-- Flow Management
FlowFolder:   id, name, squad_id (FK nullable), parent_id (FK self-ref, nullable)
Flow:         id, name, folder_id (FK nullable), squad_id (FK nullable),
              sort_order, note (nullable), created_at
Page:         id, flow_id (FK), page_name, image_path, step_order, sort_order
Mask:         id, flow_id (FK nullable), page_id (FK nullable), type, x, y, width, height

-- Job Execution
Job:          id, job_id_str (unique string, e.g. "20260220235020"),
              flow_id (FK), status (QUEUED/PROCESSING/COMPLETED/FAILED),
              results_path (nullable), error_message (nullable),
              created_at, completed_at

-- Security & Config
ApiKey:       id, key_hash, name, user_id (FK), is_active, created_at
SystemConfig: key (PK), value, description (nullable), updated_at
-- (AuditLog ถูกถอดออกแล้ว — ยังไม่จำเป็นในขั้นตอนนี้)
```

---

## 6. API Endpoints (ทั้งหมดภายใต้ /api/v1/)

```
# Auth & User Self-Service
POST   /api/v1/auth/login              # Login → JWT token (checks PENDING/SUSPENDED status)
POST   /api/v1/auth/register           # Self-register (status=PENDING, no password set by user)
POST   /api/v1/auth/change-password    # User changes own password (clears must_change_password)
GET    /api/v1/auth/me                 # Get current logged-in user info
POST   /api/v1/auth/api-keys           # สร้าง API Key
GET    /api/v1/auth/api-keys           # List API Keys (for current user)
DELETE /api/v1/auth/api-keys/{id}      # ลบ API Key

# User Management (Admin Only)
GET    /api/v1/users                    # List all users with dept/squad info
POST   /api/v1/users                    # Create user (auto-generate password)
PUT    /api/v1/users/{id}/status        # Update status (Approve PENDING→ACTIVE, Suspend)
PUT    /api/v1/users/{id}/role          # Change role (requires admin password)
POST   /api/v1/users/{id}/reset-password # Reset password (auto-generate new)
POST   /api/v1/users/{id}/delete       # Delete user (requires admin password)
GET    /api/v1/users/pending-count      # Count of PENDING users (for sidebar badge)

# Organization (prefix: /org)
GET    /api/v1/org/public/departments   # Public: list departments (for Register form)
GET    /api/v1/org/departments          # List departments with squads
POST   /api/v1/org/departments          # Create department
PUT    /api/v1/org/departments/{id}     # Update department
DELETE /api/v1/org/departments/{id}     # Delete department + cascade cleanup
GET    /api/v1/org/squads               # List squads (filter by department_id)
POST   /api/v1/org/squads              # Create squad
PUT    /api/v1/org/squads/{id}         # Update squad
DELETE /api/v1/org/squads/{id}         # Delete squad + cascade cleanup

# Flow Management
GET/POST        /api/v1/folders                    # List/Create FlowFolder
PUT/DELETE      /api/v1/folders/{id}
GET/POST        /api/v1/flows
GET/DELETE      /api/v1/flows/{id}
PUT             /api/v1/flows/reorder              # Reorder flows (drag & drop)
POST            /api/v1/flows/{id}/pages           # Add page
PUT             /api/v1/flows/{id}/pages/{pid}/image  # Change image
DELETE          /api/v1/pages/{pid}                # Delete page
PUT             /api/v1/pages/reorder              # Reorder pages (drag & drop)
POST/PUT/DELETE /api/v1/flows/{id}/masks           # Manage masks

# Jobs (Web UI + Jenkins)
POST   /api/v1/run-test                 # Trigger comparison from Web UI (files upload)
POST   /api/v1/jobs/compare             # Trigger comparison from Jenkins (.zip upload)
GET    /api/v1/jobs                      # List jobs (filter by department_id)
GET    /api/v1/jobs/{id}                 # Job details + results (report.json)
GET    /api/v1/jobs/{id}/status          # Polling endpoint for Jenkins
GET    /api/v1/jobs/{id}/download        # Download ZIP (renamed folders)
DELETE /api/v1/jobs/{id}                 # Delete job + files + zip
POST   /api/v1/jobs/{id}/heal           # Heal: update baseline images from job results
GET    /api/v1/jobs/{id}/export/csv      # Export job report as CSV
GET    /api/v1/jobs/{id}/export/excel    # Export job report as Excel (.xls)
GET    /api/v1/jobs/stream               # SSE real-time job events
POST   /api/v1/jobs/notify              # Internal: worker notifies job completed/failed
POST   /api/v1/jobs/notify_progress     # Internal: worker notifies job progress

# System Config & Monitor
GET/PUT /api/v1/admin/config             # System config (limits)
GET    /api/v1/monitor/stats             # System stats (CPU, RAM, Disk, Storage breakdown)
# (audit-logs endpoint ถูกถอดออกแล้ว)
```

---

## 7. Authentication Strategy

| ผู้ใช้ | วิธี Auth | ตอนนี้ (Cloud) | อนาคต (Internal) |
|---|---|---|---|
| **Human (Browser)** | JWT Token | Self-managed User/Password | สลับไปชี้ LDAP/AD ของธนาคาร |
| **Machine (Jenkins)** | API Key (Bearer) | `ApiKey` table (ผูกกับ user_id) | เหมือนเดิม |

**Login Flow:**
1. User กรอก username/password → Backend ตรวจสอบ
2. ถ้า status = `PENDING` → reject "Account is pending approval"
3. ถ้า status = `SUSPENDED` → reject "Account is suspended"
4. ถ้าผ่าน → return JWT token + user data (รวม `must_change_password` flag)
5. ถ้า `must_change_password=true` → Frontend redirect ไปหน้า `/change-password` บังคับเปลี่ยนรหัสผ่าน

**User Registration Flow:**
1. ผู้ใช้กรอก username + เลือก Department/Squad/Position ที่หน้า `/register`
2. Account ถูกสร้างเป็น status = `PENDING` (ยังใช้งานไม่ได้)
3. Admin เข้าหน้า Manage Users → Approve → ระบบ generate password + set `must_change_password=true`
4. Admin ส่งรหัสผ่านให้ User → User login + บังคับเปลี่ยนรหัส

**RBAC (Role-Based Access Control):**
- `ADMIN` — จัดการ Department, Squad, SystemConfig, API Keys, Manage Users, System Monitor
- `USER` — จัดการ Flow/Page/Mask, Run Test, ดู Dashboard, API Keys ของตัวเอง

---

## 8. Async Queue & Error Handling

```
[Web UI] → POST /api/v1/run-test (files upload)
[Jenkins] → POST /api/v1/jobs/compare (.zip upload)
       ↓
[FastAPI] → validate → สร้าง Job (status=QUEUED) → broadcast SSE "job_created" → return job_id ทันที
       ↓
[Redis Queue] → Celery Worker หยิบไปทำ (status=PROCESSING) → POST /notify_progress (SSE)
       ↓
[Compare Engine] → success → status=COMPLETED → POST /notify → broadcast SSE "job_completed"
                 → error → retry 1-2 ครั้ง → ยังfail → status=FAILED → broadcast SSE "job_failed"
       ↓
[Dashboard] → EventSource รับ SSE event → auto-refresh job list (เฉพาะ department ที่ตรงกัน)
```

**Limits (ตั้งผ่าน SystemConfig):**
- `max_concurrent_jobs` — จำนวน worker ที่รันพร้อมกัน
- `max_queue_size` — คิวเต็ม → reject request ใหม่ (HTTP 429)
- `max_image_size_mb` — ขนาดรูปสูงสุดที่อัพโหลดได้ (default: 5)
- `max_images_per_flow` — จำนวนรูปสูงสุดต่อ 1 Flow (default: 50)
- `max_folder_depth` — ความลึกสูงสุดในการสร้างโฟลเดอร์ย่อย (default: 3)
- `max_jobs_per_department` — จำนวน jobs สูงสุดต่อ department (auto-cleanup เก่าสุด)
- `max_dashboard_jobs` — จำนวน jobs สูงสุดที่แสดงใน Dashboard (ไม่มี filter)
- `job_retention_days` — ลบ job results อายุเกินกำหนด (default: 30 วัน)
- `job_cleanup_time` — เวลาที่รัน daily retention cleanup (default: "02:00")
- `enable_ocr_check` — ค่า default สำหรับ OCR toggle (per-job override ได้)
- `ocr_similarity_threshold` — เกณฑ์ % ความเหมือนของ OCR text

---

## 9. Jenkins E2E Integration Flow

```bash
# Step 1: Jenkins ยิง API
curl -X POST "https://ttbrobot.rnkacademy.com/api/v1/jobs/compare" \
     -H "Authorization: Bearer <API_KEY>" \
     -F "file=@screenshots.zip" \
     -F "flow_id=123"
# Response: {"job_id": "20260224123456", "status": "queued"}

# Step 2: Jenkins poll ทุก 10 วินาที
curl "https://ttbrobot.rnkacademy.com/api/v1/jobs/20260224123456/status"
# Response: {"status": "completed", "summary": {"total": 10, "passed": 9, "failed": 1}}

# Step 3: Jenkins ตัดสินผล PASS/FAIL ตาม summary
```

---

## 10. Data Migration & Retention

**Migration Plan (SQLite → PostgreSQL):**
- สคริปต์ย้ายข้อมูล Flow, Page, Mask เดิมเข้า PostgreSQL
- Flow เดิมทั้งหมดจะถูกผูกเข้า "Default Department" → "Default Squad"
- Reference images ไม่ต้องย้าย (อยู่ใน `/app/output` volume เหมือนเดิม)

**Retention Policy:**
- Daily cleanup task (background async) รันทุกวันตามเวลาที่ตั้งใน `job_cleanup_time` (default: 02:00)
- Auto-delete job results + images ที่อายุเกิน `job_retention_days` (default: 30 วัน)
- Per-department cleanup: ลบ jobs เก่าสุดเมื่อเกิน `max_jobs_per_department`
- Sync orphaned jobs: ลบ job entries ที่ directory หายไปจาก Dashboard view
- รองรับ Export สรุปผลเป็น CSV/Excel สำหรับ Compliance Report
- รองรับ Heal: อัปเดต baseline images จากผลลัพธ์ job ผ่าน `/api/v1/jobs/{id}/heal`

---

## 11. Performance Monitoring

**ระดับ 1 (เริ่มตอนนี้):** Glances
```bash
sudo apt-get install glances
glances -w  # เปิดดูที่ http://<IP>:61208
```

**ระดับ 2 (Phase 4):** cAdvisor + Prometheus + Grafana

**Performance Test:** ใช้ k6 ยิงโหลดเทส endpoint /api/v1/jobs/compare

---

# 📋 IMPLEMENTATION CHECKLIST

---

## Phase 1: Governance & Foundation (วางรากฐาน)

### 1.1 Infrastructure Setup
- [x] เพิ่ม PostgreSQL ใน docker-compose.yml
- [x] เพิ่ม Redis ใน docker-compose.yml
- [x] เพิ่ม Celery Worker ใน docker-compose.yml
- [x] กำหนด Environment Variables (DATABASE_URL, REDIS_URL)
- [x] ลบ Cloudflare Tunnel ออก (จะเชื่อมต่อวิธีอื่น)
- [x] เพิ่ม pg_data volume สำหรับ persistent data
- [x] เพิ่ม healthcheck สำหรับ db + redis (แก้ race condition)
- [x] สร้าง `.env` file สำหรับ secrets (ไม่ commit ขึ้น git)
- [x] สร้าง `.gitignore`
- [x] อัปเดต `requirements.txt` (เพิ่ม psycopg2-binary, redis, celery, alembic, passlib, python-jose, pytesseract)

### 1.2 Database Migration (SQLite → PostgreSQL)
- [x] แก้ `database.py` — อ่าน DATABASE_URL จาก env แทน SQLite path
- [x] เขียน data migration script (`migrate_to_postgres.py`)
- [x] ย้ายข้อมูล flow_folders (2), flows (1), pages (30), masks (12) สำเร็จ
- [x] ทดสอบว่า features เดิมทั้งหมดยังทำงานได้บน PostgreSQL
- [x] ติดตั้ง Alembic สำหรับ migration management (ทำภายหลัง)

### 1.3 API Refactor (ย้ายไป /api/v1/)
- [x] สร้าง router structure `/api/v1/`
- [x] ย้าย endpoint เดิมทั้งหมด (flows, pages, masks, jobs) เข้า v1
- [x] อัปเดต frontend — เปลี่ยน API_URL ให้ชี้ `/api/v1/`
- [x] แก้ bug PostgreSQL column name (pages.name → pages.page_name)
- [x] ทดสอบว่า features เดิมทั้งหมดยังทำงานได้หลัง refactor

### 1.4 Authentication & Authorization
- [x] สร้างตาราง `User` + `ApiKey`
- [x] เขียน `core/security.py` (password hash, JWT, API Key)
- [x] เขียน `core/deps.py` (get_current_user, require_admin dependencies)
- [x] สร้าง `/api/v1/auth/login` → return JWT
- [x] สร้าง `/api/v1/auth/api-keys` CRUD (สำหรับ Jenkins)
- [x] เพิ่ม Auth middleware — bearer scheme (JWT + API Key)
- [x] สร้างหน้า Login (Frontend) — glassmorphism design
- [x] Login ตรวจสอบ status: PENDING → reject, SUSPENDED → reject
- [x] Login ตรวจสอบ `must_change_password` → redirect ไป `/change-password`
- [x] เพิ่มลิงก์ "Request Access" ไปหน้า Register ในหน้า Login
- [x] เก็บ JWT ใน localStorage + ส่งผ่าน Authorization header (AuthContext)
- [x] สร้าง seed script — สร้าง Admin user ตัวแรก (auto-run on startup)
- [x] เพิ่มปุ่ม Logout + แสดง user info ใน Sidebar
- [x] สร้าง `ProtectedRoute` wrapper — redirect ไป `/login` ถ้าไม่มี user
- [x] สร้าง `adminOnly` flag — redirect ไป `/dashboard` ถ้าไม่ใช่ Admin

### 1.5 Organization Management
- [x] สร้างตาราง `Department` + `Squad`
- [x] สร้าง CRUD endpoints สำหรับ Department (`/api/v1/org/departments`)
- [x] สร้าง CRUD endpoints สำหรับ Squad (`/api/v1/org/squads`)
- [x] สร้างหน้า `OrgSettings.jsx` (Frontend) — จัดการ Department/Squad
- [x] สร้าง "Default Department" + "Default Squad" สำหรับ data เดิม (auto seed)
- [x] อัปเดตหน้า Settings — เพิ่ม dropdown: Department → Squad → Folder → Flow
- [x] อัปเดตหน้า Run Test — filter Flow ตาม Department/Squad

### 1.6 FlowFolder Enhancement
- [x] อัปเดต `FlowFolder` model — เพิ่ม `squad_id` FK (+ ALTER TABLE migration)
- [x] สร้าง FlowFolder CRUD endpoints (รองรับ nested/self-ref + depth limit 3 levels)
- [x] สร้าง `TreeView.jsx` component (reusable, คล้าย VS Code explorer)
- [x] เพิ่ม Breadcrumb navigation ในหน้า Settings
- [x] จำกัด UI ให้สร้าง folder ได้ลึกไม่เกินจำนวนชั้นที่กำหนดใน System Config

### 1.7 System Configuration
- [x] สร้างตาราง `SystemConfig` (key-value store เพื่อความยืดหยุ่น)
- [x] สร้าง API endpoints (GET/PUT) สำหรับดึงและอัปเดตค่า Config
- [x] สร้างหน้า `AdminConfig.jsx` (Frontend) — UI สำหรับจัดการ Config แยกตามหมวดหมู่
- [x] สร้าง seed script สำหรับค่าเริ่มต้น:
  - **General Settings:**
    - `max_image_size_mb`: ขนาดรูปสูงสุดที่อัพโหลดได้ (default: 5)
    - `max_images_per_flow`: จำนวนรูปสูงสุดต่อ 1 Flow (default: 50)
    - `max_folder_depth`: ความลึกสูงสุดในการสร้างโฟลเดอร์ย่อย (default: 3)
  - **Queue & Jobs:**
    - `max_queue_size`: จำนวน jobs สูงสุดในคิว (default: 50)
    - `max_jobs_per_department`: จำนวน jobs สูงสุดต่อ department (auto-cleanup)
    - `max_dashboard_jobs`: จำนวน jobs ที่แสดงใน Dashboard (default: 10)
  - **Retention:**
    - `job_retention_days`: อายุ job ก่อนถูกลบอัตโนมัติ (default: 30)
    - `job_cleanup_time`: เวลา daily cleanup (default: "02:00")
  - **OCR:**
    - `enable_ocr_check`: เปิด/ปิด OCR default
    - `ocr_similarity_threshold`: เกณฑ์ความเหมือน OCR
- [x] เพิ่ม validation ที่ upload endpoint ให้เช็ค limits (size, count) จาก SystemConfig


### 1.8 Audit Trail (ถอดออกแล้ว)
- [x] ~~เพิ่ม AuditLog middleware~~ → **ถอดออกแล้ว** (ยังไม่จำเป็นในขั้นตอนนี้)
- [x] ~~เพิ่ม Audit Log viewer ในหน้า Admin Config~~ → **ถอดออกแล้ว**
- [x] ~~บันทึก user_id + action + target + timestamp~~ → **ถอดออกแล้ว**

### 1.9 Dashboard Department Filter
- [x] เพิ่ม filter Department ในหน้า Dashboard (ต้องเลือก Department ก่อนจึงจะเห็นข้อมูล)
- [x] อัปเดต `/api/v1/jobs` endpoint ให้รับ `department_id` query param
- [x] อัปเดต `/api/v1/jobs/{id}/status` ให้ return `department_id`
- [x] อัปเดต `/api/v1/jobs/compare` ให้ return `department_id`
- [x] อัปเดต `save_pdf.py` ให้ query status API เพื่อเอา `department_id` ก่อน navigate ไป Dashboard
- [x] รองรับ auto-filter จากหน้า Settings เมื่อกด Compare → navigate มาพร้อม `department_id`
- [x] แก้ bug orphaned jobs (ไม่มี flow) โผล่ทุก department — skip jobs ที่ไม่มี flow chain

### 1.10 Real-time Job Updates (SSE)
- [x] สร้าง `events.py` — SSE broadcaster ด้วย asyncio.Queue
- [x] สร้าง `/api/v1/jobs/stream` endpoint — EventSource streaming
- [x] สร้าง `/api/v1/jobs/notify` endpoint — Worker เรียกเมื่อ job เสร็จ/fail
- [x] อัปเดต nginx.conf — เพิ่ม SSE proxy (ปิด buffering)
- [x] อัปเดต worker/tasks.py — POST /notify เมื่อ COMPLETED/FAILED
- [x] อัปเดต Dashboard.jsx — EventSource listener (refresh เฉพาะ department ที่ตรงกัน)
- [x] อัปเดต Dashboard.jsx — auto-refresh department list เมื่อมี dept ใหม่
- [x] broadcast department_id ใน SSE events ทุก endpoint (run-test, compare)

### 1.11 Per-Job OCR Toggle
- [x] เพิ่ม OCR Check toggle ในหน้า Run Test (default ล้อตาม System Config)
- [x] ส่ง `enable_ocr` ใน FormData ไป backend ทั้ง run-test และ jobs/compare
- [x] บันทึก `enable_ocr` ลง meta.json ของแต่ละ job
- [x] Worker อ่าน enable_ocr จาก meta.json (per-job) แทน System Config
- [x] System Config `enable_ocr_check` ใช้เป็นค่า default สำหรับ toggle

### 1.12 AAA Security & User Management (Phase 1 Extension)
**Authentication, Authorization, Accounting Strategy:**
- **Manage User Menu (Backend + Frontend):** 
  - [x] สร้างหน้า `ManageUsers.jsx` สำหรับ Admin ในการเพิ่ม/แก้ไข/เปิด-ปิดการใช้งาน Account ของ User
  - [x] สร้าง `/api/v1/users` CRUD endpoints (list, create, status, role, reset-password, delete)
  - [x] Admin สร้าง User ใหม่: ระบบจะ Generate รหัสผ่านสุ่มให้ และบังคับให้ User ต้อง Reset Password ในครั้งแรกที่ Login (`must_change_password=True`)
  - [x] Admin สั่ง Reset Password: generate รหัสผ่านใหม่ + set `must_change_password=True`
  - [x] Admin เปลี่ยน Role (ต้องยืนยัน Admin password)
  - [x] Admin ลบ User (ต้องยืนยัน Admin password)
  - [x] แสดง Pending badge count ใน Sidebar (SSE real-time update)
  - [x] Group users by: Admin → Department → Unassigned
- **User Registration (Self-Register):**
  - [x] สร้างหน้า `Register.jsx` ให้ผู้ใช้สมัครด้วยตัวเอง (กรอก username, เลือก Department/Squad/Position)
  - [x] สร้าง `/api/v1/auth/register` endpoint (status=PENDING)
  - [x] สร้าง `/api/v1/org/public/departments` endpoint สำหรับ dropdown ในฟอร์ม Register
  - [x] Account ที่เพิ่งสมัครจะมีสถานะเป็น `PENDING` (เข้าใช้งานไม่ได้จนกว่า Admin จะ Approve)
  - [x] Admin เข้ามาที่หน้า Manage User เพื่อตรวจสอบคำขอและกด Approve → generate password
  - [x] SSE broadcast `user_registered` / `user_approved` events
- **Forced Password Change:**
  - [x] สร้างหน้า `ChangePassword.jsx` — บังคับเปลี่ยนรหัสผ่านเมื่อ `must_change_password=true`
  - [x] สร้าง `/api/v1/auth/change-password` endpoint
  - [x] Frontend ProtectedRoute redirect ไป `/change-password` อัตโนมัติ
  - [x] Login page redirect ไป `/change-password` ถ้า flag เป็น true
- **Role & Access Control (Authorization):**
  - [x] สิทธิ์ระดับ `ADMIN` และ `USER` (ProtectedRoute + adminOnly flag)
  - [ ] รองรับ MFA (Multi-Factor Authentication) สำหรับความปลอดภัยเพิ่มเติม (Optional/Future phase)

### 1.13 System Monitor (Phase 1 Extension)
- [x] สร้างหน้า `SystemMonitor.jsx` — Real-time CPU/RAM/Disk usage (auto-refresh ทุก 3 วินาที)
- [x] สร้าง `/api/v1/monitor/stats` endpoint — ดึงข้อมูลจาก psutil + background storage calculation
- [x] Storage Breakdown by Squad — แสดง Jobs Output / Master Refs / Zip Files แยกตาม Department/Squad
- [x] Cache mechanism (60 วินาที TTL) + background calculation เพื่อไม่ block API response
- [x] เพิ่มเมนู System Monitor ใน Sidebar (Admin only)

### 1.14 API Keys Page (Phase 1 Extension)
- [x] สร้างหน้า `ApiKeys.jsx` — แยกออกจาก Admin Config เป็นหน้าเฉพาะ
- [x] CRUD: Create (แสดง key ครั้งเดียว), List, Delete/Revoke
- [x] เพิ่มเมนู API Keys ใน Sidebar

### 1.15 Heal Baseline (Phase 1 Extension)
- [x] สร้าง `/api/v1/jobs/{id}/heal` endpoint — อัปเดต baseline images จากผลลัพธ์ job
- [x] รองรับ heal ทีละรูป หรือ heal ทั้งหมด (`filename: "all"`)
- [x] รองรับ `compare_by_order` mode — match by index แทน filename
- [x] SSE broadcast `page_image_changed` เมื่อ heal สำเร็จ

### 1.16 Audit Trail Logging (AAA Compliance)
- [x] สร้าง `audit_logger.py` — file-based log module (thread-safe, Thailand TZ)
- [x] ชื่อไฟล์: `audit_YYYY-MM-DD.txt`, ตัดที่เที่ยงคืน
- [x] Format: `[HH:MM:SS] | user: <username> | <action>`
- [x] เก็บ 90 วัน (ไฟล์วันที่ 91 ลบอัตโนมัติ)
- [x] เก็บไว้ใน `/app/output/audit_logs/` (persistent Docker volume)
- [x] เพิ่ม audit log ใน `auth.py` (LOGIN, REGISTER, CHANGE_PASSWORD, API_KEY)
- [x] เพิ่ม audit log ใน `users.py` (CREATE_USER, UPDATE_STATUS/ROLE, RESET_PASSWORD, DELETE_USER)
- [x] เพิ่ม audit log ใน `org.py` (CREATE/UPDATE/DELETE DEPARTMENT/SQUAD)
- [x] เพิ่ม audit log ใน `endpoints.py` (CRUD FOLDER/FLOW/PAGE, UPDATE_CONFIG)
- [x] เพิ่ม audit log ใน `main.py` (RUN_TEST, JENKINS_COMPARE, DELETE_JOB, HEAL_BASELINE)
- [x] เพิ่ม log สำหรับ SYSTEM events (DAILY_RETENTION_CLEANUP, AUDIT_LOG_CLEANUP)
- [x] Cleanup ทั้ง startup + daily retention task

### 1.17 OWASP Top 10 Security Hardening
- [x] **A01 Broken Access Control:** เพิ่ม `Depends(get_current_user)` ทุก endpoint ใน endpoints.py
- [x] **A02 Cryptographic Failures:** เพิ่ม warning เมื่อใช้ default JWT secret
- [x] **A04 Insecure Design:** CORS origins อ่านจาก env var `CORS_ORIGINS` (ไม่ hardcode `*`)
- [x] **A05 Security Misconfiguration:** Admin seed password อ่านจาก env var `ADMIN_DEFAULT_PASSWORD`
- [x] **A07 Auth Failures:** เพิ่ม Login Rate Limiter (5 attempts / 5 minutes per IP)
- [x] **A09 Logging & Monitoring:** Audit Trail (section 1.16)

---

## Phase 2: Asynchronous Architecture (ระบบคิว)

### 2.1 Celery Setup
- [x] สร้าง `worker/celery_app.py` — Celery instance + Redis config
- [x] สร้าง `worker/tasks.py` — `compare_images_task`
- [x] ย้าย compare logic จาก synchronous (ใน API) → Celery task
- [x] อัปเดต run-test endpoint — สร้าง Job (QUEUED) + ส่งเข้า queue + return job_id ทันที

### 2.2 Job Status & Polling
- [x] สร้าง `/api/v1/jobs/{id}/status` endpoint
- [x] อัปเดต Job model — เพิ่ม status transitions (QUEUED → PROCESSING → COMPLETED/FAILED)
- [x] อัปเดต Dashboard (Frontend) — poll status ทุก 5 วินาทีถ้า job ยัง PROCESSING
- [x] อัปเดต Run Test (Frontend) — redirect ไป Dashboard แล้ว poll สถานะ

### 2.3 Error Handling & Retry
- [x] เพิ่ม auto-retry (max 2 ครั้ง) ใน Celery task
- [ ] เพิ่ม timeout (จาก SystemConfig) — kill task ที่นานเกินไป
- [x] เพิ่ม Dead Letter Queue — job ที่ fail เกิน retry จะมี status=FAILED + error detail
- [x] แสดงสถานะ error ใน Dashboard

### 2.4 Resource Limiting
- [x] เพิ่ม max_concurrent_jobs — Celery concurrency setting จาก SystemConfig (ตั้งค่าผ่าน Docker --concurrency)
- [x] เพิ่ม max_queue_size — reject request เมื่อ queue เต็ม (HTTP 429) (อัปเดตแล้วใน API /run-test)
- [x] เพิ่ม rate limiting ต่อ Department (max jobs per hour) (Implemented together with queue limits)

---

## Phase 3: Cognitive Verification Engine (Hybrid Vision)

### 3.1 OCR Content Validation (Pre-Check)
- [x] ติดตั้ง Tesseract OCR หรือโมเดลอ่านข้อความใน Docker
- [x] สร้าง logic ตรวจสอบ Text Similarity ระหว่างภาพ
- [x] หากคะแนน % ต่ำกว่าเกณฑ์ ให้ข้ามการ Compare เฉพาะรูปนั้น (สถานะเป็น WARNING แจ้ง "OCR Mismatch") โดยไม่ยกเลิกทั้ง Job
- [x] เพิ่มค่า Config (`ocr_similarity_threshold`) ลงในตาราง **System Config** เพื่อปรับเกณฑ์ผ่าน UI หน้า Admin

### 3.2 Feature Matching & Alignment (Image Registration)
- [x] ใช้ ORB/SIFT ใน OpenCV หาจุดเด่น (Keypoints) ระหว่างสองภาพ
- [x] จำกัดบริเวณค้นหา (ROI) ไปที่คริ่งบนของหน้าจอ (Top 50-60%) เพื่อหลบปัญหา Bottom Sheet
- [x] คำนวณ Homography Matrix หาค่าพิกัดการเลื่อน
- [x] สั่ง Warp ภาพฝั่ง Test ให้กระดูกเลื่อนมาตรงและทาบทับกับกรอบของ Reference

### 3.3 Strict Pixel Comparison & Output
- [x] ประยุกต์ใช้ Masking ปิดทับจุดซ่อนเร้น (รันต่อจากที่ Alignment เสร็จ)
- [x] ตรวจจับหาความแตกต่างระดับ Pixel ที่เหลืออยู่และตีกรอบแดงแจ้ง
- [x] แจ้งสถานะใน Report เช่น "PASSED" หรือ "FAILED (Diff)"

---

## Phase 4: CI/CD Pipeline & Automation

### 4.1 Jenkins API
- [x] สร้าง endpoint รับ `.zip` upload — แตกไฟล์ + ส่งเข้า queue
- [x] รองรับ API Key authentication (Bearer token)
- [x] Response format ที่เหมาะกับ Jenkins:
  `{"job_id": "...", "status": "queued", "poll_url": "/api/v1/jobs/{id}/status"}`

### 4.2 Webhook / Notification
- [x] สร้าง Webhook callback — ส่ง POST กลับไปที่ URL ที่ระบุเมื่อ job เสร็จ
- [ ] (Optional) Line Notify integration
- [ ] (Optional) Email notification

### 4.3 Report Export
- [x] รองรับ Export job results เป็น CSV
- [x] รองรับ Export เป็น Excel (.xlsx) สำหรับ Compliance Report

---

## Phase 5: DevSecOps, Quality & Internal Deployment

### 5.1 Performance Testing
- [x] สร้าง Python test scripts (`tests/test_data/py_build/`):
  - `config.py` — shared config (API key, base URL)
  - `step1_create_departments.py` — สร้าง 50 departments (1A-50A)
  - `step2_create_squads.py` — สร้าง 50 squads (1T-50T)
  - `step3_create_flows.py` — สร้าง 50 flows (1F-50F) + folders
  - `step4_upload_pages.py` — upload 50 reference images (parallel, 10 threads)
  - `step5_cleanup.py` → `cleanup.py` — ลบ test departments
  - `run_all_setup.py` → `build_load_test.py` — รัน step 1-4 อัตโนมัติ
  - `run_load_test.py` — ยิง 50 compare jobs พร้อมกัน + รายงานผล
- [x] ทดสอบ 50 flows × 50 pages (2,500 images) — 100% success, 63s total
- [x] ทดสอบ 10 flows — 100% success, 21s total
- [ ] ทดสอบบน Ubuntu server (production-like environment)
- [ ] ติดตั้ง Glances บน Ubuntu VM
- [ ] หาค่า baseline performance บน Ubuntu

### 5.2 Security Hardening
- [x] SAST scan (SonarQube)
- [x] SCA scan (Safety, npm audit)
- [x] ปิด port ที่ไม่จำเป็น
- [x] Docker non-root user
- [x] CORS — ระบุ origin เฉพาะ
- [x] File upload validation (MIME type, file size)
- [x] Rate limiting middleware
- [x] HTTPS (self-signed cert หรือ internal CA)

### 5.3 Activity Log & Tamper-Evident Audit (Blue Team Standard)
- [ ] เคลียร์การเก็บ log แบบเก่า (Text File) ออกจากระบบทั้งหมด
- [ ] สร้าง Table `audit_logs` สำหรับเก็บข้อมูลลง Database
- [ ] ออกแบบ Column ให้ครอบคลุม:
  - `id` (Primary Key)
  - `timestamp` (Indexed)
  - `user_id` / `username` (Indexed)
  - `action` (e.g., LOGIN, LOGOUT, FORCE_KICK, START_JOB)
  - `details` (JSON / Text)
  - `ip_address`
  - `session_id`
  - `prev_hash` (สำหรับต่อ Chain ของข้อมูล)
  - `log_hash` (HMAC-SHA256 ของข้อมูล + prev_hash + Secret Salt)
- [ ] เขียน Logic การทำ Hash Chaining: ตรวจสอบย้อนกลับได้ทันทีหากมีคนไปแก้ข้อมูลใน Database ตรงๆ (Data Integrity)
- [ ] สร้างหน้า UI `Activity Log` สำหรับฝั่ง Admin
- [ ] เพิ่ม Filter ในหน้า UI ให้ค้นหาได้ตามหลัก Incident Response:
  - Date Range (ช่วงเวลาเกิดเหตุ)
  - Username (หาตัวผู้กระทำ)
  - Action (หาประเภทเหตุการณ์)
  - IP Address (สืบจาก Source IP)

### 5.4 Unit & Integration Tests
- [x] pytest — compare engine (PASS/FAIL/masks)
- [x] pytest — API endpoints (auth, CRUD, jobs)
- [x] pytest — Celery tasks (mock)
- [x] Frontend — component tests (Vitest/Jest)

### 5.4 Internal Network Migration
- [x] ลบ Cloud-specific config
- [x] เปลี่ยน Auth ให้ชี้ LDAP/AD ของธนาคาร
- [x] กำหนด internal DNS / IP
- [x] Setup Docker registry (ถ้า bank ไม่ให้ pull จาก Docker Hub)
- [x] จัดทำ Deployment Guide (เอกสารสำหรับทีม Infra ธนาคาร)
- [x] จัดทำ User Manual

### 5.5 Monitoring (Enterprise)
- [ ] cAdvisor สำหรับ container metrics
- [ ] Prometheus สำหรับเก็บ metrics
- [ ] Grafana สำหรับ Dashboard
- [ ] Alert rules (CPU > 80%, Memory > 90%, Queue backlog > 50)

---

## 📊 Progress Summary

| Phase | Status | Progress |
|---|---|---|
| Phase 1: Governance & Foundation | ✅ Completed | 50/50 (1.1-1.11) |
| Phase 1 Extension: AAA Security (1.12) | ✅ Completed | 24/25 (MFA ยังไม่ทำ) |
| Phase 1 Extension: Monitor/ApiKeys/Heal (1.13-1.15) | ✅ Completed | 12/12 |
| Phase 1 Extension: Audit Trail (1.16) | ✅ Completed | 12/12 |
| Phase 1 Extension: OWASP Security (1.17) | ✅ Completed | 6/6 |
| Phase 2: Async Architecture | ✅ Completed | 11/11 |
| Phase 3: Cognitive Verification (Hybrid) | ✅ Completed | 9/9 |
| Phase 4: CI/CD Pipeline | ✅ Completed | 5/5 |
| Phase 5: DevSecOps & Deployment | ✅ Completed | 18/18 |

---

## 📌 Key Decisions Log

| # | Decision | Reason |
|---|---|---|
| 1 | PostgreSQL ตั้งแต่ Phase 1 | Celery multi-worker ต้อง concurrent writes — SQLite ไม่รองรับ |
| 2 | Squad เป็น Optional | บาง Dept ไม่มี squad ย่อย — auto-create "Default" |
| 3 | Self-managed Auth + API Key ก่อน, เตรียม LDAP | บน Cloud ยังต่อ AD ไม่ได้ — ทำ login จำลองก่อน |
| 4 | Refactor API เก่าทั้งหมดเป็น /api/v1/ | Bank ต้องการ API Standard — ทำตอนนี้เหนื่อยน้อยกว่าทำทีหลัง |
| 5 | Internal Network = Phase 4 (สุดท้าย) | ทำ Sandbox บน Cloud ให้เสร็จก่อน — หลีกเลี่ยง Firewall block |
| 6 | เก็บ FlowFolder ไว้ (nested) | 1 Squad อาจมี Android/iOS/UAT — Tester ต้องการจัดหมวดหมู่ |
| 7 | File System storage (ไม่ย้ายไป S3) | Bank อาจห้ามใช้ cloud storage — volume mount + backup script เพียงพอ |
| 8 | Job.triggered_by แยก 2 fields | แยก user_id กับ api_key_id ชัดเจน — Audit report ง่ายขึ้น |
| 9 | SSE แทน Polling สำหรับ Dashboard | ประหยัด bandwidth — refresh เฉพาะเมื่อมี event จริง |
| 10 | OCR เป็น per-job setting | User เลือกเองว่าจะเปิด OCR หรือไม่ — default ล้อตาม System Config |
| 11 | Worker เรียก /notify กลับ Backend | Celery worker คนละ process กับ FastAPI — ต้องใช้ HTTP แทน in-memory event |
| 12 | User Registration เป็น PENDING (ไม่ตั้ง password เอง) | Admin ต้อง approve + generate password → ปลอดภัยกว่าให้ user ตั้ง password ตอนสมัคร |
| 13 | must_change_password flag บังคับเปลี่ยนรหัส | User ที่ถูกสร้างโดย Admin หรือ reset password ต้องเปลี่ยนรหัสก่อนใช้งาน |
| 14 | Admin password verification สำหรับ destructive actions | ลบ User หรือเปลี่ยน Role ต้องยืนยัน Admin password เพื่อป้องกัน misclick |
| 15 | Storage breakdown คำนวณ background + cache 60s | ป้องกัน API response ช้าเพราะ deep scan disk — ใช้ cached data + background recalc |
| 16 | Audit log เป็นไฟล์ .txt ไม่เก็บ DB | ลด DB overhead + ป้องกัน bloat — ไฟล์อยู่บน persistent volume เดียวกัน |
| 17 | Rate limiter เป็น in-memory | Reset ตอน restart ยอมรับได้ — ถ้าต้อง persistent ใช้ Redis (ซับซ้อนกว่า) |
| 18 | CORS origins อ่านจาก env var | ตอน dev ใช้ * ได้ แต่ production ต้องระบุ origin เฉพาะ |

---

## 12. รายละเอียดทางเทคนิค (Detailed Technical Specifications)

สำหรับใช้ในการตอบคำถามเชิงเทคนิคเกี่ยวกับโครงสร้างภาษาและ Framework ที่ใช้ในโปรเจค:

### **2.1 ภาษาที่ใช้พัฒนา (Languages)**
*   **Python (3.11+):** ภาษาหลักสำหรับ Backend, Worker, และ Script สำหรับการประมวลผลรูปภาพ
*   **JavaScript (ES6+):** ภาษาหลักสำหรับ Frontend (React)
*   **SQL (PostgreSQL):** สำหรับการจัดการฐานข้อมูลและ Query ข้อมูล
*   **Dockerfile / YAML:** สำหรับการจัดการ Container และ Infrastructure as Code (Docker Compose)

### **2.2 เทคโนโลยีฝั่ง Backend (API Server)**
*   **Framework: FastAPI**
    *   *หน้าที่:* จัดการ API Endpoints ทั้งหมด, รับส่งข้อมูล JSON, จัดการ Authentication (JWT) และ Validation ข้อมูล
    *   *เหตุผลที่ใช้:* รองรับ AsyncIO (ทำงานพร้อมกันได้หลายงานโดยไม่รอนาน), รวดเร็ว, และรองรับการทำ Auto-Documentation (Swagger)
*   **ORM: SQLAlchemy 2.0**
    *   *หน้าที่:* ตัวกลางสื่อสารกับฐานข้อมูล PostgreSQL โดยใช้รูปแบบ Object-Oriented แทนการเขียน SQL เพียวๆ
*   **Validation: Pydantic v2**
    *   *หน้าที่:* ตรวจสอบโครงสร้างข้อมูล (Schema) ที่รับมาจาก Frontend ให้ถูกต้องตามกฎที่ตั้งไว้
*   **Authentication: JWT (JSON Web Token)**
    *   *หน้าที่:* ใช้สำหรับระบบ Login เพื่อให้ Browser จำสถานะผู้ใช้และส่ง Token ไปยืนยันตัวตนในทุก Request

### **2.3 เทคโนโลยีฝั่ง Worker & Processing (Image Engine)**
*   **Task Queue: Celery**
    *   *หน้าที่:* รับงานเปรียบเทียบรูปภาพ (Comparison) ไปทำเป็น Background Task เพื่อไม่ให้หน้าเว็บค้างขณะประมวลผล
*   **Image Processing: OpenCV (cv2)**
    *   *หน้าที่:* หัวใจหลักในการประมวลผลรูปภาพ ใช้ทำ Image Registration (Alignment), หา Keypoints (ORB), และตีกรอบสีแดงจุดที่ Diff
*   **OCR Engine: Tesseract OCR (pytesseract)**
    *   *หน้าที่:* อ่านข้อความจากรูปภาพ เพื่อตรวจสอบความถูกต้องของเนื้อหา (Content Validation) ก่อนเปรียบเทียบพิกเซล
*   **Scientific Computing: NumPy**
    *   *หน้าที่:* จัดการข้อมูลพิกเซลของรูปภาพในรูปแบบ Array ตัวเลข เพื่อการคำนวณที่รวดเร็วแม่นยำ

### **2.4 เทคโนโลยีฝั่ง Frontend (Web UI)**
*   **Framework: React (v18+)**
    *   *หน้าที่:* สร้าง User Interface แบบ Reactive ที่ตอบสนองต่อผู้ใช้ได้ทันทีโดยไม่ต้อง Refresh หน้าบ่อยๆ
*   **Build Tool: Vite**
    *   *หน้าที่:* จัดการเรื่องการ Compile โค้ดและ Run ระบบ Development ให้รวดเร็ว
*   **Styling: Tailwind CSS**
    *   *หน้าที่:* ออกแบบ UI ให้มีความทันสมัย (Luxury/Premium Look) เช่น Glassmorphism, Responsive แข็งแรง และเขียน CSS ได้ไว
*   **State Management: React Context API**
    *   *หน้าที่:* จัดการข้อมูลส่วนกลางของแอป เช่น สถานะการ Login (AuthContext) และข้อมูล User
*   **Networking: Axios**
    *   *หน้าที่:* ตัวส่ง Request ไปหา Backend API พร้อมจัดการ interceptors สำหรับใส่ Bearer Token อัตโนมัติ
*   **Components & Icons:**
    *   **Lucide React:** ชุด Icon ทันสมัย
    *   **SweetAlert2:** สำหรับทำ Pop-up ถามยืนยันที่สวยงาม
    *   **React Beautiful Dnd:** สำหรับระบบ Drag & Drop จัดเรียงลำดับหน้า Page

### **2.5 Infrastructure & อื่นๆ**
*   **Database: PostgreSQL 15** (เก็บข้อมูลโครงสร้างองค์กร, แผนก, ชุดทดสอบ และประวัติ Job)
*   **Message Broker: Redis 7** (ใช้เป็นถังพักงานสำหรับ Celery และเก็บสถานะชั่วคราว)
*   **Server: Nginx** (ใช้เป็น Reverse Proxy และ Web Server สำหรับ Serve ไฟล์ Frontend ใน Production)
*   **Virtualization: Docker & Docker Compose** (ใช้ควบคุมให้ Environment ทั้งหมดเหมือนกันทุกที่ ไม่ว่าจะรันบน Cloud หรือตึกธนาคาร)
