#!/bin/bash
# Security Scanning Script (Phase 5.2)

echo "=== 🛡️ Robot Verify Security Scan ==="

# 1. SCA for Frontend (npm audit)
echo "-----------------------------------"
echo "[1] Running Frontend SCA (npm audit)..."
cd frontend
npm audit
cd ..

# 2. SCA for Backend (safety)
echo "-----------------------------------"
echo "[2] Running Backend SCA (safety)..."
# We run this in the backend container context ideally, or via local pip if available
# We'll use docker-compose to run it if backend is up
docker-compose exec -T backend pip install safety > /dev/null 2>&1
docker-compose exec -T backend safety check

# 3. SAST for the entire project (SonarQube)
echo "-----------------------------------"
echo "[3] Running SAST (SonarQube Scanner)..."
echo "Starting SonarScanner via Docker..."
# Note: This requires a running SonarQube server. Defaulting to localhost:9000
docker run \
    --rm \
    -e SONAR_HOST_URL="http://localhost:9000" \
    -e SONAR_LOGIN="your-sonarqube-token" \
    -v "$(pwd):/usr/src" \
    sonarsource/sonar-scanner-cli

echo "-----------------------------------"
echo "✅ Security scans complete!"
