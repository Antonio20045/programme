---
description: "Recherche in isoliertem Subagent. Ergebnis als Decision-Doc, keine Implementierung."
argument_hint: "[Fragestellung]"
---

Recherchiere: $ARGUMENTS

1. Nutze das **Task tool** mit dieser Aufgabe:
   "Recherchiere: $ARGUMENTS. Identifiziere mindestens 3 Optionen/Ansätze. Pro/Contra für jede Option. Empfehlung mit Begründung. Relevante Code-Beispiele oder Referenzen. Schreibe das Ergebnis nach tasks/research-<thema-kebab-case>.md"

2. Das Research-Doc soll dieses Format haben:
   - Fragestellung
   - Optionen (je mit Pro/Contra)
   - Empfehlung
   - Referenzen

3. Melde dem User: "Research fertig → tasks/research-<thema>.md. Entscheide welche Option, dann implementiere ich mit frischem Kontext."

WICHTIG: Dieser Command IMPLEMENTIERT NICHTS. Nur recherchieren und dokumentieren.
