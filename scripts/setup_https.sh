#!/bin/bash
# Setup Self-Signed Certificate and Nginx for HTTPS

echo "=== 🔒 Setup HTTPS for Robot Verify ==="

CERT_DIR="./certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/server.crt" ]; then
    echo "Certificate already exists. Skipping generation."
else
    echo "Generating Self-Signed Certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/server.key" \
        -out "$CERT_DIR/server.crt" \
        -subj "/C=TH/ST=Bangkok/L=Bangkok/O=TTB/OU=IT/CN=robotverify.local"
    echo "Certificate generated successfully at $CERT_DIR"
fi

echo "To enable HTTPS, please ensure your frontend/nginx.conf is configured to listen on 443 with these certificates, and map port 443 in docker-compose.yml."
echo "✅ Done!"
