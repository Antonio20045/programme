---
description: Vierfacher Security-Audit mit adversarialer Debate
---

Führe einen vierfachen Security-Audit durch:

Schritt 1: /security-review (Claude Code built-in)
Schritt 2: Nutze den security-auditor Agent
Schritt 3: Manuelle grep-Checks:
   grep -rn "eval(\|new Function(\|\.exec(" apps/ packages/ --include="*.ts" --exclude-dir=node_modules
   grep -rn "sk-\|PRIVATE_KEY\|password=" apps/ packages/ --include="*.ts" --exclude-dir=node_modules
   grep -rn "innerHTML\|dangerouslySetInnerHTML" apps/ packages/ --include="*.ts" --exclude-dir=node_modules
Schritt 4: Nutze den devils-advocate im Security-Debate Modus für alle Findings

Nur CONFIRMED Findings reporten. FALSE POSITIVES markieren und erklären warum.
