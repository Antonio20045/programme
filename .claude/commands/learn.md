---
description: Pattern aus aktueller Session extrahieren und als Skill speichern
---

Analysiere die aktuelle Session und extrahiere Patterns die es wert sind gespeichert zu werden.

Suche nach:
1. Nicht-triviale Problemlösungen (Workarounds, unerwartete Fixes)
2. Architektur-Entscheidungen die getroffen wurden
3. Wiederkehrende Fehler und deren Lösung
4. Neue Erkenntnisse über OpenClaw, Electron oder das Tool-System

Für jedes gefundene Pattern, erstelle einen Eintrag in docs/learnings.md (erstelle die Datei falls sie nicht existiert):

Format pro Eintrag:

### [Beschreibender Name]
**Datum:** [heute]
**Kontext:** [Wann tritt das auf]
**Problem:** [Was war das Problem]
**Lösung:** [Wie wurde es gelöst]
**Beispiel:** [Code-Snippet falls relevant]

WICHTIG:
- NUR nicht-triviale Erkenntnisse — keine offensichtlichen Dinge
- Prüfe ob das Pattern schon in docs/learnings.md existiert bevor du es hinzufügst
- Maximal 3 Patterns pro Session — Qualität vor Quantität
- Wenn nichts Relevantes gefunden: sag das ehrlich
