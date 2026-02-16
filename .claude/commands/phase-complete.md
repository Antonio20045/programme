---
description: Phase abschließen mit allen Checks, Security-Scan, CLAUDE.md Update und Commit
argument_hint: "[phase-nr] | [nächster-schritt]"
---

Phase abschließen: $ARGUMENTS

1. pnpm typecheck — muss fehlerfrei sein
2. pnpm lint — muss fehlerfrei sein
3. pnpm test — alle Tests grün
4. pnpm audit-deps — 0 Findings
5. Nutze den security-auditor für Komplett-Scan
6. Ändere CLAUDE.md Abschnitt "Aktueller Stand":
   - Phase: [nr] — abgeschlossen
   - Nächster Schritt: [nächster-schritt]
   - Letzter Commit: [commit message]
7. git add -A && git commit -m '[passende commit message]'
8. git push

Wenn ein Check fehlschlägt: FIX IT bevor du weitergehst. NIE mit Fehlern committen.
