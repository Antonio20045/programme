# OpenClaw Source Code Analyse

> Vollständige Analyse des OpenClaw-Repositorys (`~/Projects/openclaw-analyse`) basierend auf 4 parallelen Agents + Context7-Dokumentation.

---

## 1. ORDNERSTRUKTUR

```
openclaw/
├── .agents/                    # Agent-Definitionen & Skills (merge-pr, review-pr etc.)
├── .github/                    # CI/CD Workflows, Issue Templates
├── .pi/                        # Pi-spezifische Extensions & Git-Hooks
│
├── src/                        # CORE — TypeScript Kern-Logik
│   ├── acp/                    #   Agent Client Protocol (WebSocket/HTTP Server)
│   │   ├── server.ts           #     Gateway-Server: loadConfig(), serveAcpGateway()
│   │   ├── translator.ts       #     Event-Translation (Agent → Client)
│   │   ├── session.ts          #     Session-Management
│   │   └── commands.ts         #     RPC-Befehle (chat.send, config.get, etc.)
│   └── agents/                 #   Agent-Runtime (337 Dateien!)
│       ├── pi-embedded-runner/ #     HAUPT-AGENT-LOOP
│       │   ├── run.ts          #       runEmbeddedPiAgent() — Zeile 162-997
│       │   └── run/attempt.ts  #       runEmbeddedAttempt() — Zeile 215-1200
│       ├── pi-tools.ts         #     Tool-Factory: createOpenClawCodingTools()
│       ├── openclaw-tools.ts   #     OpenClaw-spezifische Tools (Browser, Cron, etc.)
│       ├── tools/              #     Einzelne Tool-Implementierungen
│       │   ├── browser-tool.ts
│       │   ├── cron-tool.ts
│       │   ├── canvas-tool.ts
│       │   ├── image-tool.ts
│       │   ├── message-tool.ts
│       │   ├── tts-tool.ts
│       │   ├── gateway-tool.ts
│       │   ├── web-tools.ts
│       │   ├── sessions-*.ts
│       │   └── discord-actions*.ts
│       ├── memory-search.ts    #     Memory/Vector-Search Konfiguration
│       ├── context-window-guard.ts  # Context-Overflow-Schutz
│       ├── pi-embedded-subscribe.ts # Event-Subscription (Streaming)
│       ├── channel-tools.ts    #     Channel-Plugin Utilities
│       ├── auth-profiles/      #     Auth-Profile Rotation
│       ├── sandbox/            #     Sandboxing
│       ├── skills/             #     Skill-Loader
│       └── schema/             #     Validierungs-Schemas
│
├── extensions/                 # CHANNEL-ADAPTER (36+ Plugins)
│   ├── telegram/               #   Telegram Bot (grammy)
│   │   ├── index.ts            #     Plugin-Registrierung
│   │   └── src/
│   │       ├── channel.ts      #     ChannelPlugin-Implementation
│   │       └── runtime.ts      #     Runtime-Referenz-Holder
│   ├── whatsapp/               #   WhatsApp (Baileys)
│   ├── discord/                #   Discord (discord.js)
│   ├── slack/                  #   Slack (Bolt SDK)
│   ├── signal/                 #   Signal
│   ├── imessage/               #   iMessage
│   ├── matrix/                 #   Matrix
│   ├── msteams/                #   MS Teams
│   ├── googlechat/             #   Google Chat
│   ├── irc/                    #   IRC
│   ├── line/                   #   LINE
│   ├── nostr/                  #   Nostr
│   ├── mattermost/             #   Mattermost
│   ├── memory-core/            #   Memory-Plugin (SQLite + Embeddings)
│   ├── memory-lancedb/         #   Alternativer Memory-Backend
│   ├── voice-call/             #   Voice Calls
│   ├── twitch/                 #   Twitch
│   └── ... (36+ total)
│
├── skills/                     # 53 BUILT-IN SKILLS
│   ├── apple-notes/            #   Apple Notes Integration
│   ├── apple-reminders/        #   Apple Reminders
│   ├── github/                 #   GitHub API
│   ├── notion/                 #   Notion API
│   ├── obsidian/               #   Obsidian Vault
│   ├── spotify-player/         #   Spotify
│   ├── weather/                #   Wetter
│   ├── coding-agent/           #   Sub-Coding-Agent
│   ├── canvas/                 #   Visual Canvas
│   └── ... (53 total)
│
├── packages/                   # Monorepo Sub-Packages
│   ├── clawdbot/               #   Bot-Variante 1
│   └── moltbot/                #   Bot-Variante 2
│
├── apps/                       # Native Apps
│   ├── ios/                    #   iOS (Swift)
│   ├── macos/                  #   macOS (Swift)
│   ├── android/                #   Android (Kotlin)
│   └── shared/OpenClawKit/     #   Shared Swift Framework
│
├── Swabble/                    # Swift Package (SwabbleCore, SwabbleKit)
├── docs/                       # Dokumentation (Mintlify, 44 Unterordner)
├── scripts/                    # Build/Dev/Deploy Scripts (79 Dateien)
│
├── openclaw.mjs                # CLI Entry Point
├── package.json                # Root-Manifest (pnpm monorepo)
├── pnpm-workspace.yaml         # Workspace: ., ui, packages/*, extensions/*
├── Dockerfile                  # Production Image (node:22-bookworm)
├── docker-compose.yml          # Multi-Container Setup
├── fly.toml                    # Fly.io Deployment
└── AGENTS.md (= CLAUDE.md)    # Agent Instructions
```

**Monorepo**: pnpm 10.23.0 — Workspaces: Root, `ui/`, `packages/*`, `extensions/*`
**Runtime**: Node.js >= 22.12.0, TypeScript 5.9.3, ES Modules
**Build**: `tsdown` (TS-Compiler), `oxlint` (Linter), `oxfmt` (Formatter), Vitest (Tests)

---

## 2. MESSAGE FLOW — Schritt für Schritt

```
┌──────────────────────────────────────────────────────────────────┐
│  1. EINGANG: Externe Platform (Telegram, WhatsApp, Discord...)   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  2. CHANNEL EXTENSION                                            │
│     Datei: extensions/<channel>/src/channel.ts                   │
│     Funktion: gateway.startAccount()                             │
│     → Delegiert an Runtime: monitorTelegramProvider() etc.       │
│     → Runtime pollt/empfängt Webhook                             │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  3. MESSAGE ROUTING                                              │
│     Datei: src/agents/agent-scope.ts                             │
│     → Security-Check: Pairing? Allowlist? Gruppe erlaubt?        │
│     → Session-Key auflösen: channel + account + chat_id + thread │
│     → Queue: collect-Modus (debounce 1s, max 20 Messages)       │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  4. AGENT RUNTIME                                                │
│     Datei: src/agents/pi-embedded-runner/run.ts                  │
│     Funktion: runEmbeddedPiAgent() — Zeile 162                   │
│                                                                  │
│     a) Auth-Profil auflösen (Zeile 245-409)                      │
│     b) Model + Context-Window auflösen (Zeile 201-244)           │
│     c) Tools erstellen: createOpenClawCodingTools() (pi-tools.ts)│
│     d) System-Prompt bauen (attempt.ts Zeile 429-455)            │
│     e) Agent-Session erstellen (attempt.ts Zeile 560-571)        │
│     f) Event-Subscription starten (Zeile 729-750)                │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  5. LLM-AUFRUF                                                   │
│     Datei: src/agents/pi-embedded-runner/run/attempt.ts          │
│     Zeile: 986-989                                               │
│     Funktion: activeSession.prompt(effectivePrompt, {images})    │
│     SDK: @mariozechner/pi-ai → streamSimple()                    │
│                                                                  │
│     LLM antwortet mit:                                           │
│     → Text-Content     → Antwort fertig, weiter zu Schritt 7    │
│     → tool_use Block   → weiter zu Schritt 6                    │
└───────────┬──────────────────────────────────┬───────────────────┘
            │ tool_use                         │ text
            ▼                                  ▼
┌───────────────────────────┐   ┌──────────────────────────────────┐
│  6. TOOL EXECUTION        │   │  7. ANTWORT SENDEN               │
│  Datei: pi-embedded-      │   │  Datei: extensions/<ch>/channel.ts│
│    subscribe.handlers.    │   │  Funktion: outbound.sendText()   │
│    tools.ts               │   │  → Text chunken (4000 Zeichen)   │
│  → tool.execute(args)     │   │  → Markdown-Formatierung         │
│  → Ergebnis → tool_result │   │  → Platform-API senden           │
│  → Zurück zu Schritt 5    │   │                                  │
│    (nächster LLM-Turn)    │   │  WEB UI: SSE/WebSocket Events    │
└───────────────────────────┘   └──────────────────────────────────┘
```

**Retry-Logik** (run.ts Zeile 418-991):
- Context Overflow → Auto-Compaction → Retry
- Auth-Fehler → Nächstes Auth-Profil rotieren → Retry
- Rate Limit → Cooldown + Rotation → Retry

---

## 3. CHANNEL ADAPTER — Am Beispiel Telegram

### Interface: `ChannelPlugin<TAccount, TProbe>`

Importiert aus `openclaw/plugin-sdk` (generiert bei Build-Time aus `src/channels/plugins/types.js`).

**Datei**: `extensions/telegram/src/channel.ts` — Zeile 1-31

```typescript
import {
  type ChannelPlugin,
  type ResolvedTelegramAccount,
  type TelegramProbe,
} from "openclaw/plugin-sdk";

export const telegramPlugin: ChannelPlugin<ResolvedTelegramAccount, TelegramProbe> = {
  id: "telegram",
  meta:         { /* label, docs, blurb */ },
  capabilities: { /* chatTypes, media, reactions, threads */ },
  config:       { /* list, resolve, create, delete accounts */ },
  security:     { /* dmPolicy, pairing, allowlists */ },
  gateway:      { /* startAccount, logoutAccount */ },
  outbound:     { /* sendText, sendMedia, sendPoll */ },
  onboarding:   { /* Onboarding-Workflow */ },
  pairing:      { /* Pairing-Approval-Flow */ },
  directory:    { /* Peer/Group-Listing */ },
  actions:      { /* Message-Action-Handler */ },
  status:       { /* Runtime-Status-Tracking */ },
  threading:    { /* Reply-Mode Konfiguration */ },
  messaging:    { /* Target-Normalisierung */ },
};
```

### Registrierung

**Datei**: `extensions/telegram/index.ts`

```typescript
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { telegramPlugin } from "./src/channel.js";
import { setTelegramRuntime } from "./src/runtime.js";

const plugin = {
  id: "telegram",
  name: "Telegram",
  register(api: OpenClawPluginApi) {
    setTelegramRuntime(api.runtime);           // Runtime-Referenz speichern
    api.registerChannel({ plugin: telegramPlugin as ChannelPlugin }); // Registrieren
  },
};
export default plugin;
```

### Message-Empfang

**Datei**: `extensions/telegram/src/channel.ts` — Zeile 377-410

```typescript
gateway: {
  startAccount: async (ctx) => {
    return getTelegramRuntime().channel.telegram.monitorTelegramProvider({
      token: ctx.account.token.trim(),
      accountId: ctx.account.accountId,
      config: ctx.cfg,
      runtime: ctx.runtime,        // Core-Runtime für Message-Routing
      abortSignal: ctx.abortSignal,
      useWebhook: Boolean(ctx.account.config.webhookUrl),
      webhookUrl: ctx.account.config.webhookUrl,
    });
  },
}
```

### Runtime-Holder

**Datei**: `extensions/telegram/src/runtime.ts`

```typescript
let runtime: PluginRuntime | null = null;

export function setTelegramRuntime(next: PluginRuntime) { runtime = next; }
export function getTelegramRuntime(): PluginRuntime {
  if (!runtime) throw new Error("Telegram runtime not initialized");
  return runtime;
}
```

**Verfügbare Runtime-Methoden**:
- `runtime.channel.telegram.sendMessageTelegram()` — Nachricht senden
- `runtime.channel.telegram.probeTelegram()` — Bot-Token testen
- `runtime.channel.telegram.monitorTelegramProvider()` — Monitoring starten
- `runtime.channel.text.chunkMarkdownText()` — Text chunken
- `runtime.config.writeConfigFile()` — Config schreiben

### Konfiguration in `openclaw.json`

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "YOUR_TELEGRAM_BOT_TOKEN",
      allowFrom: ["123456789"],           // Telegram User-IDs
      groupPolicy: "allowlist",
      groupAllowFrom: ["123456789"],
      groups: { "*": { requireMention: true } },
    }
  }
}
```

---

## 4. TOOL SYSTEM

### Tool-Interface

```typescript
interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema;              // JSON Schema für Argumente
  execute: (args: unknown) => Promise<unknown>;
}
```

### Tool-Registrierung

**Datei**: `src/agents/pi-tools.ts` — Zeile 135-464

```typescript
export function createOpenClawCodingTools(options): AnyAgentTool[] {
  // 1. SDK Base-Tools (read, write, edit)
  const base = codingTools.flatMap((tool) => {
    if (tool.name === "bash") return [];    // Durch eigenes exec-Tool ersetzen
    return [tool];
  });

  // 2. Custom Exec/Process Tools
  const execTool = createExecTool({...});
  const processTool = createProcessTool({...});

  // 3. OpenClaw-spezifische Tools
  const openclawTools = createOpenClawTools({...});

  // 4. Security-Pipeline anwenden
  return applyToolPolicyPipeline({
    tools: [...base, execTool, processTool, ...openclawTools],
    policies
  });
}
```

**Datei**: `src/agents/openclaw-tools.ts` — Zeile 25-182

```typescript
export function createOpenClawTools(options): AnyAgentTool[] {
  return [
    createBrowserTool(),           // Browser-Automation (Playwright)
    createCanvasTool(),            // Visual Canvas
    createCronTool(),              // Cron-Jobs
    createMessageTool(),           // Cross-Channel Messaging
    createTtsTool(),               // Text-to-Speech
    createGatewayTool(),           // Gateway-Steuerung
    createWebSearchTool(),         // Web-Suche
    createWebFetchTool(),          // Web-Fetch
    createImageTool(),             // Bild-Generierung/-Analyse
    createSessionsSpawnTool(),     // Sub-Agent spawnen
    createSessionsSendTool(),      // An andere Sessions senden
    createSessionsListTool(),      // Sessions auflisten
    createSessionsHistoryTool(),   // Session-History
    ...pluginTools                 // Plugin-bereitgestellte Tools
  ];
}
```

### Tool-Entscheidung: LLM-driven Function Calling

1. **SDK sendet Tools als Function-Definitionen** an das LLM
2. **LLM antwortet** mit `tool_use`-Block (Name + Argumente) ODER Text
3. **SDK führt Tool aus**: `tool.execute(args)`
4. **Ergebnis wird als `tool_result`** in die Conversation-History eingefügt
5. **LLM wird erneut aufgerufen** — Loop bis Text-Antwort kommt

### Tool-Execution Events

**Datei**: `src/agents/pi-embedded-subscribe.handlers.tools.ts`

```typescript
// Zeile 58-142: Tool startet
export async function handleToolExecutionStart(ctx, evt) {
  const toolName = normalizeToolName(evt.toolName);
  ctx.state.toolMetaById.set(evt.toolCallId, buildToolCallSummary(toolName, evt.args));
  emitAgentEvent({ stream: "tool", data: { phase: "start", name: toolName } });
}

// Zeile 176-200: Tool fertig
export async function handleToolExecutionEnd(ctx, evt) {
  emitAgentEvent({ stream: "tool", data: { phase: "end", name: toolName, result } });
  if (evt.isError) ctx.state.lastToolError = { toolName, errorMessage };
}
```

### Alle Built-in Tools (22+)

| # | Tool | Datei |
|---|------|-------|
| 1 | `read` | `pi-tools.read.ts` (Workspace-eingeschränkt) |
| 2 | `write` | SDK `createWriteTool()` |
| 3 | `edit` | SDK `createEditTool()` |
| 4 | `exec` | `bash-tools.exec.js` |
| 5 | `process` | `bash-tools.process.js` |
| 6 | `browser` | `tools/browser-tool.ts` |
| 7 | `canvas` | `tools/canvas-tool.ts` |
| 8 | `image` | `tools/image-tool.ts` |
| 9 | `cron` | `tools/cron-tool.ts` |
| 10 | `message` | `tools/message-tool.ts` |
| 11 | `tts` | `tools/tts-tool.ts` |
| 12 | `gateway` | `tools/gateway-tool.ts` |
| 13 | `web_search` | `tools/web-tools.ts` |
| 14 | `web_fetch` | `tools/web-tools.ts` |
| 15 | `memory_search` | `extensions/memory-core/` |
| 16 | `memory_get` | `extensions/memory-core/` |
| 17 | `sessions_list` | `tools/sessions-list-tool.ts` |
| 18 | `sessions_history` | `tools/sessions-history-tool.ts` |
| 19 | `sessions_send` | `tools/sessions-send-tool.ts` |
| 20 | `sessions_spawn` | `tools/sessions-spawn-tool.ts` |
| 21 | `subagents` | `tools/subagents-tool.ts` |
| 22 | `discord` | `tools/discord-actions*.ts` |

---

## 5. KONFIGURATION — `openclaw.json`

**Pfad**: `~/.openclaw/openclaw.json` (JSON5)
**Schema-Validierung**: Unbekannte Keys = Gateway startet nicht

```json5
{
  // === ENVIRONMENT ===
  env: {
    OPENROUTER_API_KEY: "sk-or-...",      // Inline Env-Vars
    vars: { GROQ_API_KEY: "gsk-..." },    // Alternative Syntax
    shellEnv: { enabled: true, timeoutMs: 15000 },  // Shell-Import
  },

  // === AUTH PROFILES === (Secrets in auth-profiles.json!)
  auth: {
    profiles: {
      "anthropic:me@ex.com": { provider: "anthropic", mode: "oauth", email: "me@ex.com" },
      "openai:default":      { provider: "openai", mode: "api_key" },
    },
    order: {
      anthropic: ["anthropic:me@ex.com"],  // Failover-Reihenfolge
      openai: ["openai:default"],
    },
  },

  // === IDENTITÄT ===
  identity: {
    name: "Samantha",         // Bot-Name
    theme: "helpful sloth",   // Persönlichkeit
    emoji: "🦥",              // Avatar
  },

  // === GATEWAY ===
  gateway: {
    port: 18789,              // Default
    bind: "loopback",         // NIEMALS "lan" ohne Auth!
    auth: { token: "${OPENCLAW_GATEWAY_TOKEN}" },
    reload: { mode: "hybrid", debounceMs: 300 },
  },

  // === LOGGING ===
  logging: {
    level: "info",
    file: "/tmp/openclaw/openclaw.log",
    consoleStyle: "pretty",
    redactSensitive: "tools",   // Sensible Daten in Tool-Logs redaktieren
  },

  // === NACHRICHTEN-FORMAT ===
  messages: {
    messagePrefix: "[openclaw]",
    responsePrefix: ">",
    ackReaction: "👀",              // Emoji-Reaktion bei Empfang
    ackReactionScope: "group-mentions",
  },

  // === ROUTING + QUEUE ===
  routing: {
    groupChat: {
      mentionPatterns: ["@openclaw"],
      historyLimit: 50,
    },
    queue: {
      mode: "collect",       // Messages sammeln und zusammenfassen
      debounceMs: 1000,      // 1s warten auf weitere Messages
      cap: 20,               // Max 20 Messages pro Batch
      drop: "summarize",     // Überlauf zusammenfassen
    },
  },

  // === AGENT ===
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
      model: {
        primary: "anthropic/claude-sonnet-4-5",
        fallbacks: ["anthropic/claude-opus-4-6", "openai/gpt-5.2"],
      },
      thinkingDefault: "low",
      sandbox: { mode: "off", scope: "session" },
    },
  },

  // === SESSIONS ===
  session: {
    scope: "per-sender",
    reset: { mode: "daily", atHour: 4, idleMinutes: 60 },
    resetTriggers: ["/new", "/reset"],
    typingIntervalSeconds: 5,
  },

  // === TOOLS / MEDIA ===
  tools: {
    media: {
      audio: {
        enabled: true,
        maxBytes: 20971520,    // 20 MB
        models: [{ provider: "openai", model: "gpt-4o-mini-transcribe" }],
      },
      video: {
        enabled: true,
        maxBytes: 52428800,    // 50 MB
        models: [{ provider: "google", model: "gemini-3-flash-preview" }],
      },
    },
  },

  // === CHANNELS === (je nach Platform)
  channels: {
    whatsapp:  { dmPolicy: "pairing", allowFrom: ["+15555550123"] },
    telegram:  { botToken: "...", allowFrom: ["123456789"] },
    discord:   { token: "...", dm: { enabled: true, allowFrom: ["user"] } },
    slack:     { botToken: "xoxb-...", appToken: "xapp-..." },
    // ... 36+ Channels möglich
  },
}
```

### Env-Var Auflösung (Priorität):
1. Process Environment (höchste)
2. `./.env` (CWD)
3. `~/.openclaw/.env` (global)
4. `config.env` Block (niedrigste)

### Hot-Reload:
- **Sofort neu laden**: channels, agents, models, routing, hooks, cron, session, tools
- **Restart nötig**: gateway (port, bind, auth, TLS)

---

## 6. MEMORY SYSTEM

### Architektur: Markdown-First + Vektor-Suche

**Primäres Memory**: Dateien im Workspace
- `~/.openclaw/workspace/MEMORY.md` — Kuratiertes Langzeit-Gedächtnis
- `~/.openclaw/workspace/memory/YYYY-MM-DD.md` — Tägliche Logs (append-only)

### Vektor-Datenbank: SQLite + sqlite-vec

**Datei**: `src/agents/memory-search.ts` — Zeile 8-71

```typescript
type ResolvedMemorySearchConfig = {
  enabled: boolean,
  sources: Array<"memory" | "sessions">,  // Was wird indexiert

  store: {
    driver: "sqlite",                      // SQLite als Backend
    path: string,                          // ~/.openclaw/memory/<agentId>.sqlite
    vector: {
      enabled: boolean,
      extensionPath?: string,              // sqlite-vec Extension
    },
  },

  chunking: {
    tokens: 400,                           // 400 Tokens pro Chunk
    overlap: 80,                           // 80 Tokens Überlappung
  },

  query: {
    maxResults: 6,
    minScore: 0.35,
    hybrid: {
      enabled: true,
      vectorWeight: 0.7,                   // 70% Vektor-Suche
      textWeight: 0.3,                     // 30% BM25 Keyword-Suche
      candidateMultiplier: 4,
    },
  },
};
```

### Embedding-Provider

| Provider | Modell | Quelle |
|----------|--------|--------|
| OpenAI | `text-embedding-3-small` | Standard |
| Google | `gemini-embedding-001` | Alternative |
| Voyage AI | `voyage-4-large` | Alternative |
| Local | via `node-llama-cpp` | Offline |

### Hybrid Search: BM25 + Vector

```
finalScore = 0.7 × vectorScore + 0.3 × textScore(BM25)
```

- **SQLite FTS5** für Keyword/BM25-Suche
- **sqlite-vec** für Vektor-Similarity (Cosine)
- Fallback: JS-basierte Cosine-Similarity wenn Extension fehlt

### Memory-Tools (Plugin)

**Datei**: `extensions/memory-core/index.ts` — Zeile 11-24

```typescript
api.registerTool((ctx) => {
  const memorySearchTool = api.runtime.tools.createMemorySearchTool({
    config: ctx.config,
    agentSessionKey: ctx.sessionKey,
  });
  const memoryGetTool = api.runtime.tools.createMemoryGetTool({
    config: ctx.config,
    agentSessionKey: ctx.sessionKey,
  });
  return [memorySearchTool, memoryGetTool];
}, { names: ["memory_search", "memory_get"] });
```

### Session-Speicherung

**Layer 1: Session Store** — `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- Key/Value Map: `sessionKey → SessionEntry`
- Metadata: IDs, Timestamps, Token-Counter, Model-Overrides

**Layer 2: Transcripts** — `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`
- JSONL-Format (append-only, Baum-Struktur)
- Entry-Typen: `message`, `custom_message`, `custom`, `compaction`, `branch_summary`

### Context-Window Management

**Datei**: `src/agents/context-window-guard.ts` — Zeile 3-4

```typescript
const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;
const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;
```

**Auto-Compaction**:
1. Soft-Threshold erreicht → **Memory Flush** (stille agentic turn, schreibt MEMORY.md)
2. Hard-Threshold erreicht → **Auto-Compaction** (alte Messages zusammenfassen)
3. Context Overflow vom LLM → Compaction → Retry

**Compaction-Settings**:
```json5
{
  compaction: {
    enabled: true,
    reserveTokens: 16384,       // Headroom für Prompt + Output
    keepRecentTokens: 20000,    // Neueste Messages behalten
  }
}
```

### Datei-Layout

```
~/.openclaw/
├── openclaw.json                          # Konfiguration
├── agents/
│   └── <agentId>/
│       └── sessions/
│           ├── sessions.json              # Session-Metadata
│           └── <sessionId>.jsonl          # Transkripte
├── memory/
│   └── <agentId>.sqlite                   # Vektor-Index + FTS5
└── workspace/
    ├── MEMORY.md                          # Langzeit-Gedächtnis
    └── memory/
        └── YYYY-MM-DD.md                  # Tägliche Logs
```

---

## Zusammenfassung für unser Projekt

### Was wir für den Fork brauchen (3 additive Dateien):

1. **`packages/gateway/config.ts`** — Headless-Flag setzen
   - OpenClaw Config: `gateway.mode`, `gateway.bind`, `gateway.port`
   - Wir setzen: headless=true, bind=loopback, keine Web-UI

2. **`packages/gateway/channels/in-app.ts`** — Neuer Channel-Adapter
   - Interface: `ChannelPlugin<TAccount, TProbe>` aus `openclaw/plugin-sdk`
   - Registrierung: `api.registerChannel({ plugin: inAppPlugin })`
   - Outbound: `sendText()` → Electron IPC / React Native Bridge
   - Kein Polling nötig — Messages kommen direkt via IPC

3. **`packages/gateway/tool-router.ts`** — Tool-Lockdown
   - `tools.allowExternal = false` → Nur signierte eigene Tools
   - Tool-Interface: `{ name, description, parameters, execute }`
   - Signierung: Ed25519 via libsodium

### Architektur-Erkenntnisse:

- **Thin Extensions**: Channel-Adapter sind dünn, Core-Runtime macht die Arbeit
- **Plugin SDK**: Alles über `openclaw/plugin-sdk` — Type-Safe, Build-Time generiert
- **Function Calling**: Tools sind LLM-native (nicht String-Parsing)
- **Memory**: SQLite + sqlite-vec — leichtgewichtig, kein externer DB-Server nötig
- **Sessions**: JSONL-Dateien — einfach, append-only, keine Migration nötig
