# Task Contracts

Ein Task Contract definiert Abnahmekriterien. Du darfst einen Task NICHT als abgeschlossen melden, solange nicht alle Bedingungen erfüllt sind.

## Wann erstellen

- Vom User: Vor Task-Beginn als `tasks/contracts/<name>.contract.md`
- Vom Agent im Plan-Mode: Wenn der User zustimmt
- Nicht nötig für triviale Fixes (< 3 Schritte)

## Format

# Contract: [Task-Name]

## Akzeptanzkriterien
- [ ] [Messbar/verifizierbar]

## Tests
- [ ] [Test-Datei oder Befehl der grün sein muss]

## Verifikation
- [ ] pnpm typecheck
- [ ] pnpm lint

## Ablauf

1. Vor Task-Start: Contract lesen
2. Während der Arbeit: Kriterien als Checkliste abarbeiten
3. Vor Task-Abschluss: ALLE Kriterien prüfen, im Contract abhaken
4. Offene Kriterien → weiterarbeiten, NICHT stoppen

## Task abbrechen

Wenn ein Task abgebrochen werden soll: User sagt explizit "Contract abbrechen". Dann die .contract.md Datei löschen bevor du stoppst.
