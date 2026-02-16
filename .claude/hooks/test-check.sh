#!/bin/bash
# Hook: Check that tests exist and pass for changed source files
# Zero output on success, minimal output on failure

INPUT=$(cat)

# Extract file_path
FILE=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

# Skip if no file or not .ts/.tsx
if [ -z "$FILE" ] || [[ "$FILE" != *.ts && "$FILE" != *.tsx ]]; then
  exit 0
fi

# Skip if not in src/
if [[ "$FILE" != */src/* ]]; then
  exit 0
fi

# Skip if it IS a test file
if [[ "$FILE" == *.test.ts || "$FILE" == *.test.tsx || "$FILE" == *.spec.ts || "$FILE" == *.spec.tsx ]]; then
  exit 0
fi

# Skip config and docs
BASENAME=$(basename "$FILE")
if [[ "$BASENAME" == *.config.* || "$BASENAME" == *.d.ts || "$BASENAME" == index.ts ]]; then
  exit 0
fi

# Derive test path: packages/tools/src/gmail.ts → packages/tools/__tests__/gmail.test.ts
DIR=$(dirname "$FILE")
PARENT=$(dirname "$DIR")
STEM=$(basename "$FILE" .ts)
STEM=$(basename "$STEM" .tsx)
TEST_FILE="$PARENT/__tests__/$STEM.test.ts"

# Also check .test.tsx variant
TEST_FILE_TSX="$PARENT/__tests__/$STEM.test.tsx"

if [ ! -f "$TEST_FILE" ] && [ ! -f "$TEST_FILE_TSX" ]; then
  echo "TEST FEHLT: $TEST_FILE" >&2
  exit 2
fi

# Run the test
ACTUAL_TEST="$TEST_FILE"
if [ ! -f "$ACTUAL_TEST" ]; then
  ACTUAL_TEST="$TEST_FILE_TSX"
fi

TEST_OUTPUT=$(pnpm vitest run "$ACTUAL_TEST" --reporter=dot 2>&1)
TEST_STATUS=$?

if [ $TEST_STATUS -ne 0 ]; then
  echo "$TEST_OUTPUT" | tail -3 >&2
  exit 2
fi

exit 0
