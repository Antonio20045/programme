#!/bin/bash
# Hook: Check for high/critical vulnerabilities after package.json changes
# Zero output on clean, summary only on findings

AUDIT_OUTPUT=$(pnpm audit --audit-level=high 2>&1)
AUDIT_STATUS=$?

if [ $AUDIT_STATUS -ne 0 ]; then
  echo "$AUDIT_OUTPUT" | tail -5 >&2
  exit 2
fi

exit 0
