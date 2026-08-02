/**
 * Draws the ADE app icon straight to a PNG — the grid-A mark, bone on ink,
 * coral counter, on a rounded square.
 *
 * Everything here is axis-aligned rounded rectangles, so it renders with a
 * coverage test at 4× and box-downsamples for antialiasing. That is cheaper and
 * more predictable than pulling in a rasteriser for six shapes.
 *
 *   node scripts/make-icon.mjs [size] [outfile]
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const INK = [0x0f, 0x0f, 0x0f]
const BONE = [0xf4, 0xf2, 0xee]
const CORAL = [0xf1, 0x74, 0x55]

const CELLS = [
  [0, 2],
  [1, 1], [1, 2], [1, 3],
  [2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
  [3, 0], [3, 4],
  [4, 0], [4, 4]
]
const LIT = [1, 2]

const SS = 4 // supersample factor

/** Signed coverage test for a rounded rectangle. */
function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

function render(size) {
  const S = size * SS
  const buf = Buffer.alloc(S * S * 4)

  // Icon plate: rounded square, 22% corner radius, matching the brand sheet.
  const plateR = S * 0.2237
  // The mark occupies the middle ~56%, which keeps the brand's 2×-dot margin.
  const span = S * 0.56
  const cell = span / 5.6
  const gap = cell * 0.15
  const originX = (S - span) / 2
  const originY = (S - span) / 2
  const dotR = cell * 0.12

  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const i = (y * S + x) * 4

      if (!insideRoundRect(px, py, 0, 0, S, S, plateR)) continue

      let colour = INK
      for (const [row, col] of CELLS) {
        const dx = originX + col * (cell + gap)
        const dy = originY + row * (cell + gap)
        if (insideRoundRect(px, py, dx, dy, cell, cell, dotR)) {
          colour = row === LIT[0] && col === LIT[1] ? CORAL : BONE
          break
        }
      }

      buf[i] = colour[0]
      buf[i + 1] = colour[1]
      buf[i + 2] = colour[2]
      buf[i + 3] = 255
    }
  }

  // Box-downsample back to `size`, which is where the antialiasing comes from.
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4
          const alpha = buf[i + 3]
          // Premultiply so transparent pixels do not drag the edge toward black.
          r += buf[i] * alpha
          g += buf[i + 1] * alpha
          b += buf[i + 2] * alpha
          a += alpha
        }
      }
      const o = (y * size + x) * 4
      if (a === 0) continue
      out[o] = Math.round(r / a)
      out[o + 1] = Math.round(g / a)
      out[o + 2] = Math.round(b / a)
      out[o + 3] = Math.round(a / (SS * SS))
    }
  }
  return out
}

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n += 1) {
    c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function toPng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // Each scanline is prefixed with its filter byte; 0 means none.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const size = Number(process.argv[2] ?? 1024)
const out = resolve(process.argv[3] ?? 'resources/icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, toPng(render(size), size))
console.log(`wrote ${out} (${size}×${size})`)
