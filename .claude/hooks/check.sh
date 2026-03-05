#!/bin/bash
# Hook: TypeScript check after .ts/.tsx changes — package-scoped for speed
# Zero output on success, max 5 error lines on failure

INPUT=$(cat)

# Prevent infinite loop in Stop hooks
if echo "$INPUT" | grep -q '"stop_hook_active"'; then
  exit 0
fi

# Extract file_path
FILE=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

# PostToolUse: skip if not a .ts/.tsx file
if [ -n "$FILE" ] && [[ "$FILE" != *.ts && "$FILE" != *.tsx ]]; then
  exit 0
fi

# Determine which package was changed and run scoped typecheck
if [ -n "$FILE" ]; then
  if [[ "$FILE" == apps/desktop/* ]]; then
    TS_OUTPUT=$(cd apps/desktop && npx tsc --noEmit 2>&1)
  elif [[ "$FILE" == apps/mobile/* ]]; then
    TS_OUTPUT=$(cd apps/mobile && npx tsc --noEmit 2>&1)
  elif [[ "$FILE" == packages/tools/* ]]; then
    TS_OUTPUT=$(cd packages/tools && npx tsc --noEmit 2>&1)
  elif [[ "$FILE" == packages/shared/* ]]; then
    TS_OUTPUT=$(cd packages/shared && npx tsc --noEmit 2>&1)
  elif [[ "$FILE" == packages/gateway/* ]]; then
    # Gateway ist OpenClaw Fork — Skip TypeScript (hat eigene Config)
    exit 0
  else
    # Fallback: Full check für unbekannte Pfade
    TS_OUTPUT=$(npx tsc --noEmit 2>&1)
  fi
else
  # Stop-Hook (kein FILE): Full check
  TS_OUTPUT=$(npx tsc --noEmit 2>&1)
fi

TS_STATUS=$?

if [ $TS_STATUS -ne 0 ]; then
  echo "TypeScript ($FILE):" >&2
  echo "$TS_OUTPUT" | head -5 >&2
  exit 2
fi

# ESLint nur im Stop-Hook (nicht bei jedem Edit — zu langsam)
if [ -z "$FILE" ]; then
  LINT_OUTPUT=$(pnpm lint 2>&1)
  LINT_STATUS=$?
  if [ $LINT_STATUS -ne 0 ]; then
    echo "ESLint:" >&2
    echo "$LINT_OUTPUT" | head -5 >&2
    exit 2
  fi
fi

# Contract check (nur im Stop-Hook)
if [ -z "$FILE" ]; then
  for CONTRACT in tasks/contracts/*.contract.md; do
    [ -f "$CONTRACT" ] || continue
    UNCHECKED=$(grep -c '^\- \[ \]' "$CONTRACT" 2>/dev/null || echo "0")
    if [ "$UNCHECKED" -gt 0 ]; then
      echo "Contract nicht erfüllt: $(basename "$CONTRACT") — $UNCHECKED offene Kriterien" >&2
      echo "Erfülle alle Kriterien oder lösche den Contract (User: 'Contract abbrechen')." >&2
      exit 2
    fi
  done
fi

exit 0
