# =============================================================================
# KI-Assistent Gateway — Multi-Stage Docker Build
# =============================================================================
# Build:  docker build -f docker/gateway.Dockerfile -t ki-assistent-gateway packages/gateway/
# Run:    docker run -d -p 18789:18789 --env-file .env ki-assistent-gateway
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bun is required for gateway build scripts
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

# Layer caching: copy package manifests first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

# Copy full source (filtered by .dockerignore in build context)
COPY . .

# Build gateway (tsdown: src/ → dist/)
# Skip ui:build — we use our own Electron UI
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy runtime artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/openclaw.mjs ./openclaw.mjs

# Our additive files (dynamically loaded by gateway)
COPY --from=builder /app/channels ./channels
COPY --from=builder /app/tool-router.ts ./tool-router.ts

# OpenClaw plugin systems (dynamically loaded)
COPY --from=builder /app/extensions ./extensions
COPY --from=builder /app/skills ./skills

ENV NODE_ENV=production

# Non-root user (node user exists in node base images, uid 1000)
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://127.0.0.1:18789/health || exit 1

EXPOSE 18789

CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
