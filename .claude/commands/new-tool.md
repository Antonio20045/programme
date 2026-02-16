---
description: Erstellt ein neues Tool mit korrektem Interface, Tests und Security-Checks
argument_hint: "[name] | [beschreibung]"
---

Erstelle ein neues Tool basierend auf: $ARGUMENTS

1. Lies @packages/tools/src/ um das bestehende Pattern zu verstehen
2. Erstelle packages/tools/src/[name].ts:
   - Implementiere das ToolDefinition Interface aus @CLAUDE.md
   - name, description, permissions, actions, requiresConfirmation
   - Input-Validierung für JEDE Aktion
   - Fehlerbehandlung mit try/catch
3. Erstelle packages/tools/__tests__/[name].test.ts:
   - Happy Path Tests für jede Aktion
   - Edge Case Tests (leere Inputs, ungültige Typen)
   - Security Tests:
     * Kein eval() oder Function() im Code
     * Kein child_process.exec() (nur execFile/spawn)
     * Path Traversal Test wenn Dateizugriff
     * Kein unauthorisierter fetch
4. Führe aus: pnpm typecheck && pnpm lint && pnpm test
5. Nutze den security-auditor für einen Scan
