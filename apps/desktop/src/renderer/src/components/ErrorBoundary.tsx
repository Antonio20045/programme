import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  readonly children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center bg-surface p-8">
          <div className="max-w-md rounded-lg border border-edge bg-surface-alt p-8 text-center shadow-lg">
            <h2 className="mb-2 text-lg font-semibold text-content">Etwas ist schiefgelaufen</h2>
            <p className="mb-4 text-sm text-content-secondary">
              Ein unerwarteter Fehler ist aufgetreten. Bitte starte die App neu.
            </p>
            {this.state.error !== null && (
              <pre className="mb-4 overflow-auto rounded bg-surface-raised p-3 text-left text-xs text-content-muted">
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={() => {
                window.location.reload()
              }}
              className="active-press rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface transition-colors hover:bg-accent-hover"
            >
              Neu laden
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
