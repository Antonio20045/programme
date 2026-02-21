---
description: Phase abschließen mit allen Checks, Security-Scan, CLAUDE.md Update, Commit und PR erstellen
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
8. git push -u origin aktueller-branch
9. Pull Request erstellen (NICHT direkt mergen — Risk Policy Gate muss durchlaufen):
   - gh pr create --base main --title "Phase [nr] complete: [commit message]" --body "## Summary\n\n[Kurze Zusammenfassung der Phase]\n\n## Checks\n\n- [x] typecheck\n- [x] lint\n- [x] test\n- [x] audit-deps\n- [x] security-audit\n- [ ] Risk Policy Gate (läuft automatisch)\n\n## Next Step\n\n[nächster-schritt]"
   - PR-URL dem User anzeigen
   - Hinweis: "PR erstellt. Warte bis das Risk Policy Gate und alle CI Checks grün sind, dann manuell mergen."
   - NICHT automatisch mergen. KEIN gh pr merge. Der User merged manuell.

Wenn ein Check fehlschlägt: FIX IT bevor du weitergehst. NIE mit Fehlern committen.
Wenn das Review Probleme findet: Fixen, erneut committen und pushen.
