---
description: "Debugge ein Problem mit Runtime-First Ansatz. Niemals raten."
argument_hint: "[Beschreibung des Problems]"
---

Debugge dieses Problem: $ARGUMENTS

WORKFLOW (in dieser Reihenfolge, keine Schritte überspringen):

1. VERSTEHEN: Was genau ist das erwartete vs. tatsächliche Verhalten?
2. REPRODUZIEREN: Führe den relevanten Befehl aus (pnpm dev, pnpm test, etc.)
   und lies die KOMPLETTE Ausgabe. Poste die Fehlermeldung.
3. HYPOTHESE: Basierend auf der Fehlermeldung, wo liegt das Problem vermutlich?
4. LOGGING: Füge console.log Statements ein um die Hypothese zu bestätigen/widerlegen.
5. AUSFÜHREN: Starte erneut, lies die Log-Ausgabe.
6. FIX: Basierend auf der EVIDENZ, implementiere einen minimalen Fix.
7. VERIFY: Führe erneut aus und bestätige dass es funktioniert.
8. CLEANUP: Entferne Debug-Logs.

Wenn nach 2 Fix-Versuchen das Problem weiterhin besteht:
→ Erstelle ein Handoff-Dokument (.claude/rules/HANDOFF-<thema>.md)
→ Sage: "Handoff erstellt. Starte /clear und dann /catchup."

VERBOTEN: Code statisch analysieren und "Root Cause" raten ohne Runtime-Output.
