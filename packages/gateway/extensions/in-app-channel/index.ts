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

    // ── Full channel registration (async — ESM import for production bundle) ──
    // Register a temporary 503 handler while async loading completes
    let channelLoaded = false;
    api.registerHttpHandler(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!channelLoaded && url.pathname.startsWith("/api/")) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "In-App Channel wird geladen..." }),
        );
        return true;
      }
      return false;
    });

    // Async channel loading — ESM import for pre-compiled bundle, jiti require as fallback
    void (async () => {
      try {
        let channelModule: typeof import("../../channels/in-app.js");
        try {
          // Pre-compiled ESM bundle (built by prepare-gateway.sh with tsdown)
          const resolved = require.resolve("../../channels/in-app.mjs");
          const fileUrl = "file://" + resolved;
          channelModule = await import(fileUrl) as typeof channelModule;
        } catch {
          // Dev mode: fall back to .ts source via jiti
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          channelModule = require("../../channels/in-app.js");
        }
        const { InAppChannelAdapter, createInAppPlugin } = channelModule;
        const adapter = new InAppChannelAdapter();
        api.registerChannel({ plugin: createInAppPlugin(adapter) });
        api.registerHttpHandler(adapter.handleRequest.bind(adapter));
        api.logger.info?.("[in-app-channel] channel + HTTP handler registered");

        // ── Wire messageHandler: connect adapter → OpenClaw agent runner ──
        channelModule.wireMessageHandler(adapter, api);

        // ── Wire ConfirmationManager + DesktopAgentBridge ──
        const bridge = channelModule.wireToolRouter(adapter, api);
        if (bridge) {
          pendingBridge = bridge; // picked up by /health handler for server capture
        }

        // ── Register desktop tools as plugin tools for LLM visibility ──
        channelModule.wireDesktopTools(adapter, api);
        channelLoaded = true;
      } catch (err) {
        const msg = err instanceof Error ? (err.stack ?? String(err)) : String(err);
        api.logger.error?.(`[in-app-channel] CRITICAL — channel registration failed: ${msg}`);
      }
    })();
  },
};

export default plugin;
