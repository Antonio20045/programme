/** Tool name → emoji icon (used by ToolExecution). */
export const TOOL_ICONS = new Map<string, string>([
  ['web-search', '\u{1F50D}'],
  ['filesystem', '\u{1F4C1}'],
  ['shell', '\u{1F4BB}'],
  ['browser', '\u{1F310}'],
  ['gmail', '\u{2709}\uFE0F'],
  ['calendar', '\u{1F4C5}'],
  ['reminders', '\u{23F0}'],
  ['notes', '\u{1F4DD}'],
  ['calculator', '\u{1F522}'],
  ['clipboard', '\u{1F4CB}'],
  ['screenshot', '\u{1F4F7}'],
  ['image-gen', '\u{1F3A8}'],
  ['git-tools', '\u{1F500}'],
  ['code-runner', '\u{25B6}\uFE0F'],
  ['translator', '\u{1F30D}'],
  ['weather', '\u{2600}\uFE0F'],
  ['http-client', '\u{1F4E1}'],
])

/** Fallback icon for unknown tools. */
export const TOOL_ICON_FALLBACK = '\u{1F527}'

/** Preview type → emoji icon (used by ToolConfirmation). */
export const PREVIEW_TYPE_ICONS = new Map<string, string>([
  ['email', '\u2709'],
  ['calendar', '\uD83D\uDCC5'],
  ['shell', '\u26A0'],
  ['filesystem', '\uD83D\uDCC1'],
  ['notes', '\uD83D\uDCDD'],
  ['oauth_connect', '\uD83D\uDD11'],
  ['generic', '\u2699'],
])

/** Fallback icon for unknown preview types. */
export const PREVIEW_TYPE_ICON_FALLBACK = '\u2699'
