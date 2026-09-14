# Robot Verify - Internal Deployment Guide

This guide is for the Infrastructure/DevOps team deploying Robot Verify into the bank's internal network.

## Prerequisites
- Docker Engine & Docker Compose
- Internal Docker Registry access
- PostgreSQL 15 database (External or via Docker)
- Redis 7 (External or via Docker)
- Active Directory / LDAP Server (for authentication)

## 1. Environment Configuration (`.env`)
Copy the provided `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Then edit the `.env` file to match your environment:

```env
# Database & Cache
DATABASE_URL=postgresql://robot_user:robot_secure_password@db:5432/robot_verify_db
REDIS_URL=redis://redis:6379/0

# Security (MUST CHANGE IN PRODUCTION)
JWT_SECRET_KEY=your-secure-random-256-bit-key
ADMIN_DEFAULT_PASSWORD=StrongAdminPass123!
CORS_ORIGINS=http://robotverify.internal.bank,https://robotverify.internal.bank

# LDAP / Active Directory Integration
LDAP_SERVER_URL=ldap://ldap.internal.bank:389
LDAP_BASE_DN=dc=internal,dc=bank
LDAP_USER_DOMAIN=internal.bank
```

## 2. Pushing Images to Internal Registry
Run the provided script to tag and push the local images to your registry:
```bash
bash scripts/push_to_internal_registry.sh
```
*Note: Edit the `INTERNAL_REGISTRY` variable in the script to match your environment.*

## 3. Air-Gapped / Offline Deployment (If no Internet Access)
If the deployment machine does not have internet access or cannot pull from the registry:
1. On a machine with internet access, run `bash scripts/export_offline_images.sh` to generate a `robot_verify_images.tar` file.
2. Transfer the `.tar` file and this source code to the offline machine.
3. On the offline machine, run `bash scripts/load_offline_images.sh` to load all required images.

## 4. Deploying via Docker Compose
Ensure your `.env` is configured. Then start the stack:
```bash
docker compose up -d
```

> [!TIP]
> **macOS Deployment Optimization**: If running Docker Desktop on macOS, go to **Settings > General** and enable **Use VirtioFS for optimized file sharing**. This drastically improves the read/write performance of the container volumes, which is critical when comparing thousands of images.

## 5. Setting up Nginx Reverse Proxy (HTTPS)
The Frontend container exposes port 8080 (running as a non-root user).
Configure your Load Balancer or internal Nginx to proxy traffic:

```nginx
server {
    listen 443 ssl;
    server_name robotverify.internal.bank;

    ssl_certificate /etc/ssl/certs/internal_cert.crt;
    ssl_certificate_key /etc/ssl/private/internal_key.key;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # Enable SSE (Server-Sent Events) for real-time updates
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```
