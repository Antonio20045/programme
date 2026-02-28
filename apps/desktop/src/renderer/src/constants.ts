export const PROVIDERS = [
  { id: 'google', label: 'Google', sublabel: 'Gemini', model: 'google/gemini-2.5-flash-lite' },
  { id: 'anthropic', label: 'Anthropic', sublabel: 'Claude', model: 'anthropic/claude-sonnet-4-5' },
] as const

export const TONES = [
  { id: 'professional' as const, label: 'Professionell',
    example: 'Die Datei wurde erstellt und liegt unter ~/Documents/report.pdf' },
  { id: 'friendly' as const, label: 'Freundlich',
    example: 'Klar, hab ich gemacht! Die Datei findest du unter ~/Documents/report.pdf \u{1F60A}' },
  { id: 'concise' as const, label: 'Knapp',
    example: 'Datei erstellt: ~/Documents/report.pdf' },
] as const

export const PROVIDER_MODELS = new Map<string, Array<{ value: string; label: string; desc: string }>>([
  ['google', [
    { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', desc: 'Schnell und guenstig (Standard)' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Ausgewogen' },
    { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Beste Qualitaet' },
  ]],
  ['anthropic', [
    { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', desc: 'Ausgewogen' },
    { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', desc: 'Schnell und guenstig' },
    { value: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5', desc: 'Beste Qualitaet, langsamer' },
  ]],
])
