import { useState, useCallback, useEffect, useRef } from 'react'

interface OAuthTokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

interface ToolConfirmationProps {
  readonly toolName: string
  readonly params: Record<string, unknown>
  readonly toolCallId: string
  readonly preview: ToolPreview
  readonly onConfirm: (
    toolCallId: string,
    decision: 'execute' | 'reject',
    modifiedParams?: Record<string, unknown>,
    oauthTokens?: OAuthTokens,
  ) => void
}

const TOOL_ICONS = new Map<ToolPreviewType, string>([
  ['email', '\u2709'],
  ['calendar', '\uD83D\uDCC5'],
  ['shell', '\u26A0'],
  ['filesystem', '\uD83D\uDCC1'],
  ['notes', '\uD83D\uDCDD'],
  ['oauth_connect', '\uD83D\uDD11'],
  ['generic', '\u2699'],
])

type OAuthState = 'idle' | 'connecting' | 'success' | 'error' | 'timeout'

function PreviewFields({
  fields,
  editing,
  editedFields,
  onFieldChange,
}: {
  readonly fields: Record<string, string>
  readonly editing: boolean
  readonly editedFields: Map<string, string>
  readonly onFieldChange: (key: string, value: string) => void
}): JSX.Element {
  return (
    <div className="space-y-2">
      {Object.entries(fields).map(([key, value]) => (
        <div key={key}>
          <span className="text-xs font-medium text-content-secondary">{key}</span>
          {editing ? (
            value.includes('\n') || value.length > 60 ? (
              <textarea
                value={editedFields.get(key) ?? value}
                onChange={(e) => onFieldChange(key, e.target.value)}
                placeholder={key}
                rows={3}
                className="mt-0.5 w-full resize-none rounded border border-edge-strong bg-surface px-2 py-1 text-xs text-content placeholder-content-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            ) : (
              <input
                type="text"
                value={editedFields.get(key) ?? value}
                onChange={(e) => onFieldChange(key, e.target.value)}
                placeholder={key}
                className="mt-0.5 w-full rounded border border-edge-strong bg-surface px-2 py-1 text-xs text-content placeholder-content-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            )
          ) : (
            <pre className="mt-0.5 whitespace-pre-wrap rounded bg-surface px-2 py-1 text-xs text-content-secondary">
              {value || '\u2014'}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

function OAuthConnectCard({
  toolCallId,
  preview,
  onConfirm,
}: {
  readonly toolCallId: string
  readonly preview: ToolPreview
  readonly onConfirm: ToolConfirmationProps['onConfirm']
}): JSX.Element {
  const [oauthState, setOauthState] = useState<OAuthState>('idle')
  const [oauthError, setOauthError] = useState('')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleOAuthConnect = useCallback(async () => {
    setOauthState('connecting')
    setOauthError('')

    // Client-side timeout (60s)
    timeoutRef.current = setTimeout(() => {
      setOauthState('timeout')
      setOauthError('Zeitüberschreitung')
    }, 60_000)

    try {
      const result = await window.api.startOAuth({ service: 'google' })
      if (timeoutRef.current) clearTimeout(timeoutRef.current)

      if (result.success && result.tokens) {
        setOauthState('success')
        onConfirm(toolCallId, 'execute', undefined, result.tokens)
      } else {
        setOauthState('error')
        setOauthError(result.error ?? 'Verbindung fehlgeschlagen')
      }
    } catch {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setOauthState('error')
      setOauthError('Unerwarteter Fehler')
    }
  }, [toolCallId, onConfirm])

  const handleReject = useCallback(() => {
    onConfirm(toolCallId, 'reject')
  }, [toolCallId, onConfirm])

  return (
    <div
      role="region"
      aria-label="Google-Konto verbinden"
      className="my-1 rounded-lg border border-accent/60 bg-surface-raised/50"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-accent/30 px-3 py-2">
        <span className="text-base">{'\uD83D\uDD11'}</span>
        <span className="text-sm font-medium text-accent-text">
          Gmail & Kalender verbinden
        </span>
      </div>

      {/* Preview fields */}
      <div className="px-3 py-2">
        <PreviewFields
          fields={preview.fields}
          editing={false}
          editedFields={new Map()}
          onFieldChange={() => {}}
        />
      </div>

      {/* State-dependent content */}
      <div className="px-3 py-2">
        {oauthState === 'connecting' && (
          <div className="flex items-center gap-2 text-xs text-content-secondary">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Warte auf Google-Anmeldung...
          </div>
        )}

        {oauthState === 'success' && (
          <div className="flex items-center gap-2 text-xs text-success">
            {'\u2714'} Verbunden! Du kannst mich jetzt nach Emails fragen.
          </div>
        )}

        {(oauthState === 'error' || oauthState === 'timeout') && (
          <div className="text-xs text-error">
            {oauthState === 'timeout' ? 'Zeitüberschreitung' : oauthError}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2 border-t border-edge px-3 py-2">
        {(oauthState === 'idle' || oauthState === 'error' || oauthState === 'timeout') && (
          <>
            <button
              type="button"
              onClick={() => void handleOAuthConnect()}
              className="active-press rounded-md bg-success/80 px-3 py-1 text-xs font-medium text-content transition-colors hover:bg-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised"
            >
              {oauthState === 'idle' ? 'Verbinden' : 'Nochmal versuchen'}
            </button>
            <button
              type="button"
              onClick={handleReject}
              className="active-press rounded-md bg-error/80 px-3 py-1 text-xs font-medium text-content transition-colors hover:bg-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised"
            >
              Ablehnen
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function ToolConfirmation({
  toolName,
  params,
  toolCallId,
  preview,
  onConfirm,
}: ToolConfirmationProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editedFields, setEditedFields] = useState<Map<string, string>>(new Map())

  // OAuth connect card — special rendering (hooks already called above)
  if (preview.type === 'oauth_connect') {
    return (
      <OAuthConnectCard
        toolCallId={toolCallId}
        preview={preview}
        onConfirm={onConfirm}
      />
    )
  }

  const icon = TOOL_ICONS.get(preview.type) ?? TOOL_ICONS.get('generic') ?? '\u2699'

  const handleFieldChange = useCallback((key: string, value: string) => {
    setEditedFields((prev) => new Map(prev).set(key, value))
  }, [])

  const handleExecute = useCallback(() => {
    if (editing && editedFields.size > 0) {
      const modified = { ...params, ...Object.fromEntries(editedFields) }
      onConfirm(toolCallId, 'execute', modified)
    } else {
      onConfirm(toolCallId, 'execute')
    }
  }, [editing, editedFields, params, toolCallId, onConfirm])

  const handleReject = useCallback(() => {
    onConfirm(toolCallId, 'reject')
  }, [toolCallId, onConfirm])

  const handleToggleEdit = useCallback(() => {
    setEditing((prev) => !prev)
  }, [])

  return (
    <div
      role="region"
      aria-label={`Tool-Bestätigung für ${toolName}`}
      className="my-1 rounded-lg border border-accent/60 bg-surface-raised/50"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-accent/30 px-3 py-2">
        <span className="text-base">{icon}</span>
        <span className="text-sm font-medium text-accent-text">
          {toolName}
        </span>
        <span className="ml-auto text-xs text-accent/70">
          Bestätigung erforderlich
        </span>
      </div>

      {/* Preview fields */}
      <div className="px-3 py-2">
        <PreviewFields
          fields={preview.fields}
          editing={editing}
          editedFields={editedFields}
          onFieldChange={handleFieldChange}
        />
      </div>

      {/* Warning */}
      {preview.warning !== undefined && preview.warning !== '' && (
        <div className="mx-3 mb-2 rounded bg-error/10 px-2 py-1.5 text-xs text-error">
          {preview.warning}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2 border-t border-edge px-3 py-2">
        <button
          type="button"
          onClick={handleExecute}
          className="active-press rounded-md bg-success/80 px-3 py-1 text-xs font-medium text-content transition-colors hover:bg-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised"
        >
          {editing ? 'Mit Änderungen ausführen' : 'Ausführen'}
        </button>
        <button
          type="button"
          onClick={handleToggleEdit}
          className="active-press rounded-md bg-accent/80 px-3 py-1 text-xs font-medium text-surface transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised"
        >
          {editing ? 'Abbrechen' : 'Bearbeiten'}
        </button>
        <button
          type="button"
          onClick={handleReject}
          className="active-press rounded-md bg-error/80 px-3 py-1 text-xs font-medium text-content transition-colors hover:bg-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised"
        >
          Ablehnen
        </button>
      </div>
    </div>
  )
}

export type { ToolConfirmationProps }
