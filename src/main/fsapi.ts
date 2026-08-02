import fs from 'node:fs/promises'
import path from 'node:path'
import type { DirEntry } from '../shared/types'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.turbo', '.cache',
  'target', 'venv', '.venv', '__pycache__', '.DS_Store', 'coverage', '.parcel-cache'
])

const MAX_READ = 2 * 1024 * 1024

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
