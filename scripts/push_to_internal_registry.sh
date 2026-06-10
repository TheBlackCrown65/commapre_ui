#!/bin/bash
# Push Docker images to the Bank's internal registry

INTERNAL_REGISTRY="registry.internal.bank/robot_verify"
VERSION="v1.0.0"

echo "Tagging images..."
docker tag robot_verify-frontend $INTERNAL_REGISTRY/frontend:$VERSION
docker tag robot_verify-backend $INTERNAL_REGISTRY/backend:$VERSION
docker tag robot_verify-worker $INTERNAL_REGISTRY/worker:$VERSION

echo "Pushing images..."
docker push $INTERNAL_REGISTRY/frontend:$VERSION
docker push $INTERNAL_REGISTRY/backend:$VERSION
docker push $INTERNAL_REGISTRY/worker:$VERSION

echo "Done!"
