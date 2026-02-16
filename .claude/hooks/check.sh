#!/bin/bash
# Hook: TypeScript + ESLint after .ts/.tsx changes and on Stop
# Zero output on success, max 5 error lines on failure

INPUT=$(cat)

# Prevent infinite loop in Stop hooks
if echo "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Extract file_path (only present in PostToolUse events)
FILE=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

# PostToolUse: skip if not a .ts/.tsx file
if [ -n "$FILE" ] && [[ "$FILE" != *.ts && "$FILE" != *.tsx ]]; then
  exit 0
fi

# Run TypeScript type checking
TS_OUTPUT=$(npx tsc --noEmit 2>&1)
TS_STATUS=$?

if [ $TS_STATUS -ne 0 ]; then
  echo "TypeScript:" >&2
  echo "$TS_OUTPUT" | head -5 >&2
  exit 2
fi

# Run ESLint (only after successful TypeScript)
LINT_OUTPUT=$(npx eslint --no-error-on-unmatched-pattern 'apps/**/*.{ts,tsx}' 'packages/**/*.{ts,tsx}' 2>&1)
LINT_STATUS=$?

if [ $LINT_STATUS -ne 0 ]; then
  echo "ESLint:" >&2
  echo "$LINT_OUTPUT" | head -5 >&2
  exit 2
fi

exit 0
