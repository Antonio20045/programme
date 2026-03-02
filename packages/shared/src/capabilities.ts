export interface CapabilityDef {
  readonly id: string
  readonly tools: readonly string[]
  readonly section: 'personal' | 'google' | 'communication' | 'internet' | 'system' | 'automation'
}

export const CAPABILITIES: readonly CapabilityDef[] = [
  // Persoenlich
  { id: 'notes',        tools: ['notes'],                                         section: 'personal' },
  { id: 'reminders',    tools: ['reminders'],                                     section: 'personal' },
  // Google
  { id: 'gmail',        tools: ['gmail', 'connect-google'],                       section: 'google' },
  { id: 'calendar',     tools: ['calendar'],                                      section: 'google' },
  { id: 'google-drive', tools: ['google-drive', 'google-docs', 'google-sheets'],  section: 'google' },
  { id: 'google-other', tools: ['google-contacts', 'google-tasks'],               section: 'google' },
  // Kommunikation
  { id: 'whatsapp',     tools: ['whatsapp'],                                      section: 'communication' },
  // Internet
  { id: 'web-search',   tools: ['web-search'],                                    section: 'internet' },
  { id: 'news-weather', tools: ['news-feed', 'weather'],                          section: 'internet' },
  { id: 'youtube',      tools: ['youtube'],                                       section: 'internet' },
  // System
  { id: 'filesystem',   tools: ['archive', 'image-tools', 'ocr'],                 section: 'system' },
  { id: 'shell',        tools: ['shell'],                                         section: 'system' },
  { id: 'browser',      tools: ['browser'],                                       section: 'system' },
  { id: 'devices',      tools: ['clipboard', 'screenshot', 'app-launcher',
                                 'media-control', 'system-info', 'git-tools'],     section: 'system' },
  { id: 'images',       tools: ['image-gen', 'diagram'],                          section: 'system' },
  // Automatisierung
  { id: 'sub-agents',   tools: ['delegate', 'create-agent'],                      section: 'automation' },
]

export function resolveDisabledTools(disabledCapabilities: readonly string[]): ReadonlySet<string> {
  const disabled = new Set<string>()
  const capMap = new Map(CAPABILITIES.map(c => [c.id, c]))
  for (const id of disabledCapabilities) {
    const cap = capMap.get(id)
    if (cap) for (const tool of cap.tools) disabled.add(tool)
  }
  return disabled
}
