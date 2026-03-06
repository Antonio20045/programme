# Research: Warum der Assistent den Browser auf dem Desktop nicht verwenden kann

## Fragestellung

Warum kann der KI-Assistent das Browser-Tool in der Desktop-App nicht nutzen? Was sind die technischen Blocker und welche Lösungsansätze gibt es?

## Ist-Zustand

### Browser-Tool (`packages/tools/src/browser.ts`)
- `runsOn: 'desktop'` — das Tool soll auf dem Desktop-Rechner laufen, nicht auf dem Server
- Nutzt **Playwright** (headless Chromium) via `dynamic import('playwright')`
- `requiresConfirmation: true`, `defaultRiskTier: 3`
- Bietet 14 Actions: openPage, screenshot, fillForm, clickElement, snapshot, type, select, fill, cookies, waitFor, openSession, closeSession, fillCredential, healthCheck
- Wird in `register.ts` Zeile 235 als statisches Desktop-Tool registriert (kein Adapter-Pattern)

### Desktop Agent (`apps/desktop/src/main/agent.ts`)
- Verbindet sich per WebSocket zum Gateway (`DesktopAgentBridge`)
- Ruft `initTools()` mit Electron-Adaptern auf (clipboard, screenshot, git, appLauncher, mediaControl)
- Empfängt `tool_request` vom Gateway, führt `getTool(toolName).execute(params)` aus
- **Kein Browser-Adapter** wird injiziert — Browser-Tool wird als "static desktop tool" registriert

### Tool-Router (`packages/gateway/tool-router.ts`)
- `createConfirmableTools()` wrappet Tools mit `runsOn: 'desktop'` → routet via `DesktopAgentBridge`
- Confirmation-Flow: Gateway sendet `tool_confirm` SSE → User bestätigt → Gateway sendet `tool_request` an Desktop Agent

## Problem-Analyse

Es gibt **drei Blocker**, die verhindern, dass das Browser-Tool funktioniert:

### Blocker 1: Playwright ist nicht installiert
- Playwright ist in **keiner** `package.json` als Dependency aufgeführt (weder root, noch desktop, noch tools)
- `node_modules/playwright` existiert nicht
- Der dynamic import in `browser.ts` Zeile 513-523 schlägt fehl mit: *"Browser-Automatisierung nicht verfuegbar. Das Paket playwright ist nicht installiert."*
- Dies ist der **primäre Blocker** — das Tool kann gar nicht initialisiert werden

### Blocker 2: Confirmation-Flow blockiert Execution
- `browserTool.requiresConfirmation = true` (Zeile 1043)
- Im Desktop Agent (`agent.ts` Zeile 487-495): Wenn `tool.requiresConfirmation` true ist, sendet der Agent `tool_confirmation_required` zurück an den Gateway, statt das Tool auszuführen
- **Aber:** Der Gateway-seitige `tool-router.ts` behandelt `tool_confirmation_required` **nicht** als gültigen Message-Type in `handleMessage()` (Zeile 437-469) — nur `tool_result`, `tool_error`, und `pong` werden verarbeitet
- Ergebnis: Die Bestätigung vom Desktop-Agent wird ignoriert, das Tool hängt bis zum 60s-Timeout

### Blocker 3: Electron Sandbox vs. Playwright
- Die Desktop-App läuft mit `sandbox: true` und `contextIsolation: true`
- Playwright startet eigene Chromium-Instanzen als Child-Processes
- In einem gesandboxten Electron-Main-Process funktioniert das prinzipiell, aber:
  - Playwright braucht schreibbare Temp-Directories
  - Die Browser-Binaries müssen separat installiert werden (`npx playwright install chromium`)
  - macOS Gatekeeper kann Playwright-Binaries blockieren wenn sie nicht signiert sind

## Optionen

### Option A: Playwright als optionale Desktop-Dependency installieren
**Beschreibung:** Playwright als `optionalDependency` in `apps/desktop/package.json` hinzufügen, Chromium-Binaries beim Build/Setup installieren.

**Pro:**
- Geringster Code-Aufwand — das Browser-Tool ist bereits implementiert
- Playwright ist battle-tested und stabil
- Persistent Context (Login-Sessions) funktioniert out-of-the-box

**Contra:**
- Playwright + Chromium = ~250-400 MB zusätzliche App-Größe
- Browser-Binaries müssen bei jedem Update mitgeliefert oder nachinstalliert werden
- macOS Code-Signing-Problematik mit Playwright-Binaries
- Blocker 2 (Confirmation-Flow) muss trotzdem gefixt werden

**Aufwand:** Mittel (Dependency + Build-Pipeline + Confirmation-Fix)

### Option B: Electron BrowserView/BrowserWindow statt Playwright
**Beschreibung:** Statt Playwright die eingebaute Chromium-Engine von Electron nutzen. Ein `BrowserView` oder neues `BrowserWindow` als "Browser-Automatisierung" verwenden.

**Pro:**
- Keine zusätzliche Binary — Electron hat bereits Chromium
- Keine App-Größen-Zunahme
- Natürliche Integration in die Desktop-App
- User kann den Browser sehen und interagieren

**Contra:**
- Erheblicher Umbau des Browser-Tools nötig (neues Adapter-Pattern wie bei clipboard/screenshot)
- Electron-API ist weniger mächtig als Playwright (kein `accessibility.snapshot()`, kein `waitForSelector()`)
- `webContents.executeJavaScript()` hat Security-Implikationen (kein `eval` Regel)
- Session-Isolation und Cookie-Management müssen manuell gebaut werden

**Aufwand:** Hoch (neues Adapter-Interface + Electron-spezifische Implementierung)

### Option C: Playwright als separater Sidecar-Process
**Beschreibung:** Playwright in einem eigenen Node.js-Process starten (nicht im Electron-Main), der über IPC/WebSocket mit dem Desktop Agent kommuniziert.

**Pro:**
- Saubere Prozess-Isolation (Browser-Crashes betreffen nicht die App)
- Playwright-API vollständig verfügbar
- Kann unabhängig vom Electron-Lifecycle gestartet/gestoppt werden
- Kein Sandbox-Konflikt

**Contra:**
- Playwright muss trotzdem installiert werden (Größe-Problem bleibt)
- Zusätzlicher Process-Management-Overhead
- IPC zwischen Desktop Agent und Sidecar muss gebaut werden
- Debugging wird komplexer (3 Processes: Electron + Gateway + Browser-Sidecar)

**Aufwand:** Hoch (Sidecar-Architektur + IPC + Process-Management)

### Option D: Playwright nur on-demand installieren
**Beschreibung:** Playwright wird nicht mitgebundelt sondern erst installiert wenn der User das Browser-Tool zum ersten Mal nutzt (`npx playwright install chromium`).

**Pro:**
- App bleibt schlank für User die den Browser nicht brauchen
- Einmalige Installation, danach verfügbar
- Einfachster Weg den primären Blocker zu lösen

**Contra:**
- Erste Nutzung dauert lang (Download ~150-250 MB)
- Netzwerk-Abhängigkeit bei Erstinstallation
- Update-Management für Chromium-Binary
- User-Experience bei der Erstinstallation muss gestaltet werden
- Blocker 2 und 3 bleiben bestehen

**Aufwand:** Mittel (Install-Flow + UI-Feedback + Confirmation-Fix)

## Unabhängig von der Option: Confirmation-Flow Fix nötig

Der `tool_confirmation_required` Message-Type, den der Desktop Agent sendet (agent.ts:489), wird vom Gateway **nicht verarbeitet**. Das muss in jedem Fall gefixt werden:

1. **Option:** Confirmation im Desktop Agent entfernen — der Gateway hat bereits seinen eigenen Confirmation-Flow via `ConfirmationManager` + SSE `tool_confirm` Events (tool-router.ts:156-181). Desktop-Tools mit `requiresConfirmation: true` werden schon VOR dem Routing zum Desktop Agent bestätigt.

2. **Oder:** `tool_confirmation_required` als Message-Type in `DesktopAgentBridge.handleMessage()` implementieren.

Option 1 ist sauberer: Der Gateway handhabt Confirmation zentral, der Desktop Agent führt nur aus.

## Empfehlung

**Option A (Playwright als Dependency) + Confirmation-Fix**, konkret:

1. `playwright` als `optionalDependency` in `apps/desktop/package.json`
2. `npx playwright install chromium` als post-install Script
3. `requiresConfirmation`-Check im Desktop Agent entfernen (agent.ts:487-495) — Gateway handled das bereits
4. Testen ob Playwright im Electron-Main-Process korrekt startet

Falls die App-Größe ein Problem ist: **Option D** (on-demand Install) als Kompromiss.

## Referenzen

| Datei | Relevante Zeilen | Bedeutung |
|-------|------------------|-----------|
| `packages/tools/src/browser.ts` | 507-524 | Playwright dynamic import + Fehlerbehandlung |
| `packages/tools/src/browser.ts` | 1035-1046 | Tool-Definition (runsOn, riskTiers, requiresConfirmation) |
| `packages/tools/src/register.ts` | 235 | Browser-Tool als statisches Desktop-Tool registriert |
| `apps/desktop/src/main/agent.ts` | 329-340 | initTools() — kein Browser-Adapter |
| `apps/desktop/src/main/agent.ts` | 473-510 | executeToolRequest() — Confirmation-Block |
| `apps/desktop/src/main/agent.ts` | 487-495 | tool_confirmation_required — nicht vom Gateway verarbeitet |
| `packages/gateway/tool-router.ts` | 437-469 | handleMessage() — nur tool_result/tool_error/pong |
| `packages/gateway/tool-router.ts` | 541-601 | createConfirmableTools() — Confirmation VOR Desktop-Routing |
