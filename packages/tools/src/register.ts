/**
 * OpenClaw bridge — adapts ExtendedAgentTool to OpenClaw's tool interface.
 * Registers all tools (server + desktop) into the global registry.
 *
 * Desktop tools with Electron dependencies use the Factory/Adapter pattern:
 * clipboard and screenshot need adapters injected via initTools().
 *
 * NOT registered here (need special config):
 * - filesystem (needs allowedDirectories)
 * - reminders (needs special init)
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { AgentToolResult } from './types'
import { getAllTools, registerTool } from './index'
import type { ExtendedAgentTool } from './types'
import { calculatorTool } from './calculator'
import { translatorTool } from './translator'
import { newsFeedTool } from './news-feed'
import { imageGenTool } from './image-gen'
import { webSearchTool } from './web-search'
import { browserTool } from './browser'
import { shellTool } from './shell'
import { weatherTool } from './weather'
import { summarizerTool } from './summarizer'
import { systemInfoTool } from './system-info'
import { createClipboardTool, type ClipboardAdapter } from './clipboard'
import { createScreenshotTool, type ScreenshotAdapter } from './screenshot'
import { createGitTool, type GitAdapter } from './git-tools'
import { createAppLauncherTool, type AppLauncherAdapter } from './app-launcher'
import { createMediaControlTool, type MediaAdapter } from './media-control'
import { createImageToolsTool } from './image-tools'
import { createOcrTool } from './ocr'
import { datetimeTool } from './datetime'
import { jsonToolsTool } from './json-tools'
import { cryptoToolsTool } from './crypto-tools'
import { dataTransformTool } from './data-transform'
import { codeRunnerTool } from './code-runner'
import { urlToolsTool } from './url-tools'
import { knowledgeTool } from './knowledge'
import { diagramTool } from './diagram'
import { archiveTool } from './archive'
import { httpClientTool } from './http-client'
import { googleContactsTool } from './google-contacts'
import { googleTasksTool } from './google-tasks'
import { googleDriveTool } from './google-drive'
import { googleDocsTool } from './google-docs'
import { googleSheetsTool } from './google-sheets'
import { youtubeTool } from './youtube'
import { createSchedulerTool, type CronBridge } from './scheduler'
import { whatsappTool } from './whatsapp'

// ---------------------------------------------------------------------------
// Adapter interfaces (re-exported for consumers)
// ---------------------------------------------------------------------------

export interface ToolAdapters {
  readonly clipboard?: ClipboardAdapter
  readonly screenshot?: ScreenshotAdapter
  readonly git?: GitAdapter
  readonly appLauncher?: AppLauncherAdapter
  readonly mediaControl?: MediaAdapter
}

export interface ToolConfig {
  readonly allowedDirectories?: readonly string[]
  readonly cronBridge?: CronBridge
}

// ---------------------------------------------------------------------------
// Noop adapters (used when no desktop adapter is provided)
// ---------------------------------------------------------------------------

const noopClipboardAdapter: ClipboardAdapter = {
  readText: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  writeText: () => Promise.reject(new Error('Not available (no desktop adapter)')),
}

const noopScreenshotAdapter: ScreenshotAdapter = {
  captureScreen: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  captureWindow: () => Promise.reject(new Error('Not available (no desktop adapter)')),
}

const noopGitAdapter: GitAdapter = {
  status: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  log: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  diff: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  branch: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  commit: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  blame: () => Promise.reject(new Error('Not available (no desktop adapter)')),
}

const noopAppLauncherAdapter: AppLauncherAdapter = {
  openApp: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  openFile: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  openUrl: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  getRunning: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  focusApp: () => Promise.reject(new Error('Not available (no desktop adapter)')),
}

const noopMediaAdapter: MediaAdapter = {
  playPause: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  next: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  previous: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  setVolume: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  getVolume: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  mute: () => Promise.reject(new Error('Not available (no desktop adapter)')),
  getNowPlaying: () => Promise.reject(new Error('Not available (no desktop adapter)')),
}

// ---------------------------------------------------------------------------
// Per-request user tools (AsyncLocalStorage)
// ---------------------------------------------------------------------------

const userToolContext = new AsyncLocalStorage<readonly ExtendedAgentTool[]>()
const disabledToolsContext = new AsyncLocalStorage<ReadonlySet<string>>()

/**
 * Run a function with per-request user tools visible to createOpenClawCodingTools().
 * Tools are only visible inside the callback — fully isolated between concurrent requests.
 */
export function withUserTools<T>(
  tools: readonly ExtendedAgentTool[],
  fn: () => Promise<T>,
): Promise<T> {
  return userToolContext.run(tools, fn)
}

/**
 * Run a function with certain tools disabled (filtered out of createOpenClawCodingTools).
 * Used by the gateway to enforce capability toggles from user settings.
 */
export function withDisabledTools<T>(
  disabledNames: ReadonlySet<string>,
  fn: () => Promise<T>,
): Promise<T> {
  return disabledToolsContext.run(disabledNames, fn)
}

// ---------------------------------------------------------------------------
// OpenClaw bridge
// ---------------------------------------------------------------------------

export interface OpenClawTool {
  readonly name: string
  readonly description: string
  readonly parameters: ExtendedAgentTool['parameters']
  readonly requiresConfirmation: boolean
  readonly runsOn: 'server' | 'desktop'
  readonly riskTiers?: ExtendedAgentTool['riskTiers']
  readonly defaultRiskTier?: ExtendedAgentTool['defaultRiskTier']
  readonly execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult>
}

export function bridgeToOpenClaw(tool: ExtendedAgentTool): OpenClawTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresConfirmation: tool.requiresConfirmation,
    runsOn: tool.runsOn,
    riskTiers: tool.riskTiers,
    defaultRiskTier: tool.defaultRiskTier,
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult> => {
      return tool.execute(params)
    },
  }
}

// ---------------------------------------------------------------------------
// Tool initialization
// ---------------------------------------------------------------------------

let initialized = false

/**
 * Registers all tools into the global registry.
 * Idempotent — calling multiple times is safe.
 *
 * @param adapters - Optional Electron adapters for desktop tools.
 *                   When omitted, noop adapters are used (tools throw on execute).
 * @param config   - Optional configuration (e.g. allowedDirectories for file-based tools).
 */
export function initTools(adapters?: ToolAdapters, config?: ToolConfig): void {
  if (initialized) return
  initialized = true

  // Server tools
  registerTool(calculatorTool)
  registerTool(translatorTool)
  registerTool(newsFeedTool)
  registerTool(imageGenTool)
  registerTool(webSearchTool)
  registerTool(weatherTool)
  registerTool(summarizerTool)
  registerTool(datetimeTool)
  registerTool(jsonToolsTool)
  registerTool(cryptoToolsTool)
  registerTool(dataTransformTool)
  registerTool(codeRunnerTool)
  registerTool(urlToolsTool)
  registerTool(knowledgeTool)
  registerTool(diagramTool)
  registerTool(archiveTool)
  registerTool(httpClientTool)

  // Google Workspace tools (require OAuth via env vars)
  registerTool(googleContactsTool)
  registerTool(googleTasksTool)
  registerTool(googleDriveTool)
  registerTool(googleDocsTool)
  registerTool(googleSheetsTool)
  registerTool(youtubeTool)

  // Server tools — scheduler + WhatsApp
  registerTool(createSchedulerTool(config?.cronBridge))
  registerTool(whatsappTool)

  // Server tools with Config (only when allowedDirectories is configured)
  const allowedDirs = config?.allowedDirectories ?? []
  if (allowedDirs.length > 0) {
    registerTool(createImageToolsTool({ allowedDirectories: allowedDirs }))
    registerTool(createOcrTool({ allowedDirectories: allowedDirs }))
  }

  // Desktop tools (static — no adapter needed)
  registerTool(browserTool)
  registerTool(shellTool)
  registerTool(systemInfoTool)

  // Desktop tools (factory — adapter injected)
  registerTool(createClipboardTool(adapters?.clipboard ?? noopClipboardAdapter))
  registerTool(createScreenshotTool(adapters?.screenshot ?? noopScreenshotAdapter))

  // Desktop tools (factory — adapter + config injected)
  const dirConfig = { allowedDirectories: [...allowedDirs] }
  registerTool(createGitTool(dirConfig, adapters?.git ?? noopGitAdapter))
  registerTool(createAppLauncherTool(dirConfig, adapters?.appLauncher ?? noopAppLauncherAdapter))
  registerTool(createMediaControlTool(adapters?.mediaControl ?? noopMediaAdapter))
}

/** @deprecated Use initTools() instead. */
export function registerServerTools(): void {
  initTools()
}

/** Test-only: resets the initialized flag. Use with _resetRegistry(). */
export function _resetInitialized(): void {
  initialized = false
}

// ---------------------------------------------------------------------------
// OpenClaw coding tools
// ---------------------------------------------------------------------------

export function createOpenClawCodingTools(): OpenClawTool[] {
  const tools = getAllTools()
  if (tools.size === 0) {
    initTools()
  }

  const disabled = disabledToolsContext.getStore()

  const result: OpenClawTool[] = []
  for (const tool of getAllTools().values()) {
    if (disabled?.has(tool.name)) continue
    result.push(bridgeToOpenClaw(tool))
  }

  // Per-request user tools (only visible inside withUserTools callback)
  const userTools = userToolContext.getStore()
  if (userTools) {
    for (const tool of userTools) {
      if (disabled?.has(tool.name)) continue
      result.push(bridgeToOpenClaw(tool))
    }
  }

  return result
}
