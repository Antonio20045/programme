---
description: "Rules und Skills konsolidieren — Widersprüche, Redundanzen, Context-Budget prüfen."
---

Konsolidiere die Agent-Konfiguration:

1. Nutze das **Task tool** mit dieser Aufgabe:
   "Lies ALLE Dateien in .claude/rules/, .claude/commands/, .claude/agents/ und die CLAUDE.md. Prüfe auf:
   a) WIDERSPRÜCHE zwischen Rules
   b) REDUNDANZEN (doppelte Inhalte)
   c) CONTEXT-BUDGET: Gesamtlänge aller Dateien die bei einem typischen Task gelesen werden (CLAUDE.md + referenzierte Rules). Wenn > 3000 Wörter: Zusammenlegungen vorschlagen
   d) TOTE REFERENZEN: CLAUDE.md verweist auf nicht-existierende Dateien?
   e) FEHLENDE REFERENZEN: Rule-Dateien die nirgends referenziert werden?
   Schreibe Ergebnisse nach tasks/consolidation-report.md"

2. Zeige dem User den Report und warte auf Bestätigung bevor irgendwas geändert wird.
