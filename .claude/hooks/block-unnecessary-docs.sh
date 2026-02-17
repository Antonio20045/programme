#!/bin/bash
# Block: Verhindert dass Claude unnötige .md/.txt Dateien erstellt
# Erlaubt: README.md, CLAUDE.md, CONTRIBUTING.md, docs/*, CHANGELOG.md
INPUT=$(cat)
FILE=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')

if [ -z "$FILE" ]; then
  exit 0
fi

# Nur .md und .txt prüfen
if [[ "$FILE" != *.md && "$FILE" != *.txt ]]; then
  exit 0
fi

BASENAME=$(basename "$FILE")

# Erlaubte Dateien
case "$BASENAME" in
  README.md|CLAUDE.md|CONTRIBUTING.md|CHANGELOG.md|AGENTS.md)
    exit 0
    ;;
esac

# Erlaubte Pfade (relativ und absolut)
if [[ "$FILE" == docs/* || "$FILE" == */docs/* || "$FILE" == .claude/* || "$FILE" == */.claude/* || "$FILE" == *SKILL.md || "$FILE" == *.plan.md ]]; then
  exit 0
fi

echo "BLOCKED: Unnötige Doku-Datei '$FILE'. Nutze docs/ oder README.md stattdessen." >&2
exit 2
