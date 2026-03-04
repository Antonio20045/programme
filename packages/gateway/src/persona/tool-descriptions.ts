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
    description: 'Ich kann im Internet nach aktuellen Informationen suchen und Webseiten-Texte abrufen. Verwende mich fuer Wissensfragen, Faktenrecherche und aktuelle Ereignisse. Nicht fuer E-Mails, Termine oder Desktop-Apps.',
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
    description: 'Ich verwalte die E-Mails des Users: Posteingang anzeigen, E-Mails suchen, schreiben und beantworten. Verwende mich IMMER wenn der User nach E-Mails, Posteingang oder Nachrichten fragt — direkt aufrufen, nie halluzinieren.',
    paramOverrides: {
      action: 'Was soll ich mit den E-Mails tun?',
    },
  }],
  ['calendar', {
    description: 'Ich verwalte den Kalender des Users: Termine anzeigen, erstellen, aendern und loeschen. Verwende mich IMMER wenn der User nach Terminen, Kalender oder Tagesplan fragt — direkt aufrufen, nie halluzinieren.',
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
    description: 'Ich lade Webseiten im Hintergrund, lese deren Inhalte, mache Screenshots und interagiere mit Formularen. '
      + 'Wenn der User sich manuell bei einem Dienst einloggen muss (OAuth, Cookie-basiert), verwende openSession(domain) '
      + 'um ein sichtbares Browserfenster mit persistentem Profil zu oeffnen. Der User loggt sich ein, dann laufen alle '
      + 'weiteren Actions in dieser eingeloggten Session. Verwende mich bei "oeffne [URL]" oder wenn Webseiten-Inhalte '
      + 'gebraucht werden. Nicht fuer Desktop-Apps — dafuer gibt es app-launcher.',
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
    description: 'Ich starte native Desktop-Apps wie Spotify, Finder oder Terminal und verwalte laufende Programme. Verwende mich bei "oeffne [App-Name]" oder "starte [Programm]". Nicht fuer Webseiten — dafuer gibt es browser.',
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

  // ── Routing rules (only when disambiguation-relevant tools are present) ──
  const routingLines: string[] = []

  if (available.has('app-launcher') || available.has('browser')) {
    routingLines.push(
      '- "oeffne Spotify/Finder/Terminal/[App-Name]" = app-launcher. "oeffne google.com/[URL]" = browser.',
    )
  }
  if (available.has('gmail')) {
    routingLines.push(
      '- Jede Frage zu E-Mails, Posteingang oder Nachrichten = SOFORT gmail aufrufen.',
    )
  }
  if (available.has('calendar')) {
    routingLines.push(
      '- Jede Frage zu Terminen, Kalender oder "was steht heute an" = SOFORT calendar aufrufen.',
    )
  }
  if (available.has('web-search') || available.has('browser')) {
    routingLines.push(
      '- Fakten/Informationen suchen = web-search. Mit einer Webseite interagieren = browser.',
    )
    if (available.has('browser')) {
      routingLines.push(
        '- Wenn der User sich bei einem Webdienst einloggen muss = browser openSession. Fuer normales Surfen = browser openPage.',
      )
    }
  }

  if (routingLines.length > 0) {
    lines.push('')
    lines.push('## Werkzeugauswahl')
    lines.push('WICHTIG: Wenn ein passendes Werkzeug verfuegbar ist, RUFE ES AUF. Erklaere nie dass du keinen Zugriff hast.')
    lines.push(...routingLines)
  }

  return lines.join('\n')
}
