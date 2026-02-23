# Learnings

Nicht-triviale Erkenntnisse aus Debugging-Sessions. Qualität vor Quantität.

---

### OpenClaw Extension Discovery braucht package.json mit openclaw.extensions
**Datum:** 2026-02-22
**Kontext:** Plugin wird nicht geladen, keine Logs, /health 404
**Problem:** Das In-App-Channel-Plugin wurde vom Gateway komplett ignoriert — keine Fehlermeldung, keine Logs, als ob es nicht existiert. Die Extension hatte eine `openclaw.plugin.json` und eine `index.ts`, aber wurde nie entdeckt.
**Lösung:** OpenClaw entdeckt Extensions durch Scannen nach `package.json`-Dateien mit einem `openclaw.extensions`-Array. Ohne diese Datei ist die Extension unsichtbar. Die `openclaw.plugin.json` allein reicht NICHT.
**Beispiel:**
```json
// packages/gateway/extensions/in-app-channel/package.json
{
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```
**Referenz:** `packages/gateway/src/extensions/discovery.ts` — scannt Verzeichnisse nach `package.json` mit `openclaw`-Feld.

---

### OpenClaw Plugin-Pfade müssen in Config registriert sein
**Datum:** 2026-02-22
**Kontext:** Plugin hat package.json, wird trotzdem nicht geladen
**Problem:** Nach Hinzufügen der `package.json` wurde das Plugin immer noch nicht geladen. OpenClaw scannt nicht alle Verzeichnisse automatisch — nur konfigurierte Pfade.
**Lösung:** Der Extension-Pfad muss in `~/.openclaw/openclaw.json` unter `plugins.load.paths` eingetragen sein. Die Desktop-App macht das jetzt automatisch in `ensureGatewayConfig()`.
**Beispiel:**
```json
// ~/.openclaw/openclaw.json
{
  "plugins": {
    "load": {
      "paths": ["/abs/path/to/extensions/in-app-channel"]
    }
  }
}
```
**Ladepriorität:** Config-Pfade → Workspace Extensions → Global Extensions → Bundled Extensions.

---

### Gateway-Daemon blockiert silently den Child-Process-Start
**Datum:** 2026-02-22
**Kontext:** `pnpm dev:desktop` startet, Gateway meldet "online", aber Port 18789 antwortet mit 404 auf alles
**Problem:** Ein alter Gateway-Daemon (LaunchAgent) lief noch auf Port 18789. Der von Electron gestartete Child-Process konnte den Port nicht binden, aber die Health-Checks im Main-Process meldeten trotzdem "online" (weil der alte Daemon auf dem Port antwortete).
**Lösung:** Vor dem Start prüfen ob ein Daemon läuft: `openclaw gateway stop` (macht `launchctl bootout`). Alternativ: Port-Check vor dem Spawn und klare Fehlermeldung wenn belegt.
**Diagnose-Befehle:**
```bash
lsof -i :18789          # Wer hört auf dem Port?
openclaw gateway stop    # Daemon stoppen
ps aux | grep openclaw   # Prozesse prüfen
```

---

### OpenClaw Config-Schema lehnt unbekannte Felder ab
**Datum:** 2026-02-22
**Kontext:** Eigene Felder in `~/.openclaw/openclaw.json` schreiben um App-Verhalten zu steuern
**Problem:** `gateway.mode` und `gateway.serverUrl` wurden in die OpenClaw-Config geschrieben um Server-Modus zu aktivieren. OpenClaw's Config-Validator lehnte die unbekannten Felder ab: `gateway.mode: Invalid input, gateway: Unrecognized key: "serverUrl"`. Der Gateway startete nicht mehr korrekt.
**Lösung:** KEINE eigenen Felder in die OpenClaw-Config schreiben. Stattdessen App-spezifische Logik aus Env-Vars ableiten (`DEFAULT_GATEWAY_URL`, `CLERK_PUBLISHABLE_KEY`). Funktionen wie `getGatewayMode()` und `getServerUrl()` prüfen zuerst Env-Vars, dann Config.
**Beispiel:**
```typescript
function getGatewayMode(): 'local' | 'server' {
  // Env-Var hat Vorrang — keine OpenClaw-Config verschmutzen
  if ((process.env.DEFAULT_GATEWAY_URL ?? '').length > 0) return 'server'
  // Fallback: Config lesen (nur für manuell gesetzten Server-Modus)
  // ...
}
```
**Merke:** OpenClaw validiert seine Config strikt. Upstream-Merge wird unmöglich wenn unbekannte Felder drin stehen.

---

### electron-vite define ersetzt nur Dot-Notation + loadEnv nötig
**Datum:** 2026-02-22
**Kontext:** Env-Vars in gepackte Electron-App einbacken via `define` in `electron.vite.config.ts`
**Problem:** Zwei Fallen: (1) `define: { 'process.env.X': ... }` ersetzt nur `process.env.X` (Dot-Notation), NICHT `process.env['X']` (Bracket-Notation). esbuild matcht auf AST-Ebene — Bracket-Access ist ein anderer Node-Typ. (2) `.env`-Datei ist bei Config-Evaluation noch nicht in `process.env` geladen — Vite lädt sie erst danach.
**Lösung:** (1) Alle Stellen im Code auf Dot-Notation umstellen. (2) `loadEnv()` aus Vite explizit in der Config aufrufen.
**Beispiel:**
```typescript
// electron.vite.config.ts
import { loadEnv } from 'vite'
const env = loadEnv('production', __dirname, '') // '' = kein Prefix-Filter

export default defineConfig({
  main: {
    define: {
      'process.env.CLERK_PUBLISHABLE_KEY': JSON.stringify(env['CLERK_PUBLISHABLE_KEY'] ?? ''),
    },
  },
})

// Im Source-Code: Dot-Notation verwenden!
const key = process.env.CLERK_PUBLISHABLE_KEY  // ✅ wird ersetzt
const key = process.env['CLERK_PUBLISHABLE_KEY'] // ❌ wird NICHT ersetzt
```

---

### Clerk in Electron braucht umfangreiche CSP + OAuth in-app
**Datum:** 2026-02-22
**Kontext:** Clerk Auth (@clerk/clerk-react) in einer Electron-App mit strenger CSP
**Problem:** Clerk blieb bei `isLoaded: false` hängen. Schrittweise entdeckte CSP-Blockaden: (1) `script-src` blockierte Clerk's externes Script von `*.clerk.accounts.dev`. (2) `worker-src` blockierte Clerk's Blob-Worker. (3) `connect-src` blockierte Telemetrie an `clerk-telemetry.com`. (4) OAuth-Flow (Google) darf NICHT via `shell.openExternal` in den Browser — der Callback kann nicht zurück zur Electron-App redirecten.
**Lösung:** Vollständige CSP für Clerk:
```typescript
const clerkCsp = hasClerkKey
  ? ' https://*.clerk.accounts.dev https://*.clerk.com'
  : ''
// script-src: ... ${clerkCsp}
// connect-src: ... ${clerkCsp} https://clerk-telemetry.com
// worker-src: 'self' blob:
// frame-src: 'self' ${clerkCsp} https://accounts.google.com
// img-src: 'self' https://img.clerk.com
```
OAuth-Navigation innerhalb der App erlauben (nicht im externen Browser):
```typescript
const CLERK_NAV_ALLOW = ['.clerk.accounts.dev', '.clerk.com', 'accounts.google.com', 'localhost']
mainWindow.webContents.on('will-navigate', (event, url) => {
  const host = new URL(url).hostname
  if (CLERK_NAV_ALLOW.some((d) => host === d || host.endsWith(d))) return
  event.preventDefault()
})
```
**Merke:** Jede neue Clerk-Feature (Social Providers, MFA) kann weitere CSP-Einträge brauchen.
