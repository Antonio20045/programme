/**
 * Human-readable tool descriptions for the LLM system prompt.
 *
 * Maps every tool name to a persona-friendly description that hides
 * technical internals from the LLM. Unknown tools get a generic fallback.
 */

// ─── Types ───────────────────────────────────────────────────

export interface ToolPersona {
  readonly description: string
  readonly paramOverrides?: Readonly<Record<string, string>>
}

// ─── Mapping ─────────────────────────────────────────────────

const TOOL_PERSONAS: ReadonlyMap<string, ToolPersona> = new Map<string, ToolPersona>([
  // ── Server: Utility ──
  ['calculator', {
    description: 'I can calculate, convert units, and solve math expressions.',
  }],
  ['translator', {
    description: 'I can translate text into different languages.',
  }],
  ['datetime', {
    description: 'I can check date and time, convert time zones, and calculate time differences.',
  }],
  ['json-tools', {
    description: 'I can read, transform, and format structured data.',
  }],
  ['crypto-tools', {
    description: 'I can encrypt, decrypt, and compute checksums.',
  }],
  ['data-transform', {
    description: 'I can convert and process data between different formats.',
  }],
  ['code-runner', {
    description: 'I can run small programs and perform calculations.',
  }],
  ['url-tools', {
    description: 'I can analyze, shorten, and verify web addresses.',
  }],

  // ── Server: Media & Info ──
  ['web-search', {
    description: 'I can search the internet for current information and fetch web page content. Use me for knowledge questions, fact-checking, and current events. Not for emails, calendar, or desktop apps.',
  }],
  ['news-feed', {
    description: 'I can find current news and headlines.',
  }],
  ['weather', {
    description: 'I can check the current weather and forecasts.',
  }],
  ['image-gen', {
    description: 'I can create images based on your description.',
  }],
  ['summarizer', {
    description: 'I can summarize long texts and extract key points.',
  }],
  ['diagram', {
    description: 'I can create diagrams and visualizations.',
  }],
  ['archive', {
    description: 'I can compress files and extract archives.',
  }],
  ['http-client', {
    description: 'I can fetch information from web services.',
  }],
  ['knowledge', {
    description: 'I can look up information in knowledge bases.',
  }],
  ['youtube', {
    description: 'I can search for videos and retrieve video information.',
  }],
  ['pdf-tools', {
    description: 'I can read, create, and edit documents.',
  }],

  // ── Server: Google Workspace ──
  ['gmail', {
    description: 'I manage the user\'s emails: show inbox, search, compose, and reply.',
    paramOverrides: {
      action: 'What should I do with the emails?',
    },
  }],
  ['calendar', {
    description: 'I manage the user\'s calendar: show, create, modify, and delete events.',
    paramOverrides: {
      action: 'What should I do with the calendar?',
    },
  }],
  ['google-contacts', {
    description: 'I can search and manage your contacts.',
  }],
  ['google-tasks', {
    description: 'I can manage task lists and create or complete tasks.',
  }],
  ['google-drive', {
    description: 'I can find, open, and manage files in your cloud storage.',
  }],
  ['google-docs', {
    description: 'I can read and edit documents in your cloud storage.',
  }],
  ['google-sheets', {
    description: 'I can read and edit spreadsheets in your cloud storage.',
  }],

  // ── Server: Communication ──
  ['whatsapp', {
    description: 'I can send and receive messages via WhatsApp.',
  }],

  // ── Server: Scheduling ──
  ['scheduler', {
    description: 'I can schedule reminders and set up recurring tasks.',
  }],

  // ── Desktop: Static ──
  ['browser', {
    description: 'I load web pages in the background, read their content, take screenshots, and interact with forms. '
      + 'When the user needs to manually sign in to a service (cookie-based login), use openSession(domain) '
      + 'to open a visible browser window with a persistent profile. The user signs in, then all further actions '
      + 'run in that authenticated session. Use me for "open [URL]" or when web page content is needed. '
      + 'Not for desktop apps — use app-launcher for those.',
  }],
  ['shell', {
    description: 'I can run programs and commands on your computer. '
      + 'Use me for system tasks like installing software, managing processes, or running scripts.',
  }],
  ['system-info', {
    description: 'I can retrieve information about your computer.',
  }],

  // ── Desktop: Factory ──
  ['clipboard', {
    description: 'I can read and write the clipboard.',
  }],
  ['screenshot', {
    description: 'I can take screenshots.',
  }],
  ['git-tools', {
    description: 'I can track and manage changes in projects.',
  }],
  ['app-launcher', {
    description: 'I launch native desktop apps like Spotify, Finder, or Terminal and manage running programs. Use me for "open [app name]" or "start [program]". Not for websites — use browser for those.',
  }],
  ['media-control', {
    description: 'I can control media playback — play, pause, change volume.',
  }],
  ['desktop-control', {
    description: 'I can control any open app like a user — click buttons, type text, press keyboard shortcuts. '
      + 'Typical workflow: take a screenshot first, analyze what I see, then click or type. '
      + 'Use me after opening an app with app-launcher. I work with every app on the screen.',
  }],

  // ── Desktop: Config-dependent ──
  ['image-tools', {
    description: 'I can edit, crop, and convert images.',
  }],
  ['ocr', {
    description: 'I can recognize text in images and documents.',
  }],

  // ── File-based ──
  ['filesystem', {
    description: 'I can read, create, and manage files and folders on your computer.',
  }],
  ['notes', {
    description: 'I can create, search, and manage notes.',
  }],
  ['reminders', {
    description: 'I can create and manage reminders.',
  }],

  // ── Sub-Agent Tools ──
  ['delegate', {
    description: 'I can delegate tasks to specialized helpers.',
  }],
  ['create-agent', {
    description: 'I can create new specialized helpers for recurring tasks.',
  }],

  // ── Connect Placeholder ──
  ['connect-google', {
    description: 'Connects the user\'s Google account. Only call when the user EXPLICITLY says they use Gmail or Google. NEVER call on your own.',
  }],
])

// ─── Public API ──────────────────────────────────────────────

const GENERIC_PERSONA: ToolPersona = {
  description: 'I can help you with this task.',
}

/**
 * Get the persona for a tool by name.
 * Returns a generic description + console.warn for unknown tools.
 */
export function getToolPersona(name: string): ToolPersona {
  const persona = TOOL_PERSONAS.get(name)
  if (persona) return persona

  console.warn(`[persona] Unknown tool "${name}" — using generic description`)
  return GENERIC_PERSONA
}

/**
 * Build a prompt section listing human-friendly tool descriptions.
 * Only includes tools that are actually available to the user,
 * so the LLM doesn't hallucinate capabilities it doesn't have.
 */
export function buildToolDescriptionHints(availableToolNames: readonly string[]): string {
  const available = new Set(availableToolNames)
  const lines: string[] = [
    '## Tools',
    'When talking about your capabilities, describe them like this:',
  ]

  for (const [name, persona] of TOOL_PERSONAS) {
    if (available.has(name)) {
      lines.push(`- ${name}: ${persona.description}`)
    }
  }

  // ── Routing rules (only when disambiguation-relevant tools are present) ──
  const routingLines: string[] = []

  if (available.has('app-launcher') || available.has('browser')) {
    routingLines.push(
      '- "open Spotify/Finder/Terminal/[app name]" = app-launcher. "open google.com/[URL]" = browser.',
    )
  }
  if (available.has('gmail')) {
    routingLines.push(
      '- Emails, inbox, or messages = use gmail.',
    )
  }
  if (available.has('calendar')) {
    routingLines.push(
      '- Events, calendar, or "what\'s on today" = use calendar.',
    )
  }
  if (!available.has('gmail') && !available.has('calendar') && available.has('connect-google')) {
    routingLines.push(
      '- Emails, inbox, or calendar without a connected account = Ask the user which provider they use, THEN call connect-google.',
    )
  }
  if (available.has('desktop-control')) {
    routingLines.push(
      '- Interacting with a native app (click, type, fill fields) = screenshot first, then desktop-control.',
    )
  }
  if (available.has('web-search') || available.has('browser')) {
    routingLines.push(
      '- Looking up facts/information = web-search. Interacting with a web page = browser.',
    )
    if (available.has('browser')) {
      routingLines.push(
        '- User needs to sign in to a web service = browser openSession. Normal browsing = browser openPage.',
      )
    }
  }

  if (routingLines.length > 0) {
    lines.push('')
    lines.push('## Tool Selection')
    lines.push('Check FIRST if the tool is in your list BEFORE calling it.')
    lines.push(...routingLines)
  }

  return lines.join('\n')
}
