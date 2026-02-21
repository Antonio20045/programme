import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import type { AppStateStatus } from 'react-native'
import { PushService } from '../services/push'

interface UseAppStateOptions {
  onForeground?: () => void
  onBackground?: () => void
}

export function useAppState({ onForeground, onBackground }: UseAppStateOptions): void {
  const appState = useRef<AppStateStatus>(AppState.currentState)

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        void PushService.clearBadge()
        onForeground?.()
      } else if (appState.current === 'active' && nextState.match(/inactive|background/)) {
        onBackground?.()
      }
      appState.current = nextState
    })

    return () => {
      subscription.remove()
    }
  }, [onForeground, onBackground])
}
