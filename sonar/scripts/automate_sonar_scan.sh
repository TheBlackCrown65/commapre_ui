#!/bin/bash
# ==============================================================================
# 🚀 Automate Security Export & SonarQube Scanner Pipeline (Bash)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SONAR_DIR="${PROJECT_ROOT}/sonar"
ZIP_FILE="robot_verify_security_scan.zip"
ROOT_ZIP_PATH="${PROJECT_ROOT}/${ZIP_FILE}"
SONAR_ZIP_PATH="${SONAR_DIR}/${ZIP_FILE}"

echo "=== 🛡️ Robot Verify Automate Security & Sonar Scan ==="
echo "Project Root: ${PROJECT_ROOT}"
echo "Sonar Path  : ${SONAR_DIR}"

# Step 0: Check tools
command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || { echo "[X] Python is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "[X] Docker is required"; exit 1; }
docker info >/dev/null 2>&1 || { echo "[X] Docker daemon is not running"; exit 1; }

PYTHON_CMD="python"
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
fi

# Step 1: Export
echo -e "\n[1] Generating ${ZIP_FILE}..."
cd "${PROJECT_ROOT}"
${PYTHON_CMD} scripts/utils/export_for_security.py
if [ ! -f "${ROOT_ZIP_PATH}" ]; then
    echo "[X] Failed to generate ${ZIP_FILE}"
    exit 1
fi
echo "[OK] Generated ${ZIP_FILE}"

# Step 2: Move and Extract
echo -e "\n[2] Moving and Extracting to ${SONAR_DIR}..."
mkdir -p "${SONAR_DIR}"
mv -f "${ROOT_ZIP_PATH}" "${SONAR_ZIP_PATH}"

cd "${SONAR_DIR}"
${PYTHON_CMD} -c "import zipfile; zipfile.ZipFile('${SONAR_ZIP_PATH}').extractall('${SONAR_DIR}')"
echo "[OK] Extracted all files into ${SONAR_DIR}"

# Step 3: Start Sonar
echo -e "\n[3] Starting Docker Sonar..."
export SONAR_PORT="${SONAR_PORT:-9001}"
docker compose -f docker-compose.sonar.yml up -d

echo "Waiting for SonarQube at http://localhost:${SONAR_PORT}..."
MAX_RETRIES=60
RETRY=0
IS_UP=false

while [ $RETRY -lt $MAX_RETRIES ]; do
    RETRY=$((RETRY+1))
    STATUS=$(curl -s "http://localhost:${SONAR_PORT}/api/system/status" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || true)
    if [ "$STATUS" = "UP" ]; then
        IS_UP=true
        break
    fi
    echo -n "."
    sleep 3
done
echo ""

if [ "$IS_UP" != "true" ]; then
    echo "[X] SonarQube did not become UP in time."
    exit 1
fi
echo "[OK] SonarQube is UP!"

# Step 4: Run Sonar Scanner
echo -e "\n[4] Running SonarQube Scanner..."
SONAR_TOKEN="squ_370ce30fae5e2348b80cac132a132afe25aa7060"
if [ -f "${SONAR_DIR}/txt" ]; then
    FOUND_TOKEN=$(grep -E "^squ_[a-z0-9]+" "${SONAR_DIR}/txt" | head -n 1 || true)
    if [ -n "$FOUND_TOKEN" ]; then
        SONAR_TOKEN="$FOUND_TOKEN"
    fi
fi

docker run --rm \
    --network="sonar-network" \
    -v "$(pwd):/usr/src" \
    -e SONAR_HOST_URL="http://sonarqube:9000" \
    -e SONAR_TOKEN="${SONAR_TOKEN}" \
    sonarsource/sonar-scanner-cli

echo -e "\n🎉 Analysis complete! View results at:"
echo "http://localhost:${SONAR_PORT}/dashboard?id=compare_ui"
