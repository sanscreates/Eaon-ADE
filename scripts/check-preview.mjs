/*
 * Checks the main-process half of rich previews: binary-safe reading, mime
 * detection, and the size cap.
 *
 * The renderer half — markdown-to-HTML and sanitization — needs a real DOM
 * (DOMPurify requires one) and is deliberately verified live, against the
 * actual running app, with a genuine XSS payload and a canary that proves
 * whether it fired. See the live check for that; this script covers what a
 * plain Node process can prove deterministically.
 *
 *   node scripts/check-preview.mjs
 */

import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaon-preview-'))

let pass = 0
const failures = []
function check(name, ok, extra) {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${extra}` : ''}`)
  }
}

const outfile = path.join(tmp, 'fsapi.mjs')
await build({
  entryPoints: [path.join(root, 'src/main/fsapi.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
  // fsapi.ts reaches into `electron` only for app.getPath('temp') inside
  // saveDropped, which nothing below calls.
  plugins: [
    {
      name: 'stub-electron',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'e', namespace: 'stub' }))
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: `export const app = { getPath: () => ${JSON.stringify(tmp)} }`,
          loader: 'js'
        }))
      }
    }
  ]
})
const fsapi = await import(outfile)

/* ---- 1. mime detection --------------------------------------------------- */

console.log('\nmime detection is extension-based and nothing else')
check('.png maps to image/png', fsapi.mimeFor('/a/b.png') === 'image/png')
check('.PNG (uppercase) still matches', fsapi.mimeFor('/a/b.PNG') === 'image/png')
check('.jpg and .jpeg both map to image/jpeg', fsapi.mimeFor('x.jpg') === 'image/jpeg' && fsapi.mimeFor('x.jpeg') === 'image/jpeg')
check('.svg maps to image/svg+xml', fsapi.mimeFor('x.svg') === 'image/svg+xml')
check('.pdf maps to application/pdf', fsapi.mimeFor('x.pdf') === 'application/pdf')
check('.md is not a binary-previewable type', fsapi.mimeFor('x.md') === null)
check('.exe is not guessed at', fsapi.mimeFor('x.exe') === null)
check('a file with no extension is not guessed at', fsapi.mimeFor('README') === null)

/* ---- 2. reading real bytes ------------------------------------------------ */

console.log('\nreadBinary round-trips real bytes as base64')
// A real (tiny, valid) PNG — the 1x1 transparent pixel every test suite uses.
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const pngPath = path.join(tmp, 'pixel.png')
fs.writeFileSync(pngPath, pngBytes)

const read = await fsapi.readBinary(pngPath)
check('the mime is reported', read.mime === 'image/png', read.mime)
check('not marked truncated', read.truncated === false)
check(
  'decoding the base64 reproduces the exact original bytes',
  Buffer.from(read.base64, 'base64').equals(pngBytes)
)

/* ---- 3. the size cap ------------------------------------------------------ */

console.log('\noversized files are refused, not silently truncated')
// A real file one byte over the actual 24 MB constant — writing 24 MB to a
// temp file is fast enough not to matter, and this is the exact boundary the
// source enforces, not a stand-in for it.
const overCapPath = path.join(tmp, 'over-cap.png')
const capBytes = 24 * 1024 * 1024 + 1
fs.writeFileSync(overCapPath, Buffer.alloc(capBytes))
let capError = null
try {
  await fsapi.readBinary(overCapPath)
} catch (err) {
  capError = err
}
check('a file one byte over the cap is refused', capError instanceof Error)
check(
  'the message states the limit in human terms, not a raw byte count',
  /MB/.test(capError?.message ?? ''),
  capError?.message
)
fs.rmSync(overCapPath, { force: true })

/* ---- 4. refusing what it was not built for -------------------------------- */

console.log('\na non-previewable extension is refused before any bytes are touched')
const txtPath = path.join(tmp, 'notes.txt')
fs.writeFileSync(txtPath, 'plain text, not an image')
let textError = null
try {
  await fsapi.readBinary(txtPath)
} catch (err) {
  textError = err
}
check('a .txt file is refused by readBinary', textError instanceof Error)
check('with a clear reason', /not.*previewable/i.test(textError?.message ?? ''), textError?.message)

/* ---- done ------------------------------------------------------------------ */

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
