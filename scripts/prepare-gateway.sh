#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_DIR="$REPO_ROOT/packages/gateway"
DEPLOY_DIR="$REPO_ROOT/apps/desktop/gateway-bundle"

echo "[prepare-gateway] Building gateway TypeScript..."
if [ ! -f "$GATEWAY_DIR/dist/entry.js" ]; then
  pnpm -C packages/gateway exec tsdown --no-clean
  # Runtime-relevant post-build steps (canvas/dts skipped — not needed for Electron)
  OPENCLAW_A2UI_SKIP_MISSING=1 node --import tsx packages/gateway/scripts/copy-hook-metadata.ts
  node --import tsx packages/gateway/scripts/write-build-info.ts
  node --import tsx packages/gateway/scripts/write-cli-compat.ts
else
  echo "[prepare-gateway] dist/entry.js already exists, skipping build"
fi

echo "[prepare-gateway] Creating standalone deploy..."
rm -rf "$DEPLOY_DIR"
pnpm --filter=openclaw deploy --legacy "$DEPLOY_DIR"

echo "[prepare-gateway] Copying custom files..."
# dist/ and openclaw.mjs are already included by pnpm deploy

# Only in-app-channel extension (other channels not needed)
rm -rf "$DEPLOY_DIR/extensions"
mkdir -p "$DEPLOY_DIR/extensions/in-app-channel"
find "$GATEWAY_DIR/extensions/in-app-channel" -maxdepth 1 -type f -exec cp {} "$DEPLOY_DIR/extensions/in-app-channel/" \;

# Custom channel adapter (loaded by in-app-channel via jiti)
mkdir -p "$DEPLOY_DIR/channels"
cp "$GATEWAY_DIR/channels/in-app.ts" "$DEPLOY_DIR/channels/"

# ── Pruning: Remove dependencies not imported by dist/ ──
# IMPORTANT: Only prune packages that do NOT appear in dist/ imports.
# Channel SDKs (@whiskeysockets, grammy, @slack, @buape, @line, @aws-sdk,
# discord-api-types, playwright-core) are statically imported and MUST stay.
echo "[prepare-gateway] Pruning unused dependencies..."
PRUNE_PATTERNS=(
  # Unused channel SDKs (not imported by dist/)
  "@larksuiteoapi" "@matrix-org" "mattermost-redux" "@matterbridge"
  # Build tools (not needed at runtime)
  "typescript" "@typescript" "tsdown" "rolldown" "@rolldown"
  "esbuild" "@esbuild" "oxlint" "@oxlint" "oxfmt"
  "lightningcss" "@napi-rs+canvas"
  # Heavy optional (not imported by dist/)
  "node-llama-cpp" "@node-llama-cpp" "pdfjs-dist"
  "sharp" "@img+sharp"
  "ogg-opus-decoder" "@wasm-audio-decoders"
  # Unused cloud SDKs
  "@cloudflare+workers-types"
  "@opentelemetry"
)

if [ -d "$DEPLOY_DIR/node_modules/.pnpm" ]; then
  cd "$DEPLOY_DIR/node_modules/.pnpm"
  for pattern in "${PRUNE_PATTERNS[@]}"; do
    find . -maxdepth 1 -type d -name "${pattern}*" -exec rm -rf {} + 2>/dev/null || true
  done
  cd "$REPO_ROOT"
fi

# Dereference ALL symlinks — create a flat copy of node_modules where
# every symlink is replaced by the real file/directory. On CI all targets
# still exist, so cp -RLf resolves them. Without this, the packaged app
# contains symlinks pointing to CI paths that don't exist on the user's machine.
echo "[prepare-gateway] Dereferencing all symlinks in node_modules..."
cp -RLf "$DEPLOY_DIR/node_modules" "$DEPLOY_DIR/node_modules_real"
rm -rf "$DEPLOY_DIR/node_modules"
mv "$DEPLOY_DIR/node_modules_real" "$DEPLOY_DIR/node_modules"

# Override root .gitignore so electron-builder includes node_modules
touch "$DEPLOY_DIR/.npmignore"

FINAL_SIZE=$(du -sh "$DEPLOY_DIR" | cut -f1)
echo "[prepare-gateway] Done. Bundle size: $FINAL_SIZE"
