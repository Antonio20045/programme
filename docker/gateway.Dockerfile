# =============================================================================
# KI-Assistent Gateway — Multi-Stage Docker Build
# =============================================================================
# Build context: repo root (NOT packages/gateway)
# Build:  docker compose build gateway
# Run:    docker compose up -d
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bun is required for OpenClaw build scripts
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

# Layer caching: copy package manifests first
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/gateway/pnpm-lock.yaml packages/gateway/pnpm-lock.yaml
COPY packages/gateway/pnpm-workspace.yaml packages/gateway/pnpm-workspace.yaml
COPY packages/gateway/.npmrc packages/gateway/.npmrc
COPY packages/gateway/ui/package.json packages/gateway/ui/package.json
COPY packages/gateway/patches packages/gateway/patches
COPY packages/gateway/scripts packages/gateway/scripts

RUN cd packages/gateway && pnpm install --frozen-lockfile

# Copy full gateway source
COPY packages/gateway/ packages/gateway/

# Copy our additive packages (needed for runtime imports from channels/in-app.ts)
COPY packages/tools/ packages/tools/
COPY packages/shared/ packages/shared/

# Install tools + shared dependencies (separate from gateway's pnpm workspace)
RUN cd packages/tools && npm install --omit=dev --ignore-scripts 2>/dev/null; \
    cd /app/packages/shared && npm install --omit=dev --ignore-scripts 2>/dev/null; \
    true

# Copy migration files
COPY packages/gateway/migrations/ packages/gateway/migrations/

# Build gateway (tsdown: src/ → dist/)
# Skip ui:build — we use our own Electron UI
RUN cd packages/gateway && pnpm build

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/packages/gateway

# Copy built gateway artifacts from builder
COPY --from=builder /app/packages/gateway/dist ./dist
COPY --from=builder /app/packages/gateway/node_modules ./node_modules
COPY --from=builder /app/packages/gateway/package.json ./package.json
COPY --from=builder /app/packages/gateway/openclaw.mjs ./openclaw.mjs

# Our additive files (dynamically loaded by gateway)
COPY --from=builder /app/packages/gateway/channels ./channels
COPY --from=builder /app/packages/gateway/tool-router.ts ./tool-router.ts

# OpenClaw plugin systems (dynamically loaded)
COPY --from=builder /app/packages/gateway/extensions ./extensions
COPY --from=builder /app/packages/gateway/skills ./skills

# Migration SQL files
COPY --from=builder /app/packages/gateway/migrations ./migrations

# Gateway src/ needed by channels/in-app.ts (imports from ../src/database/, ../src/webhooks/ etc.)
# jiti (bundled in node_modules) transpiles TS at runtime for plugin/channel code
COPY --from=builder /app/packages/gateway/src ./src

# Our additive packages (runtime imports from channels/in-app.ts)
COPY --from=builder /app/packages/tools ../../packages/tools
COPY --from=builder /app/packages/shared ../../packages/shared

ENV NODE_ENV=production

# OpenClaw runtime config:
# - Disable Control UI (we use our own Electron UI) — prevents 503 catch-all
# - Enable in-app-channel plugin (bundled plugins are disabled by default)
RUN mkdir -p /home/node/.openclaw && \
    echo '{"gateway":{"controlUi":{"enabled":false}},"plugins":{"entries":{"in-app-channel":{"enabled":true}}}}' > /home/node/.openclaw/openclaw.json

# Non-root user (node user exists in node base images, uid 1000)
RUN chown -R node:node /app /home/node/.openclaw
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://127.0.0.1:18789/health || exit 1

EXPOSE 18789

# Default: bind to all interfaces inside container (required for Docker/Railway networking)
# --bind lan = 0.0.0.0 (OpenClaw option); --port 18789 = explicit default
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured", "--bind", "lan", "--port", "18789"]
