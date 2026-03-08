import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

// eslint-disable-next-line @typescript-eslint/no-require-imports
type DesktopAgentBridge = import("../../tool-router.js").DesktopAgentBridge;

// ── Shared state for HTTP server capture (bridge attached mode) ──
let pendingBridge: DesktopAgentBridge | null = null;

const plugin = {
  id: "in-app-channel",
  name: "In-App Channel",
  description: "REST API bridge for the Electron desktop app (HTTP/SSE)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    // ── /health route — also captures HTTP server ref for bridge attached mode ──
    api.registerHttpRoute({
      path: "/health",
      handler: (req, res) => {
        // Capture HTTP server reference on first request (for bridge attached mode).
        // req.socket.server exists at runtime but net.Socket typings don't expose it.
        if (pendingBridge && !pendingBridge.isAttached()) {
          const server = (req.socket as unknown as { server?: import("node:http").Server }).server;
          if (server) {
            pendingBridge.attachToServer(server);
            api.logger.info?.(
              `[in-app-channel] Bridge attached to HTTP server on ${pendingBridge.getPath() ?? "unknown"}`,
            );
            pendingBridge = null;
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      },
    });
    api.logger.info?.("[in-app-channel] /health route registered");

    // ── Full channel registration (lazy, so import failures don't block /health) ──
    let channelReady = false;
    try {
      // Pre-compiled CJS bundle (built by prepare-gateway.sh with tsdown).
      // Falls back to .ts source via jiti in dev mode.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      let channelModule: typeof import("../../channels/in-app.js");
      try {
        channelModule = require("../../channels/in-app.cjs");
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        channelModule = require("../../channels/in-app.js");
      }
      const { InAppChannelAdapter, createInAppPlugin } = channelModule;
      const adapter = new InAppChannelAdapter();
      api.registerChannel({ plugin: createInAppPlugin(adapter) });
      api.registerHttpHandler(adapter.handleRequest.bind(adapter));
      api.logger.info?.("[in-app-channel] channel + HTTP handler registered");

      // ── Wire messageHandler: connect adapter → OpenClaw agent runner ──
      wireMessageHandler(adapter, api);

      // ── Wire ConfirmationManager + DesktopAgentBridge ──
      wireToolRouter(adapter, api);

      // ── Register desktop tools as plugin tools for LLM visibility ──
      wireDesktopTools(adapter, api);
      channelReady = true;
    } catch (err) {
      const msg = err instanceof Error ? (err.stack ?? String(err)) : String(err);
      api.logger.error?.(`[in-app-channel] CRITICAL — channel registration failed: ${msg}`);
    }

    // Fallback: return 503 for /api/* when channel failed to load
    if (!channelReady) {
      api.registerHttpHandler(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname.startsWith("/api/")) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "In-App Channel nicht initialisiert. Gateway-Logs prüfen." }),
          );
          return true;
        }
        return false;
      });
    }
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
type InAppChannelAdapter = import("../../channels/in-app.js").InAppChannelAdapter;

function wireMessageHandler(adapter: InAppChannelAdapter, api: OpenClawPluginApi): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runEmbeddedPiAgent } =
      require("../../src/agents/pi-embedded-runner.js") as typeof import("../../src/agents/pi-embedded-runner.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadConfig } =
      require("../../src/config/config.js") as typeof import("../../src/config/config.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSessionTranscriptPath } =
      require("../../src/config/sessions/paths.js") as typeof import("../../src/config/sessions/paths.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveDefaultAgentId, resolveAgentWorkspaceDir } =
      require("../../src/agents/agent-scope.js") as typeof import("../../src/agents/agent-scope.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveAgentTimeoutMs } =
      require("../../src/agents/timeout.js") as typeof import("../../src/agents/timeout.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveDefaultAgentWorkspaceDir } =
      require("../../src/agents/workspace.js") as typeof import("../../src/agents/workspace.js");

    const cfg = loadConfig();
    const agentId = resolveDefaultAgentId(cfg);
    const workspaceDir =
      resolveAgentWorkspaceDir(cfg, agentId) ?? resolveDefaultAgentWorkspaceDir();

    adapter.setMessageHandler(
      async ({ sessionId, text, messageId, model, provider, fallbackModel, extraSystemPrompt }) => {
        const runId = randomUUID();
        const sessionFile = resolveSessionTranscriptPath(sessionId, agentId);
        const timeoutMs = resolveAgentTimeoutMs({ cfg });

        // Track whether tokens were already streamed (prevents garbled output on fallback)
        let hasEmittedTokens = false;

        const buildAgentParams = (runProvider: string, runModel: string) => ({
          sessionId,
          sessionKey: sessionId,
          agentId,
          sessionFile,
          workspaceDir,
          runId: randomUUID(),
          config: cfg,
          prompt: text,
          timeoutMs,
          lane: "in-app" as const,
          messageChannel: "in-app" as const,
          messageProvider: "in-app" as const,
          provider: runProvider,
          model: runModel,
          extraSystemPrompt,

          onPartialReply: (payload: { text?: string }) => {
            if (payload.text) {
              hasEmittedTokens = true;
              adapter.emitSSE(sessionId, { type: "token", data: payload.text });
            }
          },

          onAgentEvent: (evt: { stream: string; data: Record<string, unknown> }) => {
            if (evt.stream === "tool") {
              const phase = evt.data["phase"] as string | undefined;
              if (phase === "start") {
                adapter.emitSSE(sessionId, {
                  type: "tool_start",
                  data: { toolName: evt.data["name"], params: evt.data["params"] },
                });
              } else if (phase === "end") {
                adapter.emitSSE(sessionId, {
                  type: "tool_result",
                  data: { toolName: evt.data["name"], result: evt.data["result"] },
                });
              }
            }
          },
        });

        const extractFinalText = (result: unknown): string =>
          (result as { payloads?: Array<{ text?: string }> }).payloads
            ?.map((p) => p.text ?? "")
            .join("\n")
            .trim() ?? "";

        const activeProvider = provider ?? "anthropic";
        const activeModel = model ?? "claude-opus-4-6";

        try {
          // ── Primary: try configured provider (default: Gemini) ──
          const result = await runEmbeddedPiAgent(buildAgentParams(activeProvider, activeModel));
          adapter.deliverResponse(sessionId, extractFinalText(result));
        } catch (primaryError) {
          // ── Retry: once with 2s delay (only if no tokens streamed yet) ──
          if (!hasEmittedTokens) {
            await new Promise((r) => setTimeout(r, 2_000));
            try {
              hasEmittedTokens = false;
              const retryResult = await runEmbeddedPiAgent(buildAgentParams(activeProvider, activeModel));
              adapter.deliverResponse(sessionId, extractFinalText(retryResult));
              return;
            } catch {
              // Retry failed — fall through to fallback
            }
          }

          // ── Fallback: Anthropic (only if no tokens were streamed yet) ──
          if (!hasEmittedTokens && fallbackModel) {
            const slashIdx = fallbackModel.indexOf("/");
            const fbProvider = slashIdx > 0 ? fallbackModel.slice(0, slashIdx) : "anthropic";
            const fbModel = slashIdx > 0 ? fallbackModel.slice(slashIdx + 1) : fallbackModel;

            api.logger.warn?.(
              `[in-app-channel] ${activeProvider}/${activeModel} failed, falling back to ${fbProvider}/${fbModel}`,
            );
            adapter.emitSSE(sessionId, {
              type: "token",
              data: "\n\n> _Gemini nicht verfügbar — wechsle zu Anthropic..._\n\n",
            });

            hasEmittedTokens = false;
            const fallbackResult = await runEmbeddedPiAgent(buildAgentParams(fbProvider, fbModel));
            adapter.deliverResponse(sessionId, extractFinalText(fallbackResult));
          } else {
            throw primaryError;
          }
        }
      },
    );

    api.logger.info?.("[in-app-channel] messageHandler wired to pi-embedded-runner");
  } catch (err) {
    api.logger.warn?.(`[in-app-channel] messageHandler wiring failed: ${String(err)}`);
  }
}

function wireToolRouter(adapter: InAppChannelAdapter, api: OpenClawPluginApi): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConfirmationManager, DesktopAgentBridge, AGENT_WS_PORT_OFFSET, readAgentToken } =
      require("../../tool-router.js") as typeof import("../../tool-router.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadConfig } =
      require("../../src/config/config.js") as typeof import("../../src/config/config.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveGatewayPort } =
      require("../../src/config/paths.js") as typeof import("../../src/config/paths.js");

    // ── ConfirmationManager ──
    const confirmationManager = new ConfirmationManager();
    adapter.setConfirmationManager(confirmationManager);
    api.logger.info?.("[in-app-channel] ConfirmationManager wired");

    // ── DesktopAgentBridge (WS server for desktop tool execution) ──
    const cfg = loadConfig();
    const gatewayPort = resolveGatewayPort(cfg);
    const token = readAgentToken() ?? process.env["OPENCLAW_AUTH_TOKEN"] ?? "";
    const clerkSecretKey = process.env["CLERK_SECRET_KEY"] ?? "";
    const bridgePath = process.env["AGENT_BRIDGE_PATH"]; // Railway: '/agent'
    const hasToken = token !== "";
    const hasClerk = clerkSecretKey !== "";

    if (hasToken || hasClerk) {
      // Auth options: Clerk JWT OR static token (never both — constructor validates)
      const authOptions = hasClerk ? { clerkSecretKey } : { token };

      if (bridgePath) {
        // ── Attached Mode (Railway / Single-Port) ──
        const bridge = new DesktopAgentBridge({ path: bridgePath, ...authOptions });
        bridge.start(); // creates noServer WSS
        adapter.setAgentBridge(bridge);
        pendingBridge = bridge; // picked up by /health handler for server capture

        // Trigger self-request to /health after gateway starts to capture HTTP server
        api.on("gateway_start", ({ port }: { port: number }) => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const http = require("node:http") as typeof import("node:http");
          let attempts = 0;
          const maxAttempts = 3;

          function probe(): void {
            attempts++;
            const req = http.get(`http://127.0.0.1:${String(port)}/health`, (res) => {
              res.resume();
              if (res.statusCode !== 200 && attempts < maxAttempts) {
                setTimeout(probe, 100);
              }
            });
            req.on("error", () => {
              if (attempts < maxAttempts) setTimeout(probe, 100);
            });
          }
          // Short delay so routes are bound
          setTimeout(probe, 50);
        });

        api.logger.info?.(
          `[in-app-channel] DesktopAgentBridge in attached mode on path ${bridgePath} (auth: ${hasClerk ? "clerk" : "static"})`,
        );
      } else {
        // ── Standalone Mode (Lokal / Desktop) ──
        const bridge = new DesktopAgentBridge({
          port: gatewayPort + AGENT_WS_PORT_OFFSET,
          ...authOptions,
        });
        bridge.start();
        adapter.setAgentBridge(bridge);
        api.logger.info?.(
          `[in-app-channel] DesktopAgentBridge started on port ${String(gatewayPort + AGENT_WS_PORT_OFFSET)} (auth: ${hasClerk ? "clerk" : "static"})`,
        );
      }
    } else {
      api.logger.warn?.(
        "[in-app-channel] No agent token or Clerk secret — DesktopAgentBridge not started",
      );
    }
  } catch (err) {
    api.logger.warn?.(`[in-app-channel] tool-router wiring failed: ${String(err)}`);
  }
}

function wireDesktopTools(adapter: InAppChannelAdapter, api: OpenClawPluginApi): void {
  try {
    // Tools package lives at packages/tools/src/ (sibling workspace package).
    // Old path "../../tools/src/index.js" resolved to packages/gateway/tools/ (wrong).
    // Correct: go up to monorepo root then into packages/tools/src/.
    // jiti resolves .js extensions to .ts files automatically.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const toolIndex = require("../../../../packages/tools/src/index.js") as {
      getAllTools: () => ReadonlyMap<string, { name: string }>;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const toolRegister = require("../../../../packages/tools/src/register.js") as {
      getCurrentUserTools: () => readonly unknown[] | undefined;
      initTools: () => void;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { adaptToolsForPlugin } =
      require("../../tool-router.js") as typeof import("../../tool-router.js");

    // Ensure tools are initialized before reading the registry
    toolRegister.initTools();

    // Collect tool names eagerly for plugin registration metadata
    const toolNames = [...toolIndex.getAllTools().keys()];

    api.registerTool(
      () => {
        // 1. Global tools (filesystem, shell, browser, etc.)
        const globalTools = [...toolIndex.getAllTools().values()];

        // 2. Per-request user tools from AsyncLocalStorage (gmail, calendar, notes, etc.)
        const userTools = toolRegister.getCurrentUserTools() ?? [];

        // 3. Combine and adapt with bridge routing
        const bridge = adapter.getAgentBridge();
        const allTools = [...globalTools, ...userTools];
        const adapted = adaptToolsForPlugin(allTools as Parameters<typeof adaptToolsForPlugin>[0], bridge);
        // Cast: adapted tools conform to AnyAgentTool at runtime (name, label, description, parameters, execute)
        return adapted as unknown as import("../../src/agents/tools/common.js").AnyAgentTool[];
      },
      {
        names: toolNames,
      },
    );

    api.logger.info?.("[in-app-channel] Desktop tools registered as plugin tools");
  } catch (err) {
    api.logger.warn?.(`[in-app-channel] Desktop tools wiring failed: ${String(err)}`);
  }
}

export default plugin;
