/**
 * LlmClient adapter — bridges the agent-executor's LlmClient interface
 * to the OpenClaw pi-ai SDK (`completeSimple()`).
 *
 * Stateless factory: create once at gateway start, reuse across requests.
 * Model discovery is lazy-initialized and cached.
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type { Api, Model, AssistantMessage } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { discoverAuthStorage, discoverModels } from "./agents/pi-model-discovery.js";
import { loadConfig } from "./config/config.js";
import { resolveDefaultAgentId } from "./agents/agent-scope.js";
import {
  resolveAgentWorkspaceDir,
  resolveDefaultAgentWorkspaceDir,
} from "./agents/workspace.js";
import type {
  LlmClient,
  LlmMessage,
  LlmToolDef,
  LlmResponse,
  LlmContentBlock,
} from "../../tools/src/agent-executor.js";

// ---------------------------------------------------------------------------
// Lazy model-discovery cache
// ---------------------------------------------------------------------------

let cachedRegistry: ModelRegistry | null = null;
let cachedAgentDir: string | null = null;

/** Test-only: reset the cached model registry. */
export function _resetRegistryCache(): void {
  cachedRegistry = null;
  cachedAgentDir = null;
}

function getModelRegistry(): ModelRegistry {
  if (cachedRegistry) return cachedRegistry;

  const cfg = loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const agentDir =
    resolveAgentWorkspaceDir(cfg, agentId) ?? resolveDefaultAgentWorkspaceDir();
  const authStorage = discoverAuthStorage(agentDir);
  cachedRegistry = discoverModels(authStorage, agentDir);
  cachedAgentDir = agentDir;
  return cachedRegistry;
}

// ---------------------------------------------------------------------------
// Message conversion: LlmMessage[] → pi-ai Message[]
// ---------------------------------------------------------------------------

interface PiAiUserMessage {
  readonly role: "user";
  readonly content: string;
  readonly timestamp: number;
}

interface PiAiAssistantContent {
  readonly type: "text";
  readonly text: string;
}

interface PiAiToolCallContent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

interface PiAiAssistantMessage {
  readonly role: "assistant";
  readonly content: ReadonlyArray<PiAiAssistantContent | PiAiToolCallContent>;
  readonly timestamp: number;
}

interface PiAiToolResultContent {
  readonly type: "tool_result";
  readonly id: string;
  readonly content: string;
}

interface PiAiToolResultMessage {
  readonly role: "user";
  readonly content: readonly PiAiToolResultContent[];
  readonly timestamp: number;
}

type PiAiMessage = PiAiUserMessage | PiAiAssistantMessage | PiAiToolResultMessage;

function convertMessages(messages: readonly LlmMessage[]): PiAiMessage[] {
  const result: PiAiMessage[] = [];
  const now = Date.now();

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content, timestamp: now });
      } else {
        // Array of content blocks — check for tool_result blocks
        const toolResults = msg.content.filter((b) => b.type === "tool_result");
        if (toolResults.length > 0) {
          result.push({
            role: "user",
            content: toolResults.map((b) => ({
              type: "tool_result" as const,
              id: "tool_use_id" in b ? (b.tool_use_id as string) : "",
              content: "content" in b ? String(b.content) : "",
            })),
            timestamp: now,
          });
        } else {
          const text = msg.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n");
          result.push({ role: "user", content: text, timestamp: now });
        }
      }
    } else {
      // assistant
      const blocks = typeof msg.content === "string" ? [{ type: "text" as const, text: msg.content }] : msg.content;
      const piContent: Array<PiAiAssistantContent | PiAiToolCallContent> = [];
      for (const block of blocks) {
        if (block.type === "text") {
          piContent.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          piContent.push({
            type: "tool_call",
            id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
        }
      }
      result.push({ role: "assistant", content: piContent, timestamp: now });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool conversion: LlmToolDef[] → pi-ai Tool[]
// ---------------------------------------------------------------------------

interface PiAiTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

function convertTools(tools: readonly LlmToolDef[]): PiAiTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Response conversion: AssistantMessage → LlmResponse
// ---------------------------------------------------------------------------

function convertStopReason(
  stopReason: AssistantMessage["stopReason"],
): LlmResponse["stop_reason"] {
  switch (stopReason) {
    case "toolUse":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

function convertResponseContent(
  content: AssistantMessage["content"],
): LlmContentBlock[] {
  const result: LlmContentBlock[] = [];

  for (const block of content) {
    if ("text" in block && block.type === "text") {
      result.push({ type: "text", text: block.text });
    } else if ("name" in block && "id" in block) {
      // ToolCall block
      const toolCall = block as { type: string; id: string; name: string; arguments: string };
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(toolCall.arguments) as Record<string, unknown>;
      } catch {
        input = {};
      }
      result.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.name,
        input,
      });
    }
  }

  return result;
}

function convertResponse(response: AssistantMessage): LlmResponse {
  return {
    stop_reason: convertStopReason(response.stopReason),
    content: convertResponseContent(response.content),
    usage: {
      input_tokens: response.usage.input,
      output_tokens: response.usage.output,
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLlmClient(): LlmClient {
  return {
    async chat(params) {
      const registry = getModelRegistry();

      // Find model in registry
      const piModel = registry.find(params.provider, params.model);
      if (!piModel) {
        throw new Error(
          `Model not found: ${params.provider}/${params.model}`,
        );
      }

      // Resolve API key
      const apiKey = await registry.getApiKey(piModel);
      if (!apiKey) {
        throw new Error(
          `No API key for model: ${params.provider}/${params.model}`,
        );
      }

      // Build pi-ai context
      const context = {
        systemPrompt: params.system,
        messages: convertMessages(params.messages) as Parameters<typeof completeSimple>[1]["messages"],
        tools: convertTools(params.tools) as Parameters<typeof completeSimple>[1]["tools"],
      };

      // Call completeSimple
      const response = await completeSimple(piModel, context, {
        apiKey,
        maxTokens: params.max_tokens,
      });

      return convertResponse(response);
    },
  };
}
