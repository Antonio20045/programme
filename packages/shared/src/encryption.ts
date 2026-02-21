import nacl from 'tweetnacl'

// --- Key Management ---
export function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.box.keyPair()
}

// --- Encrypt/Decrypt ---
export function encrypt(
  message: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array,
): Uint8Array {
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const ciphertext = nacl.box(message, nonce, recipientPublicKey, senderSecretKey)
  if (!ciphertext) {
    throw new Error('Encryption failed')
  }
  const result = new Uint8Array(nonce.length + ciphertext.length)
  result.set(nonce, 0)
  result.set(ciphertext, nonce.length)
  return result
}

export function decrypt(
  data: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array {
  const minLength = nacl.box.nonceLength + 1
  if (data.length < minLength) {
    throw new Error('Data too short for decryption')
  }
  const nonce = data.slice(0, nacl.box.nonceLength)
  const ciphertext = data.slice(nacl.box.nonceLength)
  const plaintext = nacl.box.open(ciphertext, nonce, senderPublicKey, recipientSecretKey)
  if (!plaintext) {
    throw new Error('Decryption failed — wrong key or tampered data')
  }
  return plaintext
}

// --- Serialization Helpers ---
export function encodeMessage(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function decodeMessage(data: Uint8Array): string {
  return new TextDecoder().decode(data)
}

// --- Transport Helpers (Base64) ---
export function toBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
}
