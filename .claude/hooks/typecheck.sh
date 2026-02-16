#!/bin/bash
# Hook: TypeScript type-check after .ts/.tsx changes and on Stop
# Used by PostToolUse (Write|Edit) and Stop events

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
OUTPUT=$(npx tsc --noEmit 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo "TypeScript errors found:" >&2
  echo "$OUTPUT" >&2
  exit 2
fi

exit 0
