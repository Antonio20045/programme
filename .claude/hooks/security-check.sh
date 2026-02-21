#!/bin/bash
# Hook: Security pattern scan on changed file
# Zero output on clean, one line per finding on match

INPUT=$(cat)

# Extract file_path
FILE=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

# Skip if no file or not .ts/.tsx
if [ -z "$FILE" ] || [[ "$FILE" != *.ts && "$FILE" != *.tsx ]]; then
  exit 0
fi

# Skip if file doesn't exist
if [ ! -f "$FILE" ]; then
  exit 0
fi

# Skip scanner scripts (they contain patterns as search strings)
BASENAME=$(basename "$FILE")
if [[ "$BASENAME" == "audit-deps.ts" || "$BASENAME" == "security-check.sh" || "$BASENAME" == risk-policy-gate* ]]; then
  exit 0
fi

FOUND=0
while IFS= read -r line; do
  LINENO_NUM=$(echo "$line" | cut -d: -f1)
  for pattern in 'eval(' 'new Function(' '.exec(' 'innerHTML' 'dangerouslySetInnerHTML' 'sk-' 'PRIVATE_KEY' 'password='; do
    if echo "$line" | grep -qF "$pattern"; then
      echo "SECURITY: [$pattern] in \"$FILE\":$LINENO_NUM" >&2
      FOUND=1
    fi
  done
done < <(grep -n -F -e 'eval(' -e 'new Function(' -e '.exec(' -e 'innerHTML' -e 'dangerouslySetInnerHTML' -e 'sk-' -e 'PRIVATE_KEY' -e 'password=' "$FILE" 2>/dev/null)

if [ $FOUND -ne 0 ]; then
  exit 2
fi

exit 0
