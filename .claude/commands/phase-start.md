---
description: Neue Phase starten mit Branch, Context-Check und Stand-Überprüfung
argument_hint: "[phase-nr] | [phase-name]"
---

Phase starten: $ARGUMENTS

1. Lies CLAUDE.md komplett — verstehe den aktuellen Stand, die Architektur und alle Regeln.
2. /context prüfen — über 60%? /compact mit Fokus auf die neue Phase.
3. Feature Branch erstellen: `git checkout -b phase-$ARGUMENTS` (Nummer + Name aus Argument)
4. Prüfe ob die vorherige Phase sauber abgeschlossen ist:
   - `pnpm typecheck` — fehlerfrei?
   - `pnpm lint` — fehlerfrei?
   - `pnpm test` — alle grün?
   - Letzter Commit im CLAUDE.md "Aktueller Stand" stimmt?
5. Wenn ein Check fehlschlägt: STOPP. Melde was kaputt ist. Nicht weitermachen.
