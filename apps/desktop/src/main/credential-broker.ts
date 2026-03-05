import { dialog, type BrowserWindow } from 'electron'
import type CredentialVault from './credential-vault'

// ---------------------------------------------------------------------------
// CredentialBroker — domain-validated credential injection with user consent
// ---------------------------------------------------------------------------

const TTL_MS = 5 * 60 * 1000 // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000

export default class CredentialBroker {
  private vault: CredentialVault
  private mainWindow: BrowserWindow | null
  private cleanupTimer: ReturnType<typeof setInterval>

  constructor(vault: CredentialVault, mainWindow: BrowserWindow | null) {
    this.vault = vault
    this.mainWindow = mainWindow
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS)
    // Prevent timer from keeping Node alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref()
    }
  }

  async resolveForUrl(currentUrl: string): Promise<string> {
    let domain: string
    try {
      domain = new URL(currentUrl).hostname
    } catch {
      throw new Error('Ungültige URL für Credential-Auflösung')
    }

    const credentials = this.vault.findByDomain(domain)
    if (credentials.length === 0) {
      throw new Error(`Keine Credentials für Domain "${domain}" gefunden`)
    }

    const cred = credentials[0]!

    const dialogResult = await dialog.showMessageBox(
      this.mainWindow ? this.mainWindow : undefined as unknown as BrowserWindow,
      {
        type: 'question',
        buttons: ['Erlauben', 'Ablehnen'],
        defaultId: 1,
        cancelId: 1,
        title: 'Credential-Zugriff',
        message: `Credential für "${domain}" verwenden?`,
        detail: `Benutzername: ${cred.username}\n\nDer Browser-Agent möchte diese Anmeldedaten auf der aktuellen Seite eingeben.`,
      },
    )

    if (dialogResult.response !== 0) {
      throw new Error('Credential-Zugriff vom Benutzer abgelehnt')
    }

    const plaintext = this.vault.resolve(cred.id)
    if (plaintext === null) {
      throw new Error('Credential konnte nicht entschlüsselt werden')
    }

    return plaintext
  }

  private cleanup(): void {
    // Currently no cached refs — placeholder for future TTL cache
    void TTL_MS
  }

  destroy(): void {
    clearInterval(this.cleanupTimer)
  }
}
