import { useState, useEffect, useCallback, useRef } from 'react'

type PairingState = 'idle' | 'qr' | 'paired' | 'expired'

function SpinnerSmall(): JSX.Element {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function DevicePairing({
  showToast,
}: {
  readonly showToast: (message: string, type: 'success' | 'error') => void
}): JSX.Element {
  const [state, setState] = useState<PairingState>('idle')
  const [loading, setLoading] = useState(true)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)
  const [countdown, setCountdown] = useState('')
  const [safeStorageAvailable, setSafeStorageAvailable] = useState(true)
  const [partnerDeviceId, setPartnerDeviceId] = useState('')
  const [pairedAt, setPairedAt] = useState('')
  const [confirmUnpair, setConfirmUnpair] = useState(false)
  const [unpairLoading, setUnpairLoading] = useState(false)

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [])

  // Load stored pairing on mount
  useEffect(() => {
    void window.api.pairingGetStored().then((result) => {
      if (result.paired) {
        setState('paired')
        setPartnerDeviceId(result.partnerDeviceId ?? '')
        setPairedAt(result.pairedAt ?? '')
        setSafeStorageAvailable(result.safeStorageAvailable ?? true)
      }
      setLoading(false)
    })
  }, [])

  // Countdown timer
  useEffect(() => {
    if (state !== 'qr' || expiresAt === 0) return

    const tick = (): void => {
      const remaining = Math.max(0, expiresAt - Date.now())
      if (remaining <= 0) {
        setState('expired')
        setCountdown('0:00')
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current)
          countdownIntervalRef.current = null
        }
        return
      }
      const secs = Math.ceil(remaining / 1000)
      const min = Math.floor(secs / 60)
      const sec = secs % 60
      setCountdown(`${String(min)}:${String(sec).padStart(2, '0')}`)
    }

    tick()
    countdownIntervalRef.current = setInterval(tick, 1000)

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
        countdownIntervalRef.current = null
      }
    }
  }, [state, expiresAt])

  const startPairing = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.pairingInit()
      if (!result.success) {
        showToast(result.error ?? 'Pairing fehlgeschlagen', 'error')
        setLoading(false)
        return
      }
      setQrDataUrl(result.qrDataUrl ?? '')
      setExpiresAt(result.expiresAt ?? 0)
      setSafeStorageAvailable(result.safeStorageAvailable ?? true)
      setState('qr')
      setLoading(false)

      // Start polling
      const token = result.pairingToken ?? ''
      pollIntervalRef.current = setInterval(() => {
        void window.api.pairingPollStatus(token).then((pollResult) => {
          if (pollResult.paired) {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current)
              pollIntervalRef.current = null
            }
            setState('paired')
            setPartnerDeviceId(pollResult.partnerDeviceId ?? '')
            setPairedAt(new Date().toISOString())
            showToast('Gerät verbunden', 'success')
          }
        })
      }, 2000)
    } catch {
      showToast('Pairing fehlgeschlagen', 'error')
      setLoading(false)
    }
  }, [showToast])

  const cancelPairing = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setState('idle')
    setQrDataUrl('')
    setExpiresAt(0)
  }, [])

  const handleUnpair = useCallback(async () => {
    setUnpairLoading(true)
    try {
      const result = await window.api.pairingUnpair()
      if (result.success) {
        setState('idle')
        setPartnerDeviceId('')
        setPairedAt('')
        setConfirmUnpair(false)
        showToast('Verbindung getrennt', 'success')
      } else {
        showToast(result.error ?? 'Trennen fehlgeschlagen', 'error')
      }
    } catch {
      showToast('Trennen fehlgeschlagen', 'error')
    } finally {
      setUnpairLoading(false)
    }
  }, [showToast])

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    } catch {
      return iso
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="h-20 animate-pulse rounded-lg bg-gray-800" />
      </div>
    )
  }

  // State: NOT PAIRED
  if (state === 'idle') {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-100">Mobilgerät verbinden</h3>
        <p className="mb-4 text-sm text-gray-400">
          Scanne den QR-Code mit der KI-Assistent App auf deinem Handy.
        </p>
        <button
          type="button"
          onClick={() => void startPairing()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
        >
          Gerät verbinden
        </button>
      </div>
    )
  }

  // State: QR CODE / EXPIRED
  if (state === 'qr' || state === 'expired') {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-100">QR-Code scannen</h3>

        <div className="flex justify-center">
          <img
            src={qrDataUrl}
            alt="Pairing QR-Code"
            className={`rounded-lg${state === 'expired' ? ' opacity-30' : ''}`}
            width={256}
            height={256}
          />
        </div>

        <div className="mt-4 text-center">
          {state === 'qr' && (
            <>
              <div className="flex items-center justify-center gap-2 text-sm text-gray-300">
                <SpinnerSmall />
                <span>Warte auf Verbindung...</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Code gültig für: {countdown}
              </p>
            </>
          )}

          {state === 'expired' && (
            <>
              <p className="text-sm text-red-400">Code abgelaufen</p>
              <button
                type="button"
                onClick={() => void startPairing()}
                className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
              >
                Neuen Code erstellen
              </button>
            </>
          )}
        </div>

        {state === 'qr' && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={cancelPairing}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
            >
              Abbrechen
            </button>
          </div>
        )}

        {!safeStorageAvailable && (
          <div className="mt-4 rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3">
            <p className="text-xs text-yellow-400">
              Kein OS-Keyring verfügbar. Das Pairing ist nur für diese Sitzung gültig und geht beim Neustart verloren.
            </p>
          </div>
        )}
      </div>
    )
  }

  // State: PAIRED
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <h3 className="mb-4 text-lg font-semibold text-gray-100">Mobilgerät</h3>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-900 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            Verbunden
          </span>
        </div>
        {pairedAt !== '' && (
          <p className="text-sm text-gray-400">
            Verbunden seit {formatDate(pairedAt)}
          </p>
        )}
        {partnerDeviceId !== '' && (
          <p className="font-mono text-xs text-gray-500">
            Geräte-ID: {partnerDeviceId.slice(0, 8)}...{partnerDeviceId.slice(-8)}
          </p>
        )}
      </div>

      {!safeStorageAvailable && (
        <div className="mt-4 rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3">
          <p className="text-xs text-yellow-400">
            Kein OS-Keyring verfügbar. Das Pairing ist nur für diese Sitzung gültig.
          </p>
        </div>
      )}

      <div className="mt-4">
        {!confirmUnpair && (
          <button
            type="button"
            onClick={() => setConfirmUnpair(true)}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-gray-800"
          >
            Verbindung trennen
          </button>
        )}

        {confirmUnpair && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleUnpair()}
              disabled={unpairLoading}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            >
              {unpairLoading && <SpinnerSmall />}
              Wirklich trennen
            </button>
            <button
              type="button"
              onClick={() => setConfirmUnpair(false)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
