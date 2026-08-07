import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { DirEntry } from '../shared/types'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.turbo', '.cache',
  'target', 'venv', '.venv', '__pycache__', '.DS_Store', 'coverage', '.parcel-cache'
])

const MAX_READ = 2 * 1024 * 1024

/**
 * Images and PDFs are legitimately bigger than the text cap, but a multi-
 * hundred-megabyte file base64-encoded and sent whole across IPC would still
 * jank the renderer on receipt — so this is generous, not unlimited.
 */
const MAX_BINARY_READ = 24 * 1024 * 1024

/** Extensions the preview pane knows what to do with. Nothing else is guessed at. */
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf'
}

export function mimeFor(file: string): string | null {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] ?? null
}

export async function listDir(dir: string): Promise<DirEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: DirEntry[] = []
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const full = path.join(dir, entry.name)
    let size = 0
    if (entry.isFile()) {
      try {
        size = (await fs.stat(full)).size
      } catch {
        /* dangling symlink */
      }
    }
    out.push({ name: entry.name, path: full, isDir: entry.isDirectory(), size })
  }
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
  return out
}

export async function readFile(file: string): Promise<{ text: string; truncated: boolean }> {
  const stat = await fs.stat(file)
  if (stat.size > MAX_READ) {
    const handle = await fs.open(file, 'r')
    try {
      const buf = Buffer.alloc(MAX_READ)
      await handle.read(buf, 0, MAX_READ, 0)
      return { text: buf.toString('utf8'), truncated: true }
    } finally {
      await handle.close()
    }
  }
  const buf = await fs.readFile(file)
  // A NUL byte in the first block is the usual tell for a binary file.
  if (buf.subarray(0, 4096).includes(0)) {
    throw new Error('Binary file — Eaon can’t show this one.')
  }
  return { text: buf.toString('utf8'), truncated: false }
}

/**
 * Bytes, for the one class of file that is never valid UTF-8 text: images and
 * PDFs. `readFile` refuses these on sight — the NUL check that keeps a
 * genuinely binary file out of the text editor also keeps every image and
 * PDF out — so a preview needs a door of its own.
 *
 * Returned as base64 because that is what has to happen to the bytes anyway:
 * the renderer's Content-Security-Policy admits `data:`/`blob:` sources but
 * not `file:`, so a `file://` src is silently dropped and nothing this
 * function's *caller* does can fix that — the bytes have to cross the IPC
 * bridge and become a `data:` URL, the same trip `saveDropped` already makes
 * in the other direction for a dropped image with no path of its own.
 */
export async function readBinary(
  file: string
): Promise<{ base64: string; mime: string; truncated: boolean }> {
  const mime = mimeFor(file)
  if (!mime) throw new Error('Not a previewable file type.')

  const stat = await fs.stat(file)
  if (stat.size > MAX_BINARY_READ) {
    // A truncated image or PDF is not a smaller version of the real one —
    // both formats need their own trailer/footer bytes to decode at all — so
    // this is a refusal, not a partial read the way the text path allows.
    throw new Error(
      `That file is ${Math.round(stat.size / 1024 / 1024)} MB, over the ${Math.round(MAX_BINARY_READ / 1024 / 1024)} MB preview limit.`
    )
  }

  const buf = await fs.readFile(file)
  return { base64: buf.toString('base64'), mime, truncated: false }
}

export async function writeFile(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text, 'utf8')
}

export async function searchFiles(root: string, query: string, limit = 60): Promise<DirEntry[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const hits: DirEntry[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (hits.length >= limit || depth > 7) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (hits.length >= limit) return
      if (SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.name.toLowerCase().includes(needle)) {
        hits.push({ name: entry.name, path: full, isDir: false, size: 0 })
      }
    }
  }

  await walk(root, 0)
  return hits
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Park a dropped payload on disk and hand back its path.
 *
 * Most drops carry a real file and keep their own path — that one is better,
 * because the agent then reads the file you actually dropped. This is for the
 * other kind: an image dragged straight out of a web page or a screenshot tool
 * arrives as bytes with nowhere to point at. Writing it out is what turns it
 * into something a terminal can name.
 */
export async function saveDropped(name: string, bytes: Uint8Array): Promise<string> {
  const dir = path.join(app.getPath('temp'), 'eaon-ade-drops')
  await fs.mkdir(dir, { recursive: true })

  // Keep the extension — it is how everything downstream knows it is an image —
  // and throw away anything else that could climb out of this folder.
  const safe = path.basename(name || 'dropped').replace(/[^\w.-]+/g, '-').slice(-64) || 'dropped'
  const stamp = Date.now().toString(36)
  const ext = path.extname(safe)
  const stem = ext ? safe.slice(0, -ext.length) : safe
  const target = path.join(dir, `${stem || 'image'}-${stamp}${ext}`)

  await fs.writeFile(target, bytes)
  return target
}
