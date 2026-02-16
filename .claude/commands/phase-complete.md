---
description: Phase abschließen mit allen Checks, Security-Scan, CLAUDE.md Update, Commit und Pull Request
argument_hint: "[phase-nr] | [nächster-schritt]"
---

Phase abschließen: $ARGUMENTS

1. pnpm typecheck — muss fehlerfrei sein
2. pnpm lint — muss fehlerfrei sein
3. pnpm test — alle Tests grün
4. pnpm audit-deps — 0 Findings
5. Nutze den security-auditor für Komplett-Scan
6. CLAUDE.md Komplett-Review:
   a) Aktueller Stand aktualisieren:
      - Phase: [nr] — abgeschlossen
      - Nächster Schritt: [nächster-schritt]
      - Letzter Commit: [commit message]
   b) Projektstruktur: Stimmt der Baum noch? Neue Ordner/Dateien ergänzen, gelöschte entfernen.
   c) Architektur/Nachrichtenfluss: Passen die Beschreibungen noch oder hat sich etwas geändert?
   d) Caveats/Regeln: Neue Regeln die in dieser Phase dazugekommen sind?
   e) Tool-Interface: Neue Tools oder geänderte Interfaces dokumentieren.
   f) Wenn CLAUDE.md über 300 Zeilen: Inhalte in .claude/rules/ auslagern.
7. git add -A && git commit -m '[passende commit message]'
8. git push
9. Erstelle einen Pull Request via GitHub MCP:
   - Titel: 'Phase [nr] abgeschlossen'
   - Beschreibung: Was in dieser Phase gemacht wurde
   - Base: main
   - Head: aktueller Branch
10. Warte auf automatisches Review von Claude
11. Zeige mir das Review-Ergebnis

Wenn ein Check fehlschlägt: FIX IT bevor du weitergehst. NIE mit Fehlern committen.
Wenn das Review Probleme findet: Fixen, erneut committen und pushen.
