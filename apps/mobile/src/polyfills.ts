import * as ExpoCrypto from 'expo-crypto'

const g = globalThis as unknown as { crypto?: Crypto }

if (!g.crypto?.getRandomValues) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: ExpoCrypto.getRandomValues },
  })
}
