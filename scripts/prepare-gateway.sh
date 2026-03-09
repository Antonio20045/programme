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

# Pre-compile channel adapter — in-app.ts imports from gateway src/, tools/src/ and shared/
# which don't exist in the production bundle. We compile it with tsdown so all source-level
# imports are resolved at build time. Only npm packages remain as external requires.
echo "[prepare-gateway] Pre-compiling channel adapter with tsdown..."
CHANNEL_BUILD_DIR="$DEPLOY_DIR/channels"
mkdir -p "$CHANNEL_BUILD_DIR"
# Create temporary tsdown config to avoid picking up gateway's main config
TSDOWN_TMP="$GATEWAY_DIR/.tsdown-channel.ts"
cat > "$TSDOWN_TMP" << 'TSDOWN_EOF'
import { defineConfig } from "tsdown";
export default defineConfig({
  entry: "channels/in-app.ts",
  format: "cjs",
  platform: "node",
  fixedExtension: false,
  // ESM-only packages must be bundled inline — CJS require() cannot load them
  noExternal: ["@mariozechner/pi-ai", "@mariozechner/pi-coding-agent"],
});
TSDOWN_EOF
# tsdown may exit non-zero due to warnings — rely on file existence check below
set +e
pnpm -C packages/gateway exec tsdown --config .tsdown-channel.ts --outDir "$CHANNEL_BUILD_DIR" --no-clean 2>&1 | tail -5
set -e
rm -f "$TSDOWN_TMP"
if [ ! -f "$CHANNEL_BUILD_DIR/in-app.cjs" ]; then
  echo "[prepare-gateway] ERROR: Failed to compile channel adapter"
  exit 1
fi
# Also keep the .ts source as fallback for dev mode
cp "$GATEWAY_DIR/channels/in-app.ts" "$CHANNEL_BUILD_DIR/"

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

# After pruning, some symlinks point to deleted packages — remove those first
echo "[prepare-gateway] Removing broken symlinks..."
find "$DEPLOY_DIR/node_modules" -type l ! -exec test -e {} \; -delete 2>/dev/null || true

# Remove circular symlink structures (pnpm workspace back-references)
# These cause cp -RLf to fail with "directory causes a cycle"
# The openclaw package in the bundle doesn't need its own node_modules —
# all deps are already hoisted to the top level.
echo "[prepare-gateway] Removing circular symlink structures..."
rm -rf "$DEPLOY_DIR/node_modules/openclaw/node_modules" 2>/dev/null || true
find "$DEPLOY_DIR/node_modules/.pnpm" -path "*/node_modules/openclaw/node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find "$DEPLOY_DIR/node_modules/.pnpm" -path "*/node_modules/openclaw/extensions" -type d -exec rm -rf {} + 2>/dev/null || true
find "$DEPLOY_DIR/node_modules/.pnpm" -path "*/node_modules/openclaw/packages" -type d -exec rm -rf {} + 2>/dev/null || true

# Remove any remaining broken symlinks (from circular structure removal)
find "$DEPLOY_DIR/node_modules" -type l ! -exec test -e {} \; -delete 2>/dev/null || true

# Dereference symlinks individually — cp -RLf on the entire tree fails silently
# on circular references and drops packages. Instead, resolve each symlink one by one.
echo "[prepare-gateway] Dereferencing symlinks in node_modules..."
find "$DEPLOY_DIR/node_modules" -type l | while IFS= read -r link; do
  target="$(readlink -f "$link" 2>/dev/null || true)"
  if [ -n "$target" ] && [ -e "$target" ]; then
    rm -f "$link"
    cp -R "$target" "$link" 2>/dev/null || true
  else
    rm -f "$link"
  fi
done

# Ensure all hoisted packages from .pnpm/node_modules are at the top level.
# pnpm deploy creates top-level symlinks → .pnpm/pkg/node_modules/pkg, but after
# symlink resolution some may be missing. Copy from the flat .pnpm/node_modules/ store.
echo "[prepare-gateway] Ensuring hoisted packages are present..."
if [ -d "$DEPLOY_DIR/node_modules/.pnpm/node_modules" ]; then
  for pkg in "$DEPLOY_DIR/node_modules/.pnpm/node_modules"/*; do
    name="$(basename "$pkg")"
    # Skip @scoped packages (handled separately) and dotfiles
    [ "${name#.}" != "$name" ] && continue
    if [ ! -e "$DEPLOY_DIR/node_modules/$name" ]; then
      cp -R "$pkg" "$DEPLOY_DIR/node_modules/$name" 2>/dev/null || true
    fi
  done
  # Handle @scoped packages
  for scope in "$DEPLOY_DIR/node_modules/.pnpm/node_modules"/@*; do
    [ -d "$scope" ] || continue
    scope_name="$(basename "$scope")"
    mkdir -p "$DEPLOY_DIR/node_modules/$scope_name"
    for pkg in "$scope"/*; do
      name="$(basename "$pkg")"
      if [ ! -e "$DEPLOY_DIR/node_modules/$scope_name/$name" ]; then
        cp -R "$pkg" "$DEPLOY_DIR/node_modules/$scope_name/$name" 2>/dev/null || true
      fi
    done
  done
fi

# Resolve version conflicts: pnpm's virtual store gives each package its own deps.
# After flattening, a top-level package may need a DIFFERENT version of a dep than
# what's hoisted. Only apply fixes from the .pnpm entry that matches the top-level
# package version (not from other versions of the same package).
echo "[prepare-gateway] Resolving version conflicts..."
PNPM_DIR="$DEPLOY_DIR/node_modules/.pnpm"
if [ -d "$PNPM_DIR" ]; then
  for pkg_store in "$PNPM_DIR"/*/node_modules; do
    [ -d "$pkg_store" ] || continue
    pkg_dir_name="$(basename "$(dirname "$pkg_store")")"
    pkg_name="${pkg_dir_name%%@[0-9]*}"  # brace-expansion@5.0.2 → brace-expansion

    # Find the corresponding top-level directory
    top_pkg="$DEPLOY_DIR/node_modules/$pkg_name"
    [ -d "$top_pkg" ] || continue

    # CRITICAL: Only apply deps from the .pnpm entry that matches the top-level version.
    # e.g. if top-level minimatch is v10.2.0, only use deps from .pnpm/minimatch@10.2.0,
    # NOT from .pnpm/minimatch@3.1.2 (which would have different, incompatible deps).
    top_pkg_ver=""
    [ -f "$top_pkg/package.json" ] && top_pkg_ver="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$top_pkg/package.json','utf8')).version)" 2>/dev/null || true)"
    pnpm_pkg_ver="${pkg_dir_name##*@}"  # brace-expansion@5.0.2 → 5.0.2
    if [ -n "$top_pkg_ver" ] && [ -n "$pnpm_pkg_ver" ] && [ "$top_pkg_ver" != "$pnpm_pkg_ver" ]; then
      continue  # Skip — this .pnpm entry is for a different version than what's at top-level
    fi

    # Check each dep in the package's .pnpm node_modules
    for dep in "$pkg_store"/*; do
      [ -d "$dep" ] || continue
      dep_name="$(basename "$dep")"
      [ "$dep_name" = "$pkg_name" ] && continue  # Skip self
      [ "${dep_name#.}" != "$dep_name" ] && continue  # Skip dotfiles

      # Compare version with top-level
      top_dep="$DEPLOY_DIR/node_modules/$dep_name"
      [ -d "$top_dep" ] || continue  # Not at top level — skip

      dep_ver=""
      top_ver=""
      [ -f "$dep/package.json" ] && dep_ver="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$dep/package.json','utf8')).version)" 2>/dev/null || true)"
      [ -f "$top_dep/package.json" ] && top_ver="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$top_dep/package.json','utf8')).version)" 2>/dev/null || true)"

      if [ -n "$dep_ver" ] && [ -n "$top_ver" ] && [ "$dep_ver" != "$top_ver" ]; then
        mkdir -p "$top_pkg/node_modules"
        if [ ! -e "$top_pkg/node_modules/$dep_name" ]; then
          cp -R "$dep" "$top_pkg/node_modules/$dep_name" 2>/dev/null || true
          echo "  Fixed: $pkg_name@$top_pkg_ver needs $dep_name@$dep_ver (top-level has v$top_ver)"
        fi
      fi
    done
  done
fi

# Final cleanup: remove any remaining broken symlinks
find "$DEPLOY_DIR/node_modules" -type l ! -exec test -e {} \; -delete 2>/dev/null || true

# Remove openclaw's own node_modules — only contains back-references to
# workspace packages. All real deps are already hoisted to the top level.
# This MUST run after symlink resolution (which can recreate it from .pnpm store).
echo "[prepare-gateway] Removing openclaw internal node_modules..."
rm -rf "$DEPLOY_DIR/node_modules/openclaw/node_modules" 2>/dev/null || true

# Override root .gitignore so electron-builder includes node_modules
touch "$DEPLOY_DIR/.npmignore"

FINAL_SIZE=$(du -sh "$DEPLOY_DIR" | cut -f1)
echo "[prepare-gateway] Done. Bundle size: $FINAL_SIZE"
