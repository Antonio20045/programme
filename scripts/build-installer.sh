#!/usr/bin/env bash
set -euo pipefail

# Build installer for the current platform (unsigned, for local testing).
# Usage:
#   bash scripts/build-installer.sh          # auto-detect platform
#   bash scripts/build-installer.sh --mac    # force macOS
#   bash scripts/build-installer.sh --win    # force Windows
#   bash scripts/build-installer.sh --linux  # force Linux

# Disable code signing for local builds
export CSC_IDENTITY_AUTO_DISCOVERY=false

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

# Determine platform
PLATFORM=""
if [[ "${1:-}" == "--mac" ]]; then
  PLATFORM="--mac"
elif [[ "${1:-}" == "--win" ]]; then
  PLATFORM="--win"
elif [[ "${1:-}" == "--linux" ]]; then
  PLATFORM="--linux"
else
  case "$(uname -s)" in
    Darwin)  PLATFORM="--mac" ;;
    Linux)   PLATFORM="--linux" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="--win" ;;
    *)
      echo "Unknown platform: $(uname -s)"
      exit 1
      ;;
  esac
fi

echo "==> Building electron-vite..."
pnpm --filter @ki-assistent/desktop build

echo "==> Building installer ($PLATFORM)..."
cd "$DESKTOP_DIR"
npx electron-builder --config electron-builder.yml "$PLATFORM"

echo ""
echo "==> Output:"
ls -la "$DESKTOP_DIR/release/" 2>/dev/null || echo "  (no output found)"
