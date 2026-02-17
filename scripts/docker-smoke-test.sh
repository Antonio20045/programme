#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# docker-smoke-test.sh — Gateway Docker Image Validation
# =============================================================================
# Builds the image, starts a container, verifies health + security, cleans up.
# Uses port 18799 (non-default) to avoid conflicts with running instances.
#
# Usage: bash scripts/docker-smoke-test.sh
# =============================================================================

IMAGE="ki-assistent-gateway:smoke-test"
CONTAINER="ki-assistent-gateway-smoke"
PORT=18799
MAX_WAIT=30
POLL_INTERVAL=2

cleanup() {
    echo "Cleaning up..."
    docker rm -f "$CONTAINER" 2>/dev/null || true
    docker rmi -f "$IMAGE" 2>/dev/null || true
}
trap cleanup EXIT

# ---- 1. Build ----
echo "=== Building Gateway image ==="
docker build -f docker/gateway.Dockerfile -t "$IMAGE" packages/gateway/

# ---- 2. Start ----
echo "=== Starting container on port $PORT ==="
docker run -d \
    --name "$CONTAINER" \
    --init \
    -p "$PORT:18789" \
    -e OPENCLAW_GATEWAY_TOKEN=smoke-test-token \
    "$IMAGE" \
    node openclaw.mjs gateway --allow-unconfigured --bind lan

# ---- 3. Health check ----
echo "=== Waiting for health check (max ${MAX_WAIT}s) ==="
elapsed=0
while [ "$elapsed" -lt "$MAX_WAIT" ]; do
    if curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
        echo "Health check passed after ${elapsed}s"
        break
    fi
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
done

if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "ERROR: Health check failed after ${MAX_WAIT}s"
    echo "=== Container logs ==="
    docker logs "$CONTAINER"
    exit 1
fi

# ---- 4. Non-root user ----
echo "=== Verifying non-root user ==="
USER=$(docker exec "$CONTAINER" whoami)
if [ "$USER" != "node" ]; then
    echo "ERROR: Container running as '$USER', expected 'node'"
    exit 1
fi
echo "Running as: $USER"

# ---- 5. No secrets in layers ----
echo "=== Checking for secrets in image layers ==="
if docker history --no-trunc "$IMAGE" 2>/dev/null | grep -iE '(api_key|secret|password|token)=\S+'; then
    echo "ERROR: Secrets found in image layers"
    exit 1
fi
echo "No secrets in layers"

# ---- Done ----
echo ""
echo "=== All smoke tests passed ==="
