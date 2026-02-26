#!/bin/sh
set -e

CONFIG_DIR="/home/node/.openclaw"
CONFIG_FILE="${CONFIG_DIR}/openclaw.json"
mkdir -p "$CONFIG_DIR"

# ── Base Config (immer gesetzt) ──────────────────────────────
cat > "$CONFIG_FILE" <<'EOF'
{
  "gateway": {
    "controlUi": { "enabled": false },
    "trustedProxies": []
  },
  "plugins": {
    "entries": {
      "in-app-channel": { "enabled": true }
    }
  }
}
EOF

# ── Trusted Proxies ──────────────────────────────────────────
# TRUSTED_PROXY_CIDRS: kommaseparierte CIDRs → JSON Array
TRUSTED_PROXY_CIDRS="${TRUSTED_PROXY_CIDRS:-100.64.0.0/10,10.0.0.0/8,172.16.0.0/12}"
node -e "
  const fs = require('fs');
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
  cfg.gateway.trustedProxies = process.argv[2].split(',').map(s => s.trim()).filter(Boolean);
  fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
" "$CONFIG_FILE" "$TRUSTED_PROXY_CIDRS"

# ── Gateway Auth Mode (optional) ─────────────────────────────
# GATEWAY_AUTH_MODE: "token" (default) oder "trusted-proxy"
if [ -n "${GATEWAY_AUTH_MODE:-}" ]; then
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
    cfg.gateway.auth = cfg.gateway.auth || {};
    cfg.gateway.auth.mode = process.argv[2];
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  " "$CONFIG_FILE" "$GATEWAY_AUTH_MODE"
fi

# ── Weitere ENV Vars hier hinzufuegen ────────────────────────
# Sicherheits-Pattern: IMMER process.argv statt String-Interpolation!
# if [ -n "${GATEWAY_SOME_OPTION:-}" ]; then
#   node -e "
#     const fs = require('fs');
#     const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
#     cfg.gateway.someOption = process.argv[2];
#     fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
#   " "$CONFIG_FILE" "$GATEWAY_SOME_OPTION"
# fi

echo "[entrypoint] Generated ${CONFIG_FILE}:"
cat "$CONFIG_FILE"

exec node openclaw.mjs gateway "$@"
