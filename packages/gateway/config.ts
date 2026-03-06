/**
 * Gemini-First Model Routing Configuration
 *
 * Default: Google Gemini 2.5 Flash Lite für alle Anfragen.
 * Fallback: Anthropic Claude (Tier-matched) bei Gemini-Fehlern.
 * /opus Override: Direkt Anthropic Claude Opus (kein Gemini-Versuch).
 */

// ─── Primary Model ──────────────────────────────────────────

export const GEMINI_PROVIDER = "google" as const;
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite" as const;

// ─── Anthropic Fallback (keyed by selectModel tier) ─────────

export const ANTHROPIC_FALLBACK: Readonly<Record<string, string>> = {
  "claude-haiku-4-5": "anthropic/claude-haiku-4-5",
  "claude-sonnet-4-5": "anthropic/claude-sonnet-4-5",
  "claude-opus-4-6": "anthropic/claude-opus-4-6",
};

// ─── Opus Override Detection ────────────────────────────────

export const OPUS_MODEL_ID = "claude-opus-4-6" as const;

// ─── Disabled Capabilities (30s cache) ──────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveDisabledTools } from "../shared/src/capabilities.js";

let _disabledToolsCache: ReadonlySet<string> | null = null;
let _disabledToolsCacheTs = 0;
const DISABLED_CACHE_TTL_MS = 30_000;

export function getDisabledTools(): ReadonlySet<string> {
  const now = Date.now();
  if (_disabledToolsCache && now - _disabledToolsCacheTs < DISABLED_CACHE_TTL_MS) {
    return _disabledToolsCache;
  }

  let disabledCaps: readonly string[] = [];
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const security = (raw["security"] ?? {}) as Record<string, unknown>;
    const caps = security["disabledCapabilities"];
    if (Array.isArray(caps)) {
      disabledCaps = caps.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // Config not found or parse error — no capabilities disabled
  }

  _disabledToolsCache = resolveDisabledTools(disabledCaps);
  _disabledToolsCacheTs = now;
  return _disabledToolsCache;
}

// ─── User Default Model Override (30s cache) ─────────────────

let _userModelCache: string | undefined | null = null; // null = not loaded, undefined = no override
let _userModelCacheTs = 0;
const USER_MODEL_CACHE_TTL_MS = 30_000;
const ANTHROPIC_MODEL_PREFIX = "anthropic/";

/**
 * Resolve user-configured default model.
 *
 * Resolution order (first match wins):
 * 1. process.env.DEFAULT_MODEL
 * 2. OPENCLAW_CONFIG_PATH → agents.defaults.model.primary (or string)
 * 3. ~/.openclaw/openclaw.json → same key
 *
 * Only returns anthropic/ prefixed models. Returns undefined if no valid override.
 */
export function getUserDefaultModel(): string | undefined {
  const now = Date.now();
  if (_userModelCache !== null && now - _userModelCacheTs < USER_MODEL_CACHE_TTL_MS) {
    return _userModelCache;
  }

  let resolved: string | undefined;

  // 1. ENV var (Railway / Docker)
  const envModel = process.env["DEFAULT_MODEL"];
  if (typeof envModel === "string" && envModel.startsWith(ANTHROPIC_MODEL_PREFIX)) {
    resolved = envModel;
  }

  // 2. OPENCLAW_CONFIG_PATH (custom config location)
  if (!resolved) {
    const customPath = process.env["OPENCLAW_CONFIG_PATH"];
    if (customPath) {
      resolved = readModelFromConfig(customPath);
    }
  }

  // 3. ~/.openclaw/openclaw.json (local development)
  if (!resolved) {
    resolved = readModelFromConfig(join(homedir(), ".openclaw", "openclaw.json"));
  }

  _userModelCache = resolved;
  _userModelCacheTs = now;
  return resolved;
}

function readModelFromConfig(configPath: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const agents = (raw["agents"] ?? {}) as Record<string, unknown>;
    const defaults = (agents["defaults"] ?? {}) as Record<string, unknown>;
    const model = defaults["model"];

    // String form: "anthropic/claude-sonnet-4-5"
    if (typeof model === "string" && model.startsWith(ANTHROPIC_MODEL_PREFIX)) {
      return model;
    }

    // Object form: { primary: "anthropic/claude-sonnet-4-5" }
    if (model && typeof model === "object" && !Array.isArray(model)) {
      const primary = (model as Record<string, unknown>)["primary"];
      if (typeof primary === "string" && primary.startsWith(ANTHROPIC_MODEL_PREFIX)) {
        return primary;
      }
    }
  } catch {
    // Config not found or parse error — no override
  }
  return undefined;
}
