# ==============================================================================
# 🚀 Automate Security Export & SonarQube Scanner Pipeline
# ==============================================================================
# ขั้นตอนการทำงาน:
# 1. รัน python scripts/utils/export_for_security.py เพื่อสร้างไฟล์ robot_verify_security_scan.zip
# 2. ย้ายไฟล์ robot_verify_security_scan.zip ไปที่โฟลเดอร์ sonar และทำการแตกไฟล์
# 3. สั่ง docker compose up สำหรับ SonarQube และรอจนกว่า Service พร้อมใช้งาน (Status: UP)
# 4. สั่ง SonarScanner CLI ทำการวิเคราะห์ Source Code ผ่าน docker network
# ==============================================================================

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Title)
    Write-Host "`n========================================================" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host " [OK] $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host " [i]  $Message" -ForegroundColor Yellow
}

function Write-ErrorMsg {
    param([string]$Message)
    Write-Host " [X]  $Message" -ForegroundColor Red
}

# กำหนด Path ต่างๆ
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# หาก script อยู่ใน scripts/ ให้ถอย 1 ขั้นเพื่อหา Project Root
if ((Split-Path -Leaf $ScriptDir) -eq "scripts") {
    $ProjectRoot = (Get-Item $ScriptDir).Parent.FullName
} else {
    $ProjectRoot = $ScriptDir
}

$SonarDir = Join-Path $ProjectRoot "sonar"
$ZipFileName = "robot_verify_security_scan.zip"
$RootZipPath = Join-Path $ProjectRoot $ZipFileName
$SonarZipPath = Join-Path $SonarDir $ZipFileName

Write-Host "`n=== 🛡️ Robot Verify Automate Security & Sonar Scan ===" -ForegroundColor Magenta
Write-Info "Project Root : $ProjectRoot"
Write-Info "Sonar Path   : $SonarDir"

# ------------------------------------------------------------------------------
# 0. ตรวจสอบความพร้อมของเครื่องมือ (Prerequisites)
# ------------------------------------------------------------------------------
Write-Step "0. ตรวจสอบสภาพแวดล้อม (Prerequisites)"
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    Write-ErrorMsg "ไม่พบคำสั่ง Python ในระบบ กรุณาติดตั้ง Python"
    exit 1
}
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    Write-ErrorMsg "ไม่พบคำสั่ง Docker ในระบบ กรุณาติดตั้ง Docker Desktop"
    exit 1
}

# ตรวจสอบว่า Docker daemon กำลังรันอยู่หรือไม่
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-ErrorMsg "Docker daemon ไม่ได้ทำงานอยู่ กรุณาเปิดโปรแกรม Docker Desktop ก่อน"
    exit 1
}
Write-Success "สภาพแวดล้อมพร้อมทำงาน (Python & Docker พร้อมใช้งาน)"

# ------------------------------------------------------------------------------
# 1. รันไฟล์เพื่อสร้าง robot_verify_security_scan.zip
# ------------------------------------------------------------------------------
Write-Step "1. สั่งรันไฟล์สร้าง $ZipFileName"
Write-Info "กำลังรัน: python scripts/utils/export_for_security.py ..."
Push-Location $ProjectRoot
try {
    python "scripts/utils/export_for_security.py"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $RootZipPath)) {
        Write-ErrorMsg "ไม่พบไฟล์ $ZipFileName หลังจากการรันสคริปต์"
        exit 1
    }
    $ZipItem = Get-Item $RootZipPath
    Write-Success "สร้างไฟล์ $ZipFileName สำเร็จ (ขนาด: $([math]::Round($ZipItem.Length / 1MB, 2)) MB)"
} finally {
    Pop-Location
}

# ------------------------------------------------------------------------------
# 2. ย้ายและแตกไฟล์ robot_verify_security_scan.zip ในโฟลเดอร์ sonar
# ------------------------------------------------------------------------------
Write-Step "2. ย้ายและแตกไฟล์ $ZipFileName ไปที่ $SonarDir"
if (-not (Test-Path $SonarDir)) {
    New-Item -ItemType Directory -Path $SonarDir -Force | Out-Null
}

Write-Info "กำลังย้าย $ZipFileName ไปยัง $SonarDir ..."
Move-Item -Path $RootZipPath -Destination $SonarZipPath -Force
Write-Success "ย้ายไฟล์ไปที่: $SonarZipPath"

Write-Info "กำลังแตกไฟล์ $ZipFileName ..."
# ใช้ Python zipfile ในการแตกไฟล์เพื่อความรวดเร็ว
python -c "import zipfile; zipfile.ZipFile(r'$SonarZipPath').extractall(r'$SonarDir')"
if ($LASTEXITCODE -ne 0) {
    Write-Info "Python extract ไม่สำเร็จ กำลังใช้ Expand-Archive สำรอง..."
    Expand-Archive -Path $SonarZipPath -DestinationPath $SonarDir -Force
}

if (-not (Test-Path (Join-Path $SonarDir "sonar-project.properties"))) {
    Write-ErrorMsg "ไม่พบ sonar-project.properties ในโฟลเดอร์ sonar หลังแตกไฟล์"
    exit 1
}
Write-Success "แตกไฟล์ทั้งหมดลงใน $SonarDir เรียบร้อยแล้ว"

# ------------------------------------------------------------------------------
# 3. เปิด Docker Sonar และรอจนกว่าระบบพร้อมทำงาน
# ------------------------------------------------------------------------------
Write-Step "3. สั่งรันเปิด Docker Sonar"
Push-Location $SonarDir
try {
    # กำหนด Port Host สำหรับ SonarQube Web Dashboard (ค่าเริ่มต้น 9001 เพื่อไม่ให้ชนกับ Frontend ที่ใช้ 9000)
    $SonarHostPort = if ($env:SONAR_PORT) { $env:SONAR_PORT } else { 9001 }
    $env:SONAR_PORT = "$SonarHostPort"

    Write-Info "กำลังเริ่ม Container SonarQube และ Sonar-DB (Port Web UI: $SonarHostPort)..."
    docker compose -f docker-compose.sonar.yml up -d
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "ไม่สามารถเปิด Docker Sonar ได้"
        exit 1
    }
    Write-Success "Docker Compose up สำเร็จ"

    Write-Info "กำลังตรวจสอบสถานะ SonarQube Server ที่ http://localhost:$SonarHostPort ..."
    $MaxRetries = 60
    $RetryCount = 0
    $IsUp = $false

    while ($RetryCount -lt $MaxRetries) {
        $RetryCount++
        try {
            $statusResp = Invoke-RestMethod -Uri "http://localhost:$SonarHostPort/api/system/status" -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($statusResp.status -eq "UP") {
                $IsUp = $true
                break
            } else {
                Write-Host -NoNewline "."
            }
        } catch {
            Write-Host -NoNewline "."
        }
        Start-Sleep -Seconds 3
    }
    Write-Host ""

    if (-not $IsUp) {
        Write-ErrorMsg "SonarQube ไม่สามารถเริ่มทำงานได้ภายในเวลาที่กำหนด กรุณาตรวจสอบ docker logs sonarqube"
        exit 1
    }
    Write-Success "SonarQube Server พร้อมทำงานแล้ว! (Status: UP)"

    # --------------------------------------------------------------------------
    # 4. สั่ง Sonar สแกน
    # --------------------------------------------------------------------------
    Write-Step "4. สั่ง Sonar แสกนโค้ด (SonarScanner CLI)"

    # อ่าน Token จาก Environment Variable, ไฟล์ sonar/txt หรือให้ผู้ใช้กำหนด
    $SonarToken = if ($env:SONAR_TOKEN) { $env:SONAR_TOKEN } else { "" }
    $TxtFile = Join-Path $SonarDir "txt"
    if (-not $SonarToken -and (Test-Path $TxtFile)) {
        $tokenMatch = Get-Content $TxtFile | Where-Object { $_.Trim() -match "^sq[a-z0-9_]{30,}$" } | Select-Object -First 1
        if ($tokenMatch) {
            $SonarToken = $tokenMatch.Trim()
        }
    }

    Write-Info "ใช้ Token: $SonarToken"
    Write-Info "เริ่มการสแกนผ่าน Docker container 'sonarsource/sonar-scanner-cli' ..."

    $CurrentPath = (Get-Location).Path
    docker run --rm `
        --network="sonar-network" `
        -v "${CurrentPath}:/usr/src" `
        -e SONAR_HOST_URL="http://sonarqube:9000" `
        -e SONAR_TOKEN="$SonarToken" `
        sonarsource/sonar-scanner-cli

    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "การสแกน Sonar ไม่สำเร็จ (Exit Code: $LASTEXITCODE)"
        exit 1
    }

    # --------------------------------------------------------------------------
    # สรุปผล
    # --------------------------------------------------------------------------
    Write-Step "🎉 เสร็จสิ้นขั้นตอนทั้งหมดเรียบร้อยแล้ว!"
    Write-Success "ผลการสแกนถูกอัปโหลดไปยัง SonarQube สำเร็จ"
    Write-Host "`n👉 ดูผลการสแกนได้ที่ SonarQube Dashboard:" -ForegroundColor Yellow
    Write-Host "   http://localhost:$SonarHostPort/dashboard?id=compare_ui" -ForegroundColor Cyan
    Write-Host ""

} finally {
    Pop-Location
}
