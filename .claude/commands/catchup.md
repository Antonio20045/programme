---
description: "Kontext wiederherstellen nach /clear. Liest geänderte Dateien und aktiven Fortschritt."
---

Stelle den Kontext wieder her:

1. Lies .claude/rules/HANDOFF-*.md falls vorhanden — das sind aktive Probleme aus der letzten Session
2. Führe aus: git log --oneline -10
3. Führe aus: git diff main --name-only (um zu sehen was auf diesem Branch geändert wurde)
4. Lies die CLAUDE.md für den aktuellen Stand
5. Fasse zusammen:
   - Aktuelle Phase und was der nächste Schritt ist
   - Welche Dateien zuletzt geändert wurden
   - Ob es aktive Handoff-Dokumente gibt (= ungelöste Probleme)
6. Frage: "Was soll ich als nächstes tun?"
