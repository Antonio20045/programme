import { useState, useEffect, useRef, useCallback } from 'react'
import { PROVIDERS, TONES, PROVIDER_MODELS } from '../constants'
import Toast from '../components/Toast'
import DevicePairing from '../components/DevicePairing'

type TabId = 'allgemein' | 'integrationen' | 'geraete' | 'memory' | 'aktivitaet'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'allgemein', label: 'Allgemein' },
  { id: 'integrationen', label: 'Integrationen' },
  { id: 'geraete', label: 'Geräte' },
  { id: 'memory', label: 'Memory' },
  { id: 'aktivitaet', label: 'Aktivität' },
]

const INTEGRATIONS: Array<{ id: OAuthService; label: string; description: string }> = [
  { id: 'gmail', label: 'Gmail', description: 'E-Mails lesen und senden' },
  { id: 'calendar', label: 'Google Calendar', description: 'Termine verwalten' },
  { id: 'drive', label: 'Google Drive', description: 'Dateien in Google Drive' },
]

// ---------------------------------------------------------------------------
// Sub-components (internal, not exported)
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

function ConnectionModeSection({
  mode,
  serverUrl,
  serverToken,
  tokenLast4,
  saving,
  testing,
  testResult,
  onModeChange,
  onServerUrlChange,
  onTokenChange,
  onTest,
  onSave,
}: {
  readonly mode: 'local' | 'server'
  readonly serverUrl: string
  readonly serverToken: string
  readonly tokenLast4: string
  readonly saving: boolean
  readonly testing: boolean
  readonly testResult: { success: boolean; error?: string } | null
  readonly onModeChange: (mode: 'local' | 'server') => void
  readonly onServerUrlChange: (url: string) => void
  readonly onTokenChange: (token: string) => void
  readonly onTest: () => void
  readonly onSave: () => void
}): JSX.Element {
  return (
    <SectionCard title="Verbindungsmodus">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onModeChange('local')}
          className={`flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
            mode === 'local'
              ? 'border-accent bg-surface-raised'
              : 'border-edge bg-surface-alt hover:border-edge-strong'
          }`}
        >
          <div className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
            mode === 'local' ? 'border-accent bg-accent' : 'border-content-muted'
          }`}>
            {mode === 'local' && <div className="h-2 w-2 rounded-full bg-white" />}
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-content">Lokal</div>
            <div className="mt-0.5 text-xs text-content-muted">Gateway l&auml;uft auf diesem Computer</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onModeChange('server')}
          className={`flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
            mode === 'server'
              ? 'border-accent bg-surface-raised'
              : 'border-edge bg-surface-alt hover:border-edge-strong'
          }`}
        >
          <div className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
            mode === 'server' ? 'border-accent bg-accent' : 'border-content-muted'
          }`}>
            {mode === 'server' && <div className="h-2 w-2 rounded-full bg-white" />}
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-content">Server</div>
            <div className="mt-0.5 text-xs text-content-muted">Gateway l&auml;uft auf einem entfernten Server</div>
          </div>
        </button>

        {mode === 'server' && (
          <div className="mt-4 space-y-3 rounded-lg border border-edge bg-gray-800/50 p-4">
            <div>
              <label htmlFor="settings-server-url" className="mb-1 block text-sm text-content-secondary">Server-URL</label>
              <input
                id="settings-server-url"
                type="url"
                value={serverUrl}
                onChange={(e) => onServerUrlChange(e.target.value)}
                placeholder="https://gateway.example.com"
                className="w-full rounded-lg border border-edge bg-surface-raised px-4 py-2 text-content placeholder-content-disabled focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label htmlFor="settings-server-token" className="mb-1 block text-sm text-content-secondary">Agent-Token</label>
              <input
                id="settings-server-token"
                type="password"
                value={serverToken}
                onChange={(e) => onTokenChange(e.target.value)}
                placeholder={tokenLast4 !== '' ? `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${tokenLast4}` : 'Token eingeben'}
                className="w-full rounded-lg border border-edge bg-surface-raised px-4 py-2 text-content placeholder-content-disabled focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {testResult !== null && (
              <p className={`text-sm ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {testResult.success ? 'Verbindung erfolgreich' : (testResult.error ?? 'Verbindung fehlgeschlagen')}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onTest}
                disabled={testing || serverUrl === '' || serverToken === ''}
                className="flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testing && <SpinnerSmall />}
                Verbindung testen
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving || serverUrl === '' || serverToken === ''}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <SpinnerSmall />}
                Speichern
              </button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function ModelSection({
  currentModel,
  provider,
  saving,
  onModelChange,
}: {
  readonly currentModel: string
  readonly provider: string
  readonly saving: boolean
  readonly onModelChange: (model: string) => void
}): JSX.Element {
  const models = PROVIDER_MODELS.get(provider) ?? []
  const currentDesc = models.find((m) => m.value === currentModel)?.desc ?? ''

  return (
    <SectionCard title="KI-Modell">
      <div className="relative">
        <select
          value={currentModel}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={saving}
          className="w-full appearance-none rounded-lg border border-edge bg-gray-800 px-4 py-3 pr-10 text-content focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {PROVIDERS.filter((p) => p.id === provider).map((p) => (
            <optgroup key={p.id} label={p.label}>
              {(PROVIDER_MODELS.get(p.id) ?? []).map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </optgroup>
          ))}
          {PROVIDERS.filter((p) => p.id !== provider).map((p) => (
            <optgroup key={p.id} label={p.label}>
              {(PROVIDER_MODELS.get(p.id) ?? []).map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {saving && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <SpinnerSmall />
          </div>
        )}
      </div>
      {currentDesc !== '' && (
        <p className="mt-2 text-sm text-content-muted">{currentDesc}</p>
      )}
    </SectionCard>
  )
}

function PersonaSection({
  name,
  tone,
  dirty,
  saving,
  onNameChange,
  onToneChange,
  onSave,
}: {
  readonly name: string
  readonly tone: ToneOption
  readonly dirty: boolean
  readonly saving: boolean
  readonly onNameChange: (name: string) => void
  readonly onToneChange: (tone: ToneOption) => void
  readonly onSave: () => void
}): JSX.Element {
  return (
    <SectionCard title="Persona">
      <label htmlFor="settings-persona-name" className="mb-2 block text-sm font-medium text-content-secondary">
        Name
      </label>
      <input
        id="settings-persona-name"
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        maxLength={20}
        className="mb-4 w-full rounded-lg border border-edge bg-surface-raised px-4 py-2 text-content placeholder-content-disabled focus:outline-none focus:ring-2 focus:ring-accent"
      />

      <div className="space-y-2">
        {TONES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onToneChange(t.id)}
            className={
              'flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ' +
              (tone === t.id
                ? 'border-accent bg-surface-raised'
                : 'border-edge bg-surface-alt hover:border-edge-strong')
            }
          >
            <div className="flex-1">
              <div className="text-sm font-semibold text-content">{t.label}</div>
              <div className="mt-0.5 text-xs italic text-content-muted">{t.example}</div>
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="mt-4 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving && <SpinnerSmall />}
        Speichern
      </button>
    </SectionCard>
  )
}

function FolderSection({
  paths,
  homePath,
  adding,
  onAdd,
  onRemove,
}: {
  readonly paths: string[]
  readonly homePath: string
  readonly adding: boolean
  readonly onAdd: () => void
  readonly onRemove: (path: string) => void
}): JSX.Element {
  return (
    <SectionCard title="Erlaubte Ordner">
      <ul className="space-y-2">
        {paths.map((p) => (
          <li key={p} className="flex items-center justify-between rounded-lg border border-edge px-4 py-2">
            <span className="truncate text-sm text-content-secondary">
              {p}
              {p === homePath && (
                <span className="ml-2 text-xs text-content-muted">(Standard)</span>
              )}
            </span>
            {p !== homePath && (
              <button
                type="button"
                onClick={() => onRemove(p)}
                className="ml-2 shrink-0 text-content-muted hover:text-red-400"
                aria-label={`Ordner ${p} entfernen`}
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        disabled={adding}
        className="mt-3 flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-raised disabled:opacity-50"
      >
        {adding && <SpinnerSmall />}
        Ordner hinzuf\u00FCgen
      </button>
    </SectionCard>
  )
}

function IntegrationCard({
  label,
  description,
  connected,
  connecting,
  confirmDisconnect,
  onConnect,
  onDisconnect,
  onConfirmDisconnect,
  onCancelConfirm,
}: {
  readonly label: string
  readonly description: string
  readonly connected: boolean
  readonly connecting: boolean
  readonly confirmDisconnect: boolean
  readonly onConnect: () => void
  readonly onDisconnect: () => void
  readonly onConfirmDisconnect: () => void
  readonly onCancelConfirm: () => void
}): JSX.Element {
  return (
    <div className="rounded-xl border border-edge bg-surface-alt p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-content">{label}</h3>
          <p className="mt-1 text-sm text-content-muted">{description}</p>
        </div>
        <span
          className={
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ' +
            (connected
              ? 'bg-emerald-900 text-emerald-300'
              : 'bg-gray-800 text-content-muted')
          }
        >
          {connected ? 'Verbunden' : 'Nicht verbunden'}
        </span>
      </div>

      <div className="mt-4">
        {!connected && (
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {connecting && <SpinnerSmall />}
            {connecting ? 'Verbinde...' : 'Verbinden'}
          </button>
        )}

        {connected && !confirmDisconnect && (
          <button
            type="button"
            onClick={onDisconnect}
            className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-raised"
          >
            Trennen
          </button>
        )}

        {connected && confirmDisconnect && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmDisconnect}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
            >
              Wirklich trennen
            </button>
            <button
              type="button"
              onClick={onCancelConfirm}
              className="rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary hover:bg-gray-800"
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTIVITY_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'email', label: 'E-Mail' },
  { value: 'kalender', label: 'Kalender' },
  { value: 'dateien', label: 'Dateien' },
  { value: 'shell', label: 'Shell' },
  { value: 'web', label: 'Web-Suche' },
  { value: 'notizen', label: 'Notizen' },
]

function relativeTime(iso: string): string {
  const now = Date.now()
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'gerade eben'
  if (diffMin < 60) return `vor ${String(diffMin)} Min.`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `vor ${String(diffH)} Std.`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'gestern'
  if (diffD < 7) return `vor ${String(diffD)} Tagen`
  return new Date(then).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })
}

function categoryIcon(category: string): JSX.Element {
  switch (category) {
    case 'email':
      return (
        <svg className="h-4 w-4 text-content-muted" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M1.5 3A1.5 1.5 0 003 4.5v7A1.5 1.5 0 001.5 13h13A1.5 1.5 0 0016 11.5v-7A1.5 1.5 0 0014.5 3h-13zM3.07 4h9.86L8 7.88 3.07 4zM2 5.12l5.65 4.42a.5.5 0 00.7 0L14 5.12V12H2V5.12z" />
        </svg>
      )
    case 'kalender':
      return (
        <svg className="h-4 w-4 text-content-muted" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M4 0a1 1 0 011 1v1h6V1a1 1 0 112 0v1h1.5A1.5 1.5 0 0116 3.5v11a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 010 14.5v-11A1.5 1.5 0 011.5 2H3V1a1 1 0 011-1zM1.5 6v8.5h13V6h-13z" />
        </svg>
      )
    case 'dateien':
      return (
        <svg className="h-4 w-4 text-content-muted" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M1 3.5A1.5 1.5 0 012.5 2h4.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 0110.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
        </svg>
      )
    case 'shell':
      return (
        <svg className="h-4 w-4 text-content-muted" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M0 2.75A1.75 1.75 0 011.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm6.22 3.97a.75.75 0 000 1.06l1.47 1.47-1.47 1.47a.75.75 0 101.06 1.06l2-2a.75.75 0 000-1.06l-2-2a.75.75 0 00-1.06 0zM8 11.5a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5A.75.75 0 018 11.5z" />
        </svg>
      )
    case 'web':
      return (
        <svg className="h-4 w-4 text-content-muted" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm-.5 1.56v2.69H5.03a11.27 11.27 0 012.47-2.7zM5.6 5.75h1.9v2.5H4.74a9.7 9.7 0 01.86-2.5zm0 4.5H7.5v2.5H5.6a9.7 9.7 0 01-.86-2.5zm2.9 4.19V11.75h2.47a11.27 11.27 0 01-2.47 2.7zm2.9-4.19H8.5v-2.5h2.76a9.7 9.7 0 01.86 2.5z" />
        </svg>
      )
    case 'notizen':
      return (
        <svg className="h-4 w-4 text-content-muted" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-9.5A1.75 1.75 0 012 14.25V1.75zm3.75 4a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5zm0 3a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" />
        </svg>
      )
    default:
      return (
        <svg className="h-4 w-4 text-content-muted" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M6.457 1.047l-1.9 8.5a.5.5 0 00.977.218l1.9-8.5a.5.5 0 00-.977-.218zM4.354 4.646a.5.5 0 010 .708L1.707 8l2.647 2.646a.5.5 0 01-.708.708l-3-3a.5.5 0 010-.708l3-3a.5.5 0 01.708 0zm7.292 0a.5.5 0 00-.708.708L13.586 8l-2.647 2.646a.5.5 0 00.708.708l3-3a.5.5 0 000-.708l-3-3z" />
        </svg>
      )
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Memory Tab
// ---------------------------------------------------------------------------

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
                          aria-label={`Notiz l\u00F6schen`}
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
// Activity Tab
// ---------------------------------------------------------------------------

function ActivityTab({
  activityData,
  activityLoading,
  activityFilter,
  activityExpandedId,
  onFilterChange,
  onToggleExpand,
  onLoadMore,
}: {
  readonly activityData: ActivityData | null
  readonly activityLoading: boolean
  readonly activityFilter: string
  readonly activityExpandedId: string | null
  readonly onFilterChange: (v: string) => void
  readonly onToggleExpand: (id: string) => void
  readonly onLoadMore: () => void
}): JSX.Element {
  if (activityLoading && !activityData) {
    return (
      <div className="space-y-4">
        <div className="h-10 animate-pulse rounded-lg bg-gray-900" />
        <div className="h-20 animate-pulse rounded-xl bg-gray-900" />
        <div className="h-20 animate-pulse rounded-xl bg-gray-900" />
      </div>
    )
  }

  const entries = activityData?.entries ?? []
  const filtered = activityFilter === 'all'
    ? entries
    : entries.filter((e) => e.category === activityFilter)

  return (
    <div className="space-y-4">
      <select
        value={activityFilter}
        onChange={(e) => onFilterChange(e.target.value)}
        aria-label="Aktivit\u00E4ten filtern"
        className="w-full appearance-none rounded-lg border border-edge bg-gray-800 px-4 py-2 text-content focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {ACTIVITY_FILTERS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {filtered.length === 0 && (
        <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-edge bg-gray-900">
          <p className="text-content-muted">Noch keine Tool-Aktivit\u00E4ten aufgezeichnet.</p>
        </div>
      )}

      {filtered.map((entry) => {
        const isExpanded = activityExpandedId === entry.id
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onToggleExpand(entry.id)}
            aria-expanded={isExpanded}
            className="w-full rounded-lg border border-edge bg-gray-900 p-4 text-left transition-colors hover:border-edge"
          >
            <div className="flex items-center gap-3">
              {categoryIcon(entry.category)}
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-content">{entry.toolName}</span>
                {entry.description !== '' && (
                  <span className="ml-2 truncate text-sm text-content-muted">{entry.description}</span>
                )}
              </div>
              <span className="shrink-0 text-xs text-content-muted">{relativeTime(entry.timestamp)}</span>
            </div>
            {isExpanded && (
              <div className="mt-3 space-y-2 border-t border-edge pt-3">
                {Object.keys(entry.params).length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-content-muted">Parameter</div>
                    <pre className="max-h-32 overflow-auto rounded bg-gray-800 p-2 text-xs text-content-secondary">
                      {JSON.stringify(entry.params, null, 2)}
                    </pre>
                  </div>
                )}
                {entry.result !== undefined && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-content-muted">Ergebnis</div>
                    <pre className="max-h-32 overflow-auto rounded bg-gray-800 p-2 text-xs text-content-secondary">
                      {typeof entry.result === 'string'
                        ? (entry.result.length > 500 ? entry.result.slice(0, 500) + '...' : entry.result)
                        : JSON.stringify(entry.result, null, 2)?.slice(0, 500)}
                    </pre>
                  </div>
                )}
                {entry.durationMs !== undefined && (
                  <div className="text-xs text-content-muted">
                    Dauer: {entry.durationMs < 1000 ? `${String(entry.durationMs)} ms` : `${(entry.durationMs / 1000).toFixed(1)} s`}
                  </div>
                )}
              </div>
            )}
          </button>
        )
      })}

      {activityData?.hasMore === true && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={activityLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-raised disabled:opacity-50"
        >
          {activityLoading && <SpinnerSmall />}
          \u00C4ltere laden
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings (default export)
// ---------------------------------------------------------------------------

export default function Settings(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<SettingsConfig | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('allgemein')

  // Model
  const [pendingModel, setPendingModel] = useState('')
  const [modelSaving, setModelSaving] = useState(false)

  // Persona
  const [personaName, setPersonaName] = useState('')
  const [personaTone, setPersonaTone] = useState<ToneOption>('friendly')
  const [personaDirty, setPersonaDirty] = useState(false)
  const [personaSaving, setPersonaSaving] = useState(false)

  // Folders
  const [folderAdding, setFolderAdding] = useState(false)

  // Connection mode
  const [connectionMode, setConnectionMode] = useState<'local' | 'server'>('local')
  const [serverUrl, setServerUrl] = useState('')
  const [serverToken, setServerToken] = useState('')
  const [connectionSaving, setConnectionSaving] = useState(false)
  const [connectionTesting, setConnectionTesting] = useState(false)
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [tokenLast4, setTokenLast4] = useState('')

  // Integrations
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>({ gmail: false, calendar: false, drive: false })
  const [connectingService, setConnectingService] = useState<string | null>(null)
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null)

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Memory
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memorySearch, setMemorySearch] = useState('')
  const [memoryDeleteConfirm, setMemoryDeleteConfirm] = useState<{ type: string; id: string; date?: string } | null>(null)
  const [ltmCollapsed, setLtmCollapsed] = useState(false)
  const [dailyCollapsed, setDailyCollapsed] = useState(false)

  // Activity
  const [activityData, setActivityData] = useState<ActivityData | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityFilter, setActivityFilter] = useState('all')
  const [activityExpandedId, setActivityExpandedId] = useState<string | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ message, type })
    toastTimerRef.current = setTimeout(() => setToast(null), 2000)
  }, [])

  // Load config on mount
  useEffect(() => {
    void window.api.settingsReadConfig().then((cfg) => {
      setConfig(cfg)
      setPendingModel(cfg.model)
      setPersonaName(cfg.identity.name)
      setPersonaTone(cfg.identity.theme)
      setLoading(false)
    })
  }, [])

  // Load gateway config
  useEffect(() => {
    void window.api.getGatewayConfig().then((cfg) => {
      const mode = cfg.mode === 'server' ? ('server' as const) : ('local' as const)
      setConnectionMode(mode)
      if (mode === 'server') {
        setServerUrl(cfg.serverUrl)
      }
      setTokenLast4(cfg.token)
    })
  }, [])

  // Load integration status
  useEffect(() => {
    void window.api.integrationsStatus().then(setIntegrationStatus)
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

  // Lazy load activity data
  useEffect(() => {
    if (activeTab === 'aktivitaet' && activityData === null && !activityLoading) {
      setActivityLoading(true)
      void window.api.activityRead().then((data) => {
        setActivityData(data)
        setActivityLoading(false)
      })
    }
  }, [activeTab, activityData, activityLoading])

  // Persona dirty tracking
  const handlePersonaNameChange = useCallback((name: string) => {
    setPersonaName(name)
    setPersonaDirty(true)
  }, [])

  const handlePersonaToneChange = useCallback((tone: ToneOption) => {
    setPersonaTone(tone)
    setPersonaDirty(true)
  }, [])

  // Model change — immediate save
  const handleModelChange = useCallback(async (model: string) => {
    setPendingModel(model)
    setModelSaving(true)
    try {
      const result = await window.api.settingsUpdateModel({ model })
      if (result.success) {
        setConfig((prev) => prev ? { ...prev, model } : prev)
        showToast('Modell gespeichert', 'success')
      } else {
        showToast(result.error ?? 'Fehler', 'error')
      }
    } catch {
      showToast('Modell-Update fehlgeschlagen', 'error')
    } finally {
      setModelSaving(false)
    }
  }, [showToast])

  // Persona save
  const handlePersonaSave = useCallback(async () => {
    setPersonaSaving(true)
    try {
      const result = await window.api.settingsUpdatePersona({ name: personaName, tone: personaTone })
      if (result.success) {
        setConfig((prev) => prev ? { ...prev, identity: { ...prev.identity, name: personaName, theme: personaTone } } : prev)
        setPersonaDirty(false)
        showToast('Persona gespeichert', 'success')
      } else {
        showToast(result.error ?? 'Fehler', 'error')
      }
    } catch {
      showToast('Persona-Update fehlgeschlagen', 'error')
    } finally {
      setPersonaSaving(false)
    }
  }, [personaName, personaTone, showToast])

  // Folder add
  const handleFolderAdd = useCallback(async () => {
    setFolderAdding(true)
    try {
      const result = await window.api.settingsAddFolder()
      if (result.success && result.path) {
        setConfig((prev) => {
          if (!prev) return prev
          const paths = prev.allowedPaths.includes(result.path as string) ? prev.allowedPaths : [...prev.allowedPaths, result.path as string]
          return { ...prev, allowedPaths: paths }
        })
        showToast('Ordner hinzugef\u00FCgt', 'success')
      }
    } catch {
      showToast('Ordner hinzuf\u00FCgen fehlgeschlagen', 'error')
    } finally {
      setFolderAdding(false)
    }
  }, [showToast])

  // Integration connect
  const handleIntegrationConnect = useCallback(async (service: OAuthService) => {
    setConnectingService(service)
    try {
      const result = await window.api.integrationsConnect({ service })
      if (result.success) {
        setIntegrationStatus((prev) => ({ ...prev, [service]: true }))
        showToast(`${service} verbunden`, 'success')
      } else {
        showToast(result.error ?? 'Verbindung fehlgeschlagen', 'error')
      }
    } catch {
      showToast('Verbindung fehlgeschlagen', 'error')
    } finally {
      setConnectingService(null)
    }
  }, [showToast])

  // Integration disconnect
  const handleIntegrationDisconnect = useCallback(async (service: OAuthService) => {
    try {
      const result = await window.api.integrationsDisconnect({ service })
      if (result.success) {
        setIntegrationStatus((prev) => ({ ...prev, [service]: false }))
        setDisconnectConfirm(null)
        showToast(`${service} getrennt`, 'success')
      } else {
        showToast(result.error ?? 'Trennen fehlgeschlagen', 'error')
      }
    } catch {
      showToast('Trennen fehlgeschlagen', 'error')
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

  // Activity load more
  const handleActivityLoadMore = useCallback(async () => {
    if (!activityData) return
    setActivityLoading(true)
    try {
      const result = await window.api.activityRead({ offset: activityData.entries.length, limit: 50 })
      setActivityData((prev) => {
        if (!prev) return result
        return { entries: [...prev.entries, ...result.entries], hasMore: result.hasMore }
      })
    } catch {
      showToast('Laden fehlgeschlagen', 'error')
    } finally {
      setActivityLoading(false)
    }
  }, [activityData, showToast])

  // Folder remove
  const handleFolderRemove = useCallback(async (folderPath: string) => {
    try {
      const result = await window.api.settingsRemoveFolder({ path: folderPath })
      if (result.success) {
        setConfig((prev) => prev ? { ...prev, allowedPaths: prev.allowedPaths.filter((p) => p !== folderPath) } : prev)
        showToast('Ordner entfernt', 'success')
      } else {
        showToast(result.error ?? 'Fehler', 'error')
      }
    } catch {
      showToast('Ordner entfernen fehlgeschlagen', 'error')
    }
  }, [showToast])

  // Connection mode handlers
  const handleModeChange = useCallback(async (newMode: 'local' | 'server') => {
    setConnectionMode(newMode)
    setConnectionTestResult(null)
    if (newMode === 'local') {
      setConnectionSaving(true)
      try {
        const result = await window.api.setGatewayConfig({ mode: 'local' })
        if (result.success) {
          showToast('Lokaler Modus aktiviert', 'success')
        } else {
          showToast(result.error ?? 'Fehler', 'error')
        }
      } catch {
        showToast('Moduswechsel fehlgeschlagen', 'error')
      } finally {
        setConnectionSaving(false)
      }
    }
  }, [showToast])

  const handleConnectionTest = useCallback(async () => {
    setConnectionTesting(true)
    setConnectionTestResult(null)
    try {
      const result = await window.api.testGatewayConnection({ url: serverUrl, token: serverToken })
      setConnectionTestResult(result)
    } catch {
      setConnectionTestResult({ success: false, error: 'Test fehlgeschlagen' })
    } finally {
      setConnectionTesting(false)
    }
  }, [serverUrl, serverToken])

  const handleConnectionSave = useCallback(async () => {
    setConnectionSaving(true)
    try {
      const result = await window.api.setGatewayConfig({
        mode: connectionMode,
        serverUrl: connectionMode === 'server' ? serverUrl : undefined,
        token: connectionMode === 'server' ? serverToken : undefined,
      })
      if (result.success) {
        showToast('Verbindungsmodus gespeichert', 'success')
        setServerToken('')
      } else {
        showToast(result.error ?? 'Fehler', 'error')
      }
    } catch {
      showToast('Speichern fehlgeschlagen', 'error')
    } finally {
      setConnectionSaving(false)
    }
  }, [connectionMode, serverUrl, serverToken, showToast])

  // Loading skeleton
  if (loading || !config) {
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
        {activeTab === 'allgemein' && (
          <>
            <ConnectionModeSection
              mode={connectionMode}
              serverUrl={serverUrl}
              serverToken={serverToken}
              tokenLast4={tokenLast4}
              saving={connectionSaving}
              testing={connectionTesting}
              testResult={connectionTestResult}
              onModeChange={(m) => void handleModeChange(m)}
              onServerUrlChange={setServerUrl}
              onTokenChange={setServerToken}
              onTest={() => void handleConnectionTest()}
              onSave={() => void handleConnectionSave()}
            />
            <ModelSection
              currentModel={pendingModel}
              provider={config.provider}
              saving={modelSaving}
              onModelChange={(m) => void handleModelChange(m)}
            />
            <PersonaSection
              name={personaName}
              tone={personaTone}
              dirty={personaDirty}
              saving={personaSaving}
              onNameChange={handlePersonaNameChange}
              onToneChange={handlePersonaToneChange}
              onSave={() => void handlePersonaSave()}
            />
            <FolderSection
              paths={config.allowedPaths}
              homePath={config.allowedPaths[0] ?? ''}
              adding={folderAdding}
              onAdd={() => void handleFolderAdd()}
              onRemove={(p) => void handleFolderRemove(p)}
            />
          </>
        )}
        {activeTab === 'integrationen' && (
          <>
            {INTEGRATIONS.map((integration) => (
              <IntegrationCard
                key={integration.id}
                label={integration.label}
                description={integration.description}
                connected={integrationStatus[integration.id]}
                connecting={connectingService === integration.id}
                confirmDisconnect={disconnectConfirm === integration.id}
                onConnect={() => void handleIntegrationConnect(integration.id)}
                onDisconnect={() => setDisconnectConfirm(integration.id)}
                onConfirmDisconnect={() => void handleIntegrationDisconnect(integration.id)}
                onCancelConfirm={() => setDisconnectConfirm(null)}
              />
            ))}
            <p className="text-sm text-content-muted">
              Weitere Integrationen (Outlook, Slack, ...) folgen in einer zukünftigen Version.
            </p>
          </>
        )}
        {activeTab === 'geraete' && (
          <DevicePairing showToast={showToast} />
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
        {activeTab === 'aktivitaet' && (
          <ActivityTab
            activityData={activityData}
            activityLoading={activityLoading}
            activityFilter={activityFilter}
            activityExpandedId={activityExpandedId}
            onFilterChange={setActivityFilter}
            onToggleExpand={(id) => setActivityExpandedId(activityExpandedId === id ? null : id)}
            onLoadMore={() => void handleActivityLoadMore()}
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
