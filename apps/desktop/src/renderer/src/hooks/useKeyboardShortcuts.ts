import { useEffect } from 'react'

interface ShortcutConfig {
  /** Key code (e.g. 'k', 'n', 'Escape') */
  readonly key: string
  /** Require Cmd/Ctrl modifier */
  readonly meta?: boolean
  /** Require Shift modifier */
  readonly shift?: boolean
  /** Callback when shortcut is triggered */
  readonly handler: () => void
}

/**
 * Global keyboard shortcuts hook.
 * Registers keyboard shortcuts on mount and cleans up on unmount.
 */
export function useKeyboardShortcuts(shortcuts: readonly ShortcutConfig[]): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement | null
      if (
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') &&
        e.key !== 'Escape'
      ) {
        return
      }

      for (const shortcut of shortcuts) {
        const metaMatch = shortcut.meta === true ? (e.metaKey || e.ctrlKey) : true
        const shiftMatch = shortcut.shift === true ? e.shiftKey : true
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

        if (metaMatch && shiftMatch && keyMatch) {
          e.preventDefault()
          shortcut.handler()
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [shortcuts])
}

export type { ShortcutConfig }
