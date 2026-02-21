import { useState, useCallback, useMemo, useEffect, useRef } from 'react'

interface CommandItem {
  readonly id: string
  readonly label: string
  readonly category: string
  readonly icon?: string
  readonly shortcut?: string
  readonly action: () => void
}

interface CommandPaletteProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly commands: readonly CommandItem[]
}

export default function CommandPalette({
  open,
  onClose,
  commands,
}: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (query.trim().length === 0) return commands
    const q = query.toLowerCase()
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q),
    )
  }, [commands, query])

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      // Focus input after render
      setTimeout(() => { inputRef.current?.focus() }, 0)
    }
  }, [open])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % Math.max(filtered.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(filtered.length, 1))
        return
      }
      if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault()
        const selected = filtered[selectedIndex]
        if (selected !== undefined) {
          selected.action()
          onClose()
        }
      }
    },
    [filtered, selectedIndex, onClose],
  )

  if (!open) return null

  // Group filtered commands by category
  const groups = new Map<string, CommandItem[]>()
  const groupOrder: string[] = []
  for (const cmd of filtered) {
    if (!groups.has(cmd.category)) {
      groups.set(cmd.category, [])
      groupOrder.push(cmd.category)
    }
    groups.get(cmd.category)!.push(cmd)
  }

  let flatIndex = 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg animate-fade-in overflow-hidden rounded-xl border border-edge bg-surface-alt shadow-lg"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
          <svg className="h-4 w-4 shrink-0 text-content-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Befehl suchen..."
            className="w-full bg-transparent text-sm text-content placeholder:text-content-muted focus:outline-none"
          />
          <kbd className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-content-muted">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-content-muted">
              Kein Befehl gefunden
            </div>
          )}

          {groupOrder.map((category) => {
            const items = groups.get(category)!
            return (
              <div key={category}>
                <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-content-muted">
                  {category}
                </div>
                {items.map((cmd) => {
                  const idx = flatIndex
                  flatIndex++
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      onClick={() => {
                        cmd.action()
                        onClose()
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                        idx === selectedIndex
                          ? 'bg-surface-hover text-content'
                          : 'text-content-secondary hover:bg-surface-hover/50'
                      }`}
                    >
                      {cmd.icon !== undefined && (
                        <span className="w-5 text-center text-sm" aria-hidden="true">{cmd.icon}</span>
                      )}
                      <span className="flex-1">{cmd.label}</span>
                      {cmd.shortcut !== undefined && (
                        <kbd className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-content-muted">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export type { CommandPaletteProps, CommandItem }
