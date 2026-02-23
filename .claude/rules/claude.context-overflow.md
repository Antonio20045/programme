# Context-Overflow Regel

Wenn du bei einem Problem nicht weiterkommst oder der Context knapp wird,
erstelle SOFORT ein Handoff-Dokument. Frag NICHT nach — mach es einfach.

## Wann

- Du hast mehrere Ansätze probiert und der gleiche oder ähnliche Fehler kommt immer wieder
- Der Context wird knapp (bei über 60% sofort /clear und Handoff schreiben. NICHT /compact verwenden)
- Das Problem zieht immer mehr Dateien/Abhängigkeiten rein und wird größer statt kleiner

## Was tun

1. Erstelle `.claude/rules/HANDOFF-<thema>.md` (Großbuchstaben damit es auffällt)
2. Nutze exakt dieses Template:

---

# Handoff: [Kurze Problem-Beschreibung]

Datum: [YYYY-MM-DD HH:MM]
Phase: [Aktuelle Phase aus dem Entwicklungsablauf]
Betroffene Dateien: [Liste]

## 1. Ziel
Was sollte erreicht werden? Was war der ursprüngliche Prompt/Task?

## 2. Kontext
Welche Phase? Welcher Stand? Was funktioniert bereits?

## 3. Das Problem
Was genau geht schief? Exakte Fehlermeldung(en).

## 4. Was wurde versucht
| # | Ansatz | Ergebnis |
|---|--------|----------|
| 1 | [Beschreibung] | [Fehler/Teilerfolg] |
| 2 | [Beschreibung] | [Fehler/Teilerfolg] |
| 3 | [Beschreibung] | [Fehler/Teilerfolg] |

## 5. Erkenntnisse
Was wurde dabei gelernt? Was kann ausgeschlossen werden?

## 6. Hypothesen
Was könnte die Ursache sein? Sortiert nach Wahrscheinlichkeit:
- [ ] Hypothese A (wahrscheinlichste)
- [ ] Hypothese B
- [ ] Hypothese C

## 7. Empfohlene nächste Schritte
1. [Konkreter nächster Schritt]
2. [Alternativer Ansatz falls 1 nicht klappt]
3. [Nuclear Option / komplett anderer Weg]

## 8. Relevante Code-Stellen
- `pfad/zur/datei.ts` Zeile XX-YY: [Was dort relevant ist]
- `pfad/zur/anderen/datei.ts` Zeile XX-YY: [Was dort relevant ist]

## 9. Nützliche Befehle
```bash
# Fehler reproduzieren:
[Befehl]

# Aktuellen Stand testen:
[Befehl]
```

---

3. Sag dem User: "Handoff erstellt. Starte eine neue Session — ich habe alles dokumentiert."

## Nach dem Lösen

Wenn das Problem in der nächsten Session gelöst wird:
- Verschiebe das Handoff nach `docs/handoff/` als Archiv
- Oder lösche es aus `.claude/rules/` damit es nicht weiter Context frisst
