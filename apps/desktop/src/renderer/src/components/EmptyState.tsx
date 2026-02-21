interface SuggestionProps {
  readonly text: string
  readonly onClick: (text: string) => void
}

function Suggestion({ text, onClick }: SuggestionProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onClick(text)}
      className="active-press rounded-lg border border-edge bg-surface-alt px-4 py-3 text-left text-sm text-content-secondary transition-colors hover:border-edge-strong hover:bg-surface-raised hover:text-content"
    >
      {text}
    </button>
  )
}

const SUGGESTIONS = [
  'Was steht heute in meinem Kalender?',
  'Fasse meine letzten E-Mails zusammen',
  'Erstelle eine neue Notiz',
  'Welche Dateien habe ich zuletzt bearbeitet?',
]

export default function EmptyState({
  onSuggestionClick,
}: {
  readonly onSuggestionClick: (text: string) => void
}): JSX.Element {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center px-4 py-16">
      {/* Greeting */}
      <div className="mb-2 text-4xl">
        <span className="inline-block h-12 w-12 rounded-full bg-accent/12 text-center leading-[48px] text-2xl">
          ✦
        </span>
      </div>
      <h2 className="mb-1 text-xl font-semibold text-content">
        Wie kann ich helfen?
      </h2>
      <p className="mb-8 text-sm text-content-muted">
        Stell eine Frage, gib einen Auftrag, oder starte mit einem Vorschlag.
      </p>

      {/* Suggestion cards */}
      <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((text) => (
          <Suggestion key={text} text={text} onClick={onSuggestionClick} />
        ))}
      </div>
    </div>
  )
}
