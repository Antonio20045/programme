import { useState, useCallback } from 'react'

interface ToolConfirmationProps {
  readonly toolName: string
  readonly params: Record<string, unknown>
  readonly toolCallId: string
  readonly preview: ToolPreview
  readonly onConfirm: (
    toolCallId: string,
    decision: 'execute' | 'reject',
    modifiedParams?: Record<string, unknown>,
  ) => void
}

const TOOL_ICONS = new Map<ToolPreviewType, string>([
  ['email', '\u2709'],
  ['calendar', '\uD83D\uDCC5'],
  ['shell', '\u26A0'],
  ['filesystem', '\uD83D\uDCC1'],
  ['notes', '\uD83D\uDCDD'],
  ['generic', '\u2699'],
])

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

export default function ToolConfirmation({
  toolName,
  params,
  toolCallId,
  preview,
  onConfirm,
}: ToolConfirmationProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editedFields, setEditedFields] = useState<Map<string, string>>(new Map())

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
