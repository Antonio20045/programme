/**
 * Generates placeholder tray icons as PNG files using only Node.js built-ins.
 * Creates colored circle icons (16x16 + 32x32 @2x) for each gateway status,
 * plus macOS template images (white on transparent).
 *
 * Run: tsx scripts/generate-tray-icons.ts
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// CRC32 (PNG requires it for chunk integrity)
// ---------------------------------------------------------------------------

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[n] = c >>> 0
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = (crcTable[(crc ^ buf[i]!) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([len, typeAndData, crcBuf])
}

function createCirclePng(size: number, r: number, g: number, b: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA

  // Raw image data: one filter byte per row + RGBA pixels
  const rowBytes = 1 + size * 4
  const raw = Buffer.alloc(size * rowBytes)
  const center = size / 2
  const radius = size / 2 - 1.5

  for (let y = 0; y < size; y++) {
    const rowOff = y * rowBytes
    raw[rowOff] = 0 // filter: None
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center
      const dy = y + 0.5 - center
      const dist = Math.sqrt(dx * dx + dy * dy)
      const alpha = Math.max(0, Math.min(1, radius - dist + 0.5))
      const off = rowOff + 1 + x * 4
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
      raw[off + 3] = Math.round(alpha * 255)
    }
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// Generate icons
// ---------------------------------------------------------------------------

const outDir = join(process.cwd(), 'apps/desktop/assets/tray')
mkdirSync(outDir, { recursive: true })

// Colors match App.tsx STATUS_COLORS
const statusColors: Record<string, [number, number, number]> = {
  online:   [16, 185, 129],  // #10b981
  offline:  [107, 114, 128], // #6b7280
  starting: [245, 158, 11],  // #f59e0b
  error:    [239, 68, 68],   // #ef4444
}

// Colored icons for each status (all platforms)
for (const [name, [r, g, b]] of Object.entries(statusColors)) {
  writeFileSync(join(outDir, `tray-${name}.png`), createCirclePng(16, r!, g!, b!))
  writeFileSync(join(outDir, `tray-${name}@2x.png`), createCirclePng(32, r!, g!, b!))
}

// macOS template images (white on transparent — system auto-colors)
for (const name of Object.keys(statusColors)) {
  writeFileSync(join(outDir, `tray-${name}Template.png`), createCirclePng(16, 255, 255, 255))
  writeFileSync(join(outDir, `tray-${name}Template@2x.png`), createCirclePng(32, 255, 255, 255))
}

const count = Object.keys(statusColors).length * 4
console.log(`Generated ${String(count)} tray icons in ${outDir}`)
