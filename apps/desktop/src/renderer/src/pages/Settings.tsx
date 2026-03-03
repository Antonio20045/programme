import { useState, useEffect, useRef, useCallback } from 'react'
import Toast from '../components/Toast'

type TabId = 'zugriffe' | 'memory'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'zugriffe', label: 'Zugriffe' },
  { id: 'memory', label: 'Memory' },
]

// ---------------------------------------------------------------------------
// Capability labels (German)
// ---------------------------------------------------------------------------

const CAPABILITY_META: Record<string, { icon: string; label: string; description: string }> = {
  'notes':        { icon: '\u{1F4DD}', label: 'Notizen',              description: 'Notizen erstellen, lesen und verwalten' },
  'reminders':    { icon: '\u23F0',    label: 'Erinnerungen',         description: 'Erinnerungen setzen und verwalten' },
  'gmail':        { icon: '\u2709\uFE0F', label: 'Gmail',             description: 'Emails lesen und senden' },
  'calendar':     { icon: '\u{1F4C5}', label: 'Kalender',             description: 'Termine ansehen und verwalten' },
  'google-drive': { icon: '\u{1F4C1}', label: 'Google Drive',         description: 'Dateien in Drive, Docs und Sheets' },
  'google-other': { icon: '\u{1F464}', label: 'Kontakte & Tasks',     description: 'Google Kontakte und Aufgaben' },
  'whatsapp':     { icon: '\u{1F4AC}', label: 'WhatsApp',             description: 'Nachrichten senden und empfangen' },
  'web-search':   { icon: '\u{1F50D}', label: 'Web-Suche',            description: 'Im Internet suchen' },
  'news-weather': { icon: '\u{1F324}\uFE0F', label: 'Nachrichten & Wetter', description: 'Aktuelle Nachrichten und Wetterdaten' },
  'youtube':      { icon: '\u25B6\uFE0F', label: 'YouTube',           description: 'YouTube-Videos suchen' },
  'filesystem':   { icon: '\u{1F5C2}\uFE0F', label: 'Dateien & Archive', description: 'Dateien lesen, schreiben, Archive, OCR' },
  'shell':        { icon: '\u26A1',    label: 'Terminal',              description: 'Befehle im Terminal ausf\u00FChren' },
  'browser':      { icon: '\u{1F310}', label: 'Browser',              description: 'Browser fernsteuern' },
  'devices':      { icon: '\u{1F5A5}\uFE0F', label: 'System & Ger\u00E4te', description: 'Zwischenablage, Screenshots, Apps, Git' },
  'images':       { icon: '\u{1F3A8}', label: 'Bilder & Diagramme',   description: 'Bilder erstellen und Diagramme zeichnen' },
  'sub-agents':   { icon: '\u{1F916}', label: 'Sub-Agents',           description: 'Aufgaben an Sub-Agents delegieren' },
}

const SECTION_LABELS: Record<string, string> = {
  personal: 'Pers\u00F6nlich',
  google: 'Google',
  communication: 'Kommunikation',
  internet: 'Internet',
  system: 'System',
  automation: 'Automatisierung',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}): JSX.Element {
  return (
    <div className="rounded-xl border border-edge bg-surface-alt p-6">
      <h3 className="mb-4 text-lg font-semibold text-content">{title}</h3>
      {children}
    </div>
  )
}

function SpinnerSmall(): JSX.Element {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function ToggleSwitch({
  checked,
  disabled,
  onToggle,
  label,
}: {
  readonly checked: boolean
  readonly disabled: boolean
  readonly onToggle: () => void
  readonly label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface-alt disabled:cursor-not-allowed disabled:opacity-50 ' +
        (checked ? 'bg-accent' : 'bg-gray-600')
      }
    >
      <span
        aria-hidden="true"
        className={
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ' +
          (checked ? 'translate-x-5' : 'translate-x-0')
        }
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Zugriffe Tab
// ---------------------------------------------------------------------------

function ZugriffeTab({
  capabilities,
  disabledIds,
  toggling,
  onToggle,
}: {
  readonly capabilities: CapabilityInfo[]
  readonly disabledIds: ReadonlySet<string>
  readonly toggling: string | null
  readonly onToggle: (id: string, enabled: boolean) => void
}): JSX.Element {
  if (capabilities.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-edge bg-gray-900">
        <p className="text-content-muted">Keine Zugriffsrechte verf\u00FCgbar.</p>
      </div>
    )
  }

  // Group by section, preserving order
  const sections: Array<{ key: string; label: string; items: CapabilityInfo[] }> = []
  const sectionMap = new Map<string, CapabilityInfo[]>()

  for (const cap of capabilities) {
    let list = sectionMap.get(cap.section)
    if (!list) {
      list = []
      sectionMap.set(cap.section, list)
      sections.push({ key: cap.section, label: SECTION_LABELS[cap.section] ?? cap.section, items: list })
    }
    list.push(cap)
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <SectionCard key={section.key} title={section.label}>
          <div className="divide-y divide-edge">
            {section.items.map((cap) => {
              const meta = CAPABILITY_META[cap.id]
              if (!meta) return null
              const enabled = !disabledIds.has(cap.id)
              const isToggling = toggling === cap.id

              return (
                <div key={cap.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl" aria-hidden="true">{meta.icon}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-content">{meta.label}</div>
                      <div className="text-xs text-content-muted">{meta.description}</div>
                    </div>
                  </div>
                  <div className="ml-4 flex items-center gap-2 shrink-0">
                    {isToggling && <SpinnerSmall />}
                    <ToggleSwitch
                      checked={enabled}
                      disabled={isToggling}
                      onToggle={() => onToggle(cap.id, !enabled)}
                      label={`${meta.label} ${enabled ? 'deaktivieren' : 'aktivieren'}`}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Memory Tab
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

function MemoryTab({
  memoryData,
  memoryLoading,
  memorySearch,
  memoryDeleteConfirm,
  ltmCollapsed,
  dailyCollapsed,
  onSearchChange,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onToggleLtm,
  onToggleDaily,
}: {
  readonly memoryData: MemoryData | null
  readonly memoryLoading: boolean
  readonly memorySearch: string
  readonly memoryDeleteConfirm: { type: string; id: string; date?: string } | null
  readonly ltmCollapsed: boolean
  readonly dailyCollapsed: boolean
  readonly onSearchChange: (v: string) => void
  readonly onDeleteRequest: (type: string, id: string, date?: string) => void
  readonly onDeleteConfirm: () => void
  readonly onDeleteCancel: () => void
  readonly onToggleLtm: () => void
  readonly onToggleDaily: () => void
}): JSX.Element {
  if (memoryLoading) {
    return (
      <div className="space-y-4">
        <div className="h-10 animate-pulse rounded-lg bg-gray-900" />
        <div className="h-32 animate-pulse rounded-xl bg-gray-900" />
      </div>
    )
  }

  if (!memoryData || (memoryData.longTerm.length === 0 && memoryData.daily.length === 0)) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-edge bg-gray-900">
        <p className="text-content-muted">Dein Assistent hat noch keine Erinnerungen gespeichert.</p>
      </div>
    )
  }

  const search = memorySearch.toLowerCase()
  const filteredLtm = memoryData.longTerm.filter(
    (e) => search === '' || e.title.toLowerCase().includes(search) || e.content.toLowerCase().includes(search),
  )
  const filteredDaily = memoryData.daily
    .map((d) => ({
      ...d,
      entries: d.entries.filter(
        (e) => search === '' || e.content.toLowerCase().includes(search),
      ),
    }))
    .filter((d) => d.entries.length > 0)

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={memorySearch}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Erinnerungen durchsuchen..."
        aria-label="Erinnerungen durchsuchen"
        className="w-full rounded-lg border border-edge bg-surface-raised px-4 py-2 text-content placeholder-content-disabled focus:outline-none focus:ring-2 focus:ring-accent"
      />

      {filteredLtm.length > 0 && (
        <div className="rounded-xl border border-edge bg-gray-900">
          <button
            type="button"
            onClick={onToggleLtm}
            aria-expanded={!ltmCollapsed}
            className="flex w-full items-center gap-2 p-4 text-left"
          >
            <span className={`text-xs text-content-muted transition-transform ${ltmCollapsed ? '' : 'rotate-90'}`}>&#9654;</span>
            <h3 className="text-sm font-semibold text-content-secondary">Langzeit-Erinnerungen ({String(filteredLtm.length)})</h3>
          </button>
          {!ltmCollapsed && (
            <div className="space-y-2 px-4 pb-4">
              {filteredLtm.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between rounded-lg border border-edge p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-content">{entry.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-content-muted">{entry.content}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteRequest('longTerm', entry.id)}
                    className="ml-2 shrink-0 text-content-muted hover:text-red-400"
                    aria-label={`Erinnerung ${entry.title} l\u00F6schen`}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {filteredDaily.length > 0 && (
        <div className="rounded-xl border border-edge bg-gray-900">
          <button
            type="button"
            onClick={onToggleDaily}
            aria-expanded={!dailyCollapsed}
            className="flex w-full items-center gap-2 p-4 text-left"
          >
            <span className={`text-xs text-content-muted transition-transform ${dailyCollapsed ? '' : 'rotate-90'}`}>&#9654;</span>
            <h3 className="text-sm font-semibold text-content-secondary">T\u00E4gliche Notizen</h3>
          </button>
          {!dailyCollapsed && (
            <div className="space-y-4 px-4 pb-4">
              {filteredDaily.map((day) => (
                <div key={day.date}>
                  <div className="mb-2 text-xs font-medium text-content-muted">{formatDate(day.date)}</div>
                  <div className="space-y-2">
                    {day.entries.map((entry) => (
                      <div key={entry.id} className="flex items-start justify-between rounded-lg border border-edge p-3">
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-sm text-content-secondary">{entry.content}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteRequest('daily', entry.id)}
                          className="ml-2 shrink-0 text-content-muted hover:text-red-400"
                          aria-label="Notiz l\u00F6schen"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {memoryDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={onDeleteCancel}
          onKeyDown={(e) => { if (e.key === 'Escape') onDeleteCancel() }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-80 rounded-xl border border-edge bg-gray-900 p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-content">Erinnerung wirklich l\u00F6schen?</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onDeleteConfirm}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
              >
                L\u00F6schen
              </button>
              <button
                type="button"
                onClick={onDeleteCancel}
                className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary hover:bg-gray-800"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings (default export)
// ---------------------------------------------------------------------------

export default function Settings(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('zugriffe')

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Zugriffe
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([])
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set())
  const [capLoading, setCapLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  // Memory
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memorySearch, setMemorySearch] = useState('')
  const [memoryDeleteConfirm, setMemoryDeleteConfirm] = useState<{ type: string; id: string; date?: string } | null>(null)
  const [ltmCollapsed, setLtmCollapsed] = useState(false)
  const [dailyCollapsed, setDailyCollapsed] = useState(false)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ message, type })
    toastTimerRef.current = setTimeout(() => setToast(null), 2000)
  }, [])

  // Load capabilities on mount
  useEffect(() => {
    void window.api.capabilitiesRead().then((result) => {
      setCapabilities(result.capabilities)
      setDisabledIds(new Set(result.disabled))
      setCapLoading(false)
    }).catch(() => {
      setCapLoading(false)
    })
  }, [])

  // Lazy load memory data
  useEffect(() => {
    if (activeTab === 'memory' && memoryData === null && !memoryLoading) {
      setMemoryLoading(true)
      void window.api.memoryRead().then((data) => {
        setMemoryData(data)
        setMemoryLoading(false)
      })
    }
  }, [activeTab, memoryData, memoryLoading])

  // Capability toggle
  const handleCapabilityToggle = useCallback(async (id: string, enabled: boolean) => {
    setToggling(id)
    try {
      const result = await window.api.capabilitiesToggle({ id, enabled })
      if (result.success) {
        setDisabledIds((prev) => {
          const next = new Set(prev)
          if (enabled) {
            next.delete(id)
          } else {
            next.add(id)
          }
          return next
        })
        const meta = CAPABILITY_META[id]
        const label = meta?.label ?? id
        showToast(`${label} ${enabled ? 'aktiviert' : 'deaktiviert'}`, 'success')
      } else {
        showToast(result.error ?? 'Fehler', 'error')
      }
    } catch {
      showToast('Toggle fehlgeschlagen', 'error')
    } finally {
      setToggling(null)
    }
  }, [showToast])

  // Memory delete
  const handleMemoryDelete = useCallback(async () => {
    if (!memoryDeleteConfirm) return
    try {
      const result = await window.api.memoryDelete({
        type: memoryDeleteConfirm.type as 'longTerm' | 'daily',
        id: memoryDeleteConfirm.id,
        date: memoryDeleteConfirm.date,
      })
      if (result.success) {
        setMemoryData(null) // triggers reload
        showToast('Erinnerung gel\u00F6scht', 'success')
      } else {
        showToast(result.error ?? 'L\u00F6schen fehlgeschlagen', 'error')
      }
    } catch {
      showToast('L\u00F6schen fehlgeschlagen', 'error')
    } finally {
      setMemoryDeleteConfirm(null)
    }
  }, [memoryDeleteConfirm, showToast])

  // Loading skeleton
  if (capLoading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-content">Einstellungen</h1>
        <div className="mt-6 space-y-4">
          <div className="h-32 animate-pulse rounded-xl bg-gray-900" />
          <div className="h-48 animate-pulse rounded-xl bg-gray-900" />
          <div className="h-24 animate-pulse rounded-xl bg-gray-900" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-content">Einstellungen</h1>

      {/* Tab bar */}
      <div className="mt-6 flex gap-1 rounded-lg bg-gray-900 p-1" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls="settings-tabpanel"
            onClick={() => setActiveTab(tab.id)}
            className={
              'rounded-md px-4 py-2 text-sm font-medium transition-colors ' +
              (activeTab === tab.id
                ? 'bg-gray-800 text-content'
                : 'text-content-muted hover:text-content')
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div id="settings-tabpanel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`} className="mt-6 space-y-4">
        {activeTab === 'zugriffe' && (
          <ZugriffeTab
            capabilities={capabilities}
            disabledIds={disabledIds}
            toggling={toggling}
            onToggle={(id, enabled) => void handleCapabilityToggle(id, enabled)}
          />
        )}
        {activeTab === 'memory' && (
          <MemoryTab
            memoryData={memoryData}
            memoryLoading={memoryLoading}
            memorySearch={memorySearch}
            memoryDeleteConfirm={memoryDeleteConfirm}
            ltmCollapsed={ltmCollapsed}
            dailyCollapsed={dailyCollapsed}
            onSearchChange={setMemorySearch}
            onDeleteRequest={(type, id, date) => setMemoryDeleteConfirm({ type, id, date })}
            onDeleteConfirm={() => void handleMemoryDelete()}
            onDeleteCancel={() => setMemoryDeleteConfirm(null)}
            onToggleLtm={() => setLtmCollapsed(!ltmCollapsed)}
            onToggleDaily={() => setDailyCollapsed(!dailyCollapsed)}
          />
        )}
      </div>

      <Toast
        message={toast?.message ?? ''}
        type={toast?.type}
        show={toast !== null}
      />
    </div>
  )
}
