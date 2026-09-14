#!/bin/bash
# Export Offline Images
# Use this script to build and package Docker images for an air-gapped deployment.

echo "Building local images..."
docker compose build

echo "Pulling dependency images (postgres, redis, nginx)..."
docker pull postgres:15-alpine
docker pull redis:7-alpine
docker pull nginxinc/nginx-unprivileged:alpine

echo "Saving images to robot_verify_images.tar..."
docker save \
  postgres:15-alpine \
  redis:7-alpine \
  nginxinc/nginx-unprivileged:alpine \
  robot_verify-backend \
  robot_verify-worker \
  robot_verify-frontend \
  > robot_verify_images.tar

echo "Done! You can now transfer robot_verify_images.tar to your offline machine."
