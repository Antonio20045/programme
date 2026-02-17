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

const TOOL_ICONS: Record<ToolPreviewType, string> = {
  email: '\u2709',
  calendar: '\uD83D\uDCC5',
  shell: '\u26A0',
  filesystem: '\uD83D\uDCC1',
  notes: '\uD83D\uDCDD',
  generic: '\u2699',
}

function PreviewFields({
  fields,
  editing,
  editedFields,
  onFieldChange,
}: {
  readonly fields: Record<string, string>
  readonly editing: boolean
  readonly editedFields: Record<string, string>
  readonly onFieldChange: (key: string, value: string) => void
}): JSX.Element {
  return (
    <div className="space-y-2">
      {Object.entries(fields).map(([key, value]) => (
        <div key={key}>
          <span className="text-xs font-medium text-gray-400">{key}</span>
          {editing ? (
            value.includes('\n') || value.length > 60 ? (
              <textarea
                value={editedFields[key] ?? value}
                onChange={(e) => onFieldChange(key, e.target.value)}
                placeholder={key}
                rows={3}
                className="mt-0.5 w-full resize-none rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            ) : (
              <input
                type="text"
                value={editedFields[key] ?? value}
                onChange={(e) => onFieldChange(key, e.target.value)}
                placeholder={key}
                className="mt-0.5 w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            )
          ) : (
            <pre className="mt-0.5 whitespace-pre-wrap rounded bg-gray-900 px-2 py-1 text-xs text-gray-300">
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
  const [editedFields, setEditedFields] = useState<Record<string, string>>({})

  const icon = TOOL_ICONS[preview.type] ?? TOOL_ICONS.generic

  const handleFieldChange = useCallback((key: string, value: string) => {
    setEditedFields((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleExecute = useCallback(() => {
    if (editing && Object.keys(editedFields).length > 0) {
      const modified = { ...params }
      for (const [key, value] of Object.entries(editedFields)) {
        modified[key] = value
      }
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
      className="my-1 rounded-lg border border-amber-500/60 bg-gray-800/50"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-amber-500/30 px-3 py-2">
        <span className="text-base">{icon}</span>
        <span className="text-sm font-medium text-amber-300">
          {toolName}
        </span>
        <span className="ml-auto text-xs text-amber-400/70">
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
        <div className="mx-3 mb-2 rounded bg-red-950/50 px-2 py-1.5 text-xs text-red-300">
          {preview.warning}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-700 px-3 py-2">
        <button
          type="button"
          onClick={handleExecute}
          className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-green-100 transition-colors hover:bg-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-800"
        >
          {editing ? 'Mit Änderungen ausführen' : 'Ausführen'}
        </button>
        <button
          type="button"
          onClick={handleToggleEdit}
          className="rounded bg-amber-700 px-3 py-1 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-800"
        >
          {editing ? 'Abbrechen' : 'Bearbeiten'}
        </button>
        <button
          type="button"
          onClick={handleReject}
          className="rounded bg-red-800 px-3 py-1 text-xs font-medium text-red-100 transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-800"
        >
          Ablehnen
        </button>
      </div>
    </div>
  )
}

export type { ToolConfirmationProps }
