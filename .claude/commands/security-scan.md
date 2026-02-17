---
description: "Fünffacher Security-Audit mit adversarialer Debate und optionalem Pentest"
argument_hint: "[--full für zusätzlichen Pentest]"
---

Führe einen fünffachen Security-Audit durch:

**Schritt 1:** /security-review (Claude Code built-in)

**Schritt 2:** Nutze den security-auditor Agent

**Schritt 3:** Manuelle grep-Checks (jeweils mit `--exclude-dir=node_modules --exclude-dir=gateway`):
```bash
# Code Injection
grep -rn "eval(\|new Function(\|\.exec(" apps/ packages/ --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=gateway

# Secrets
grep -rn "sk-\|PRIVATE_KEY\|password=\|api[_-]key" apps/ packages/ --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=gateway

# XSS / DOM Injection
grep -rn "innerHTML\|dangerouslySetInnerHTML\|insertAdjacentHTML\|document\.write" apps/ packages/ --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=gateway

# Electron Security Settings
grep -rn "nodeIntegration\|contextIsolation\|sandbox" apps/desktop/ --include="*.ts" --exclude-dir=node_modules
```

**Schritt 4:** Nutze den devils-advocate im Security-Debate Modus für alle Findings aus Schritt 1-3

**Schritt 5 (nur bei `--full`):** Nutze den pentester Agent für aktive Exploit-Verifikation aller CONFIRMED Findings

**Zusammenfassung:**
- Severity-Breakdown: X Critical, Y High, Z Medium, W Low
- Nur CONFIRMED Findings reporten
- FALSE POSITIVES markieren und erklären warum
- Bei `--full`: PoC-Ergebnisse vom Pentester anhängen
