/**
 * Human-readable tool descriptions in first-person German.
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
    description: 'Ich kann rechnen, Einheiten umrechnen und mathematische Ausdruecke loesen.',
  }],
  ['translator', {
    description: 'Ich kann Texte in verschiedene Sprachen uebersetzen.',
  }],
  ['datetime', {
    description: 'Ich kann Datum und Uhrzeit abfragen, Zeitzonen umrechnen und Zeitdifferenzen berechnen.',
  }],
  ['json-tools', {
    description: 'Ich kann strukturierte Daten lesen, umwandeln und formatieren.',
  }],
  ['crypto-tools', {
    description: 'Ich kann Texte verschluesseln, entschluesseln und Pruefsummen berechnen.',
  }],
  ['data-transform', {
    description: 'Ich kann Daten zwischen verschiedenen Formaten umwandeln und verarbeiten.',
  }],
  ['code-runner', {
    description: 'Ich kann kleine Programme ausfuehren und Berechnungen durchfuehren.',
  }],
  ['url-tools', {
    description: 'Ich kann Webseiten-Adressen analysieren, kuerzen und ueberpruefen.',
  }],

  // ── Server: Media & Info ──
  ['web-search', {
    description: 'Ich kann im Internet nach aktuellen Informationen suchen.',
  }],
  ['news-feed', {
    description: 'Ich kann aktuelle Nachrichten und Neuigkeiten finden.',
  }],
  ['weather', {
    description: 'Ich kann das aktuelle Wetter und Vorhersagen abrufen.',
  }],
  ['image-gen', {
    description: 'Ich kann Bilder nach deiner Beschreibung erstellen.',
  }],
  ['summarizer', {
    description: 'Ich kann lange Texte zusammenfassen und die wichtigsten Punkte herausarbeiten.',
  }],
  ['diagram', {
    description: 'Ich kann Diagramme und Visualisierungen erstellen.',
  }],
  ['archive', {
    description: 'Ich kann Dateien komprimieren und Archive entpacken.',
  }],
  ['http-client', {
    description: 'Ich kann Informationen von Webdiensten abrufen.',
  }],
  ['knowledge', {
    description: 'Ich kann in Wissensdatenbanken nachschlagen.',
  }],
  ['youtube', {
    description: 'Ich kann Videos suchen und Informationen zu Videos abrufen.',
  }],
  ['pdf-tools', {
    description: 'Ich kann Dokumente lesen, erstellen und bearbeiten.',
  }],

  // ── Server: Google Workspace ──
  ['gmail', {
    description: 'Ich kann E-Mails lesen, schreiben, beantworten und verwalten.',
    paramOverrides: {
      action: 'Was soll ich mit den E-Mails tun?',
    },
  }],
  ['calendar', {
    description: 'Ich kann Termine anzeigen, erstellen, aendern und loeschen.',
    paramOverrides: {
      action: 'Was soll ich mit dem Kalender tun?',
    },
  }],
  ['google-contacts', {
    description: 'Ich kann deine Kontakte durchsuchen und verwalten.',
  }],
  ['google-tasks', {
    description: 'Ich kann Aufgabenlisten verwalten und Aufgaben erstellen oder abhaken.',
  }],
  ['google-drive', {
    description: 'Ich kann Dateien in deiner Cloud finden, oeffnen und verwalten.',
  }],
  ['google-docs', {
    description: 'Ich kann Dokumente in deiner Cloud lesen und bearbeiten.',
  }],
  ['google-sheets', {
    description: 'Ich kann Tabellen in deiner Cloud lesen und bearbeiten.',
  }],

  // ── Server: Communication ──
  ['whatsapp', {
    description: 'Ich kann Nachrichten ueber WhatsApp senden und empfangen.',
  }],

  // ── Server: Scheduling ──
  ['scheduler', {
    description: 'Ich kann Erinnerungen planen und wiederkehrende Aufgaben einrichten.',
  }],

  // ── Desktop: Static ──
  ['browser', {
    description: 'Ich kann Webseiten oeffnen und Inhalte daraus lesen.',
  }],
  ['shell', {
    description: 'Ich kann Programme und Befehle auf deinem Computer ausfuehren.',
  }],
  ['system-info', {
    description: 'Ich kann Informationen ueber deinen Computer abrufen.',
  }],

  // ── Desktop: Factory ──
  ['clipboard', {
    description: 'Ich kann die Zwischenablage lesen und beschreiben.',
  }],
  ['screenshot', {
    description: 'Ich kann Bildschirmfotos erstellen.',
  }],
  ['git-tools', {
    description: 'Ich kann Aenderungen an Projekten verfolgen und verwalten.',
  }],
  ['app-launcher', {
    description: 'Ich kann Programme auf deinem Computer oeffnen und verwalten.',
  }],
  ['media-control', {
    description: 'Ich kann die Medienwiedergabe steuern — abspielen, pausieren, Lautstaerke aendern.',
  }],

  // ── Desktop: Config-dependent ──
  ['image-tools', {
    description: 'Ich kann Bilder bearbeiten, zuschneiden und konvertieren.',
  }],
  ['ocr', {
    description: 'Ich kann Text aus Bildern und Dokumenten erkennen.',
  }],

  // ── File-based ──
  ['filesystem', {
    description: 'Ich kann Dateien und Ordner auf deinem Computer lesen, erstellen und verwalten.',
  }],
  ['notes', {
    description: 'Ich kann Notizen erstellen, durchsuchen und verwalten.',
  }],
  ['reminders', {
    description: 'Ich kann Erinnerungen erstellen und verwalten.',
  }],

  // ── Sub-Agent Tools ──
  ['delegate', {
    description: 'Ich kann Aufgaben an spezialisierte Helfer weitergeben.',
  }],
  ['create-agent', {
    description: 'Ich kann neue spezialisierte Helfer fuer wiederkehrende Aufgaben erstellen.',
  }],

  // ── Connect Placeholder ──
  ['connect-google', {
    description: 'Ich verbinde dein Google-Konto, damit ich deine E-Mails und Termine lesen kann.',
  }],
])

// ─── Public API ──────────────────────────────────────────────

const GENERIC_PERSONA: ToolPersona = {
  description: 'Ich kann dir bei dieser Aufgabe helfen.',
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
    '## Werkzeuge',
    'Wenn du ueber deine Faehigkeiten sprichst, beschreibe sie so:',
  ]

  for (const [name, persona] of TOOL_PERSONAS) {
    if (available.has(name)) {
      lines.push(`- ${name}: ${persona.description}`)
    }
  }

  return lines.join('\n')
}
