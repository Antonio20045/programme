# Desktop App (Electron)

## Architektur
- Main Process: src/main/ (Node.js) — Gateway-Manager, IPC-Handler, Tray, OAuth
- Renderer: src/renderer/ (React + Tailwind) — UI-Komponenten, Hooks, Pages
- Preload: src/preload/ — contextBridge, IPC-Typen
- Gateway läuft als Child Process (packages/gateway/ als Bundle)

## Kritische Regeln
- ALLE IPC-Kommunikation über typisierte Channels
- contextBridge.exposeInMainWorld — nie zu viel exponieren
- Renderer hat KEINEN Zugriff auf Node.js APIs
- UI-Sprache: Deutsch

## Befehle
- `pnpm --filter desktop dev` — Dev-Modus
- `pnpm --filter desktop build` — Production Build
- `pnpm --filter desktop typecheck` — TypeScript prüfen

## Debugging
- Main Process: console.log sichtbar im Terminal
- Renderer: DevTools Console (Ctrl+Shift+I)
- Preload: console.log sichtbar in DevTools Console
- Gateway Child Process: Logs über gateway-manager.ts stdout/stderr Pipes
