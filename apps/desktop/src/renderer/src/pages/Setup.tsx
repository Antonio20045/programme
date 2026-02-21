import { useState, useEffect, useRef, useCallback } from 'react'
import { TONES } from '../constants'

type WizardStep = 'access' | 'persona' | 'done'

function CheckIcon(): JSX.Element {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-emerald-400"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// AccessScreen (Phase 6.1 — unchanged)
// ---------------------------------------------------------------------------

export function AccessScreen({
  onNext,
}: {
  readonly onNext: () => void
}): JSX.Element {
  const [started, setStarted] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const weiterRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showToast) return
    const timer = setTimeout(() => setShowToast(false), 4000)
    return () => clearTimeout(timer)
  }, [showToast])

  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => weiterRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [started])

  const handleStart = useCallback((): void => {
    setStarted(true)
    setShowToast(true)
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md">
        <h1 className="mb-8 text-center text-3xl font-bold text-gray-100">
          Willkommen bei KI-Assistent
        </h1>

        <div className="rounded-2xl bg-gray-900 p-8">
          <h2 className="text-xl font-semibold text-gray-100">
            Dein KI-Assistent
          </h2>
          <p className="mt-2 text-gray-400">
            Dein persönlicher KI-Assistent für E-Mail, Kalender, Dateien und
            mehr.
          </p>

          <div className="mt-6 text-center" aria-label="15 Euro pro Monat">
            <span className="text-5xl font-bold text-gray-100" aria-hidden="true">15</span>
            <span className="text-2xl font-bold text-gray-100" aria-hidden="true">&euro;</span>
            <span className="text-lg text-gray-400" aria-hidden="true">/Monat</span>
          </div>
          <p className="mt-1 text-center text-sm text-gray-500">
            Alles inklusive. Keine versteckten Kosten.
          </p>

          <ul className="mt-6 space-y-3" aria-label="Enthaltene Features">
            <li className="flex items-center gap-3 text-gray-300">
              <CheckIcon />
              Unbegrenzte Nutzung
            </li>
            <li className="flex items-center gap-3 text-gray-300">
              <CheckIcon />
              Alle Tools inklusive (E-Mail, Kalender, Dateien...)
            </li>
            <li className="flex items-center gap-3 text-gray-300">
              <CheckIcon />
              Läuft lokal auf deinem Rechner
            </li>
          </ul>

          <button
            type="button"
            onClick={handleStart}
            disabled={started}
            className={
              'mt-8 w-full rounded-lg py-3 text-lg font-semibold text-white transition-colors disabled:cursor-not-allowed ' +
              (started
                ? 'bg-emerald-700 opacity-60'
                : 'bg-blue-600 hover:bg-blue-500')
            }
          >
            {started ? 'Gestartet' : 'Jetzt starten'}
          </button>
        </div>

        {started && (
          <button
            ref={weiterRef}
            type="button"
            onClick={onNext}
            className="mt-6 w-full animate-fade-in rounded-lg bg-gray-800 py-3 text-lg font-semibold text-gray-100 transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Weiter
          </button>
        )}
      </div>

      {showToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-8 left-1/2 -translate-x-1/2 animate-fade-in rounded-lg border border-gray-700 bg-gray-800 px-6 py-3 text-sm text-gray-300 shadow-lg"
        >
          Zahlungssystem wird eingerichtet — während der Beta kostenlos
          nutzbar.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PersonaScreen (Phase 6.3)
// ---------------------------------------------------------------------------

export function PersonaScreen({
  onNext,
}: {
  readonly onNext: (data: { name: string; tone: ToneOption }) => void
}): JSX.Element {
  const [name, setName] = useState('Alex')
  const [tone, setTone] = useState<ToneOption>('friendly')

  const handleSubmit = useCallback((): void => {
    if (name.trim() !== '') {
      onNext({ name: name.trim(), tone })
    }
  }, [name, tone, onNext])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md animate-slide-in">
        <h1 className="mb-8 text-center text-3xl font-bold text-gray-100">
          Wie soll dein Assistent sein?
        </h1>

        <div>
          <label htmlFor="persona-name" className="mb-2 block text-sm font-medium text-gray-300">
            Wie soll dein Assistent heißen?
          </label>
          <input
            id="persona-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Sam, Nova, Max..."
            maxLength={20}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mt-8 space-y-3">
          {TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTone(t.id)}
              className={
                'flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition-colors ' +
                (tone === t.id
                  ? 'border-blue-500 bg-gray-800'
                  : 'border-gray-700 bg-gray-900 hover:border-gray-600')
              }
            >
              <div className="flex-1">
                <div className="font-semibold text-gray-100">{t.label}</div>
                <div className="mt-1 text-sm italic text-gray-400">{t.example}</div>
              </div>
              {tone === t.id && <CheckIcon />}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={name.trim() === ''}
          className="mt-8 w-full rounded-lg bg-blue-600 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Weiter
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DoneScreen (Phase 6.3)
// ---------------------------------------------------------------------------

export function DoneScreen({
  config,
  onComplete,
}: {
  readonly config: SetupConfig
  readonly onComplete: () => void
}): JSX.Element {
  const [taskStatus, setTaskStatus] = useState<'running' | 'done' | 'error'>('running')
  const [errorMsg, setErrorMsg] = useState('')

  const runSetup = useCallback(async (): Promise<void> => {
    try {
      const configResult = await window.api.setupWriteConfig(config)
      if (!configResult.success) throw new Error(configResult.error ?? 'Config write failed')

      const gwResult = await window.api.setupStartGateway()
      if (!gwResult.success) throw new Error(gwResult.error ?? 'Gateway start failed')

      setTaskStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unbekannter Fehler')
      setTaskStatus('error')
    }
  }, [config])

  useEffect(() => {
    void runSetup()
  }, [runSetup])

  const handleRetry = useCallback((): void => {
    setTaskStatus('running')
    setErrorMsg('')
    void runSetup()
  }, [runSetup])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md animate-slide-in text-center">
        {/* Running: spinner */}
        {taskStatus === 'running' && (
          <div className="mx-auto mb-8 h-24 w-24">
            <svg className="h-full w-full animate-spin text-blue-500" viewBox="0 0 60 60" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="30" cy="30" r="26" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" d="M4 30a26 26 0 0126-26V0C13.4 0 0 13.4 0 30h4z" fill="currentColor" />
            </svg>
          </div>
        )}

        {/* Done: animated checkmark */}
        {taskStatus === 'done' && (
          <div className="mx-auto mb-8 h-24 w-24">
            <svg viewBox="0 0 60 60" className="h-full w-full">
              <circle
                cx="30"
                cy="30"
                r="26.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray="166"
                strokeDashoffset="166"
                className="animate-check-circle text-emerald-500"
              />
              <polyline
                points="20,31 27,38 40,24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="50"
                strokeDashoffset="50"
                className="animate-check-mark text-emerald-500"
              />
            </svg>
          </div>
        )}

        <h1 className="animate-fade-in-up text-3xl font-bold text-gray-100">
          {taskStatus === 'running' && 'Wird eingerichtet...'}
          {taskStatus === 'done' && <>{config.name} ist bereit!</>}
          {taskStatus === 'error' && 'Einrichtung fehlgeschlagen'}
        </h1>

        {taskStatus === 'error' && (
          <div className="mt-4 animate-fade-in rounded-lg border border-red-800 bg-red-950 p-4">
            <p className="text-sm text-red-400">{errorMsg}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Erneut versuchen
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onComplete}
          disabled={taskStatus !== 'done'}
          className="animate-fade-in-up-late mt-8 w-full rounded-lg bg-blue-600 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Los geht&apos;s
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Setup (root component)
// ---------------------------------------------------------------------------

export default function Setup({
  onSetupComplete,
}: {
  readonly onSetupComplete: () => void
}): JSX.Element {
  const [step, setStep] = useState<WizardStep>('access')
  const [personaName, setPersonaName] = useState('Alex')
  const [tone, setTone] = useState<ToneOption>('friendly')

  if (step === 'access') {
    return <AccessScreen onNext={() => setStep('persona')} />
  }

  if (step === 'persona') {
    return (
      <PersonaScreen
        onNext={(data) => {
          setPersonaName(data.name)
          setTone(data.tone)
          setStep('done')
        }}
      />
    )
  }

  return (
    <DoneScreen
      config={{ name: personaName, tone, provider: 'anthropic', model: 'anthropic/claude-sonnet-4-5' }}
      onComplete={onSetupComplete}
    />
  )
}
