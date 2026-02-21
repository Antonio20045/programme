// Polyfill crypto.getRandomValues for Node/Jest environment
const { randomBytes } = require('crypto')

if (!globalThis.crypto?.getRandomValues) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      getRandomValues: (buffer) => {
        const bytes = randomBytes(buffer.length)
        buffer.set(bytes)
        return buffer
      },
    },
  })
}
