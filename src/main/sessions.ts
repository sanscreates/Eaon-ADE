import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ResumableSession } from '../shared/types'

/** Reads the first `bytes` of a file without pulling the whole thing into memory. */
async function readHead(file: string, bytes = 8192): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    const stream = createReadStream(file, { start: 0, end: bytes, encoding: 'utf8' })
    stream.on('data', (c) => {
      out += c
    })
    stream.on('end', () => resolve(out))
    stream.on('error', () => resolve(''))
  })
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re)
  return m ? m[1] : null
}

function tidy(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Claude Code keeps one JSONL transcript per session under
 * ~/.claude/projects/<slugified-cwd>/<session-id>.jsonl. Each of those is
 * resumable with `claude --resume <id>`, so we can offer them back.
 */
async function claudeSessions(limit: number): Promise<ResumableSession[]> {
  const root = path.join(os.homedir(), '.claude', 'projects')
  let projectDirs: string[]
  try {
    projectDirs = await fs.readdir(root)
  } catch {
    return []
  }

  const found: { file: string; id: string; mtime: number }[] = []
  for (const dir of projectDirs) {
    const full = path.join(root, dir)
    let entries: string[]
    try {
      entries = await fs.readdir(full)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue
      try {
        const stat = await fs.stat(path.join(full, entry))
        if (stat.size < 64) continue
        found.push({
          file: path.join(full, entry),
          id: entry.replace(/\.jsonl$/, ''),
          mtime: stat.mtimeMs
        })
      } catch {
        /* skip unreadable transcripts */
      }
    }
  }

  found.sort((a, b) => b.mtime - a.mtime)
  const head = found.slice(0, limit)

  const out: ResumableSession[] = []
  for (const item of head) {
    const text = await readHead(item.file)
    const cwd = firstMatch(text, /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    const content = firstMatch(text, /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    let label = 'Session'
    if (content) {
      try {
        label = tidy(JSON.parse(`"${content}"`))
      } catch {
        label = tidy(content)
      }
    }
    out.push({
      id: item.id,
      tool: 'Claude Code',
      cwd: cwd ? cwd.replace(/\\\\/g, '\\').replace(/\\"/g, '"') : '',
      label: label || 'Session',
      command: `claude --resume ${item.id}`,
      updatedAt: item.mtime
    })
  }
  return out
}

/** Codex writes rollout transcripts under ~/.codex/sessions when it is installed. */
async function codexSessions(limit: number): Promise<ResumableSession[]> {
  const root = path.join(os.homedir(), '.codex', 'sessions')
  const found: { file: string; id: string; mtime: number }[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4 || found.length > 400) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.name.endsWith('.jsonl')) {
        try {
          const stat = await fs.stat(full)
          const id =
            firstMatch(entry.name, /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) ??
            entry.name.replace(/\.jsonl$/, '')
          found.push({ file: full, id, mtime: stat.mtimeMs })
        } catch {
          /* skip */
        }
      }
    }
  }

  await walk(root, 0)
  found.sort((a, b) => b.mtime - a.mtime)

  const out: ResumableSession[] = []
  for (const item of found.slice(0, limit)) {
    const text = await readHead(item.file)
    const cwd = firstMatch(text, /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    out.push({
      id: item.id,
      tool: 'Codex',
      cwd: cwd ?? '',
      label: tidy(firstMatch(text, /"instructions"\s*:\s*"((?:[^"\\]|\\.)*)"/) ?? 'Session'),
      command: `codex resume ${item.id}`,
      updatedAt: item.mtime
    })
  }
  return out
}

export async function listResumable(limit = 24): Promise<ResumableSession[]> {
  const [claude, codex] = await Promise.all([claudeSessions(limit), codexSessions(limit)])
  return [...claude, ...codex].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

/** How many transcripts exist for a folder — shown next to recent folders. */
export async function sessionCountFor(cwd: string): Promise<number> {
  const slug = cwd.replace(/[/\\.]/g, '-')
  const dir = path.join(os.homedir(), '.claude', 'projects', slug)
  try {
    const entries = await fs.readdir(dir)
    return entries.filter((e) => e.endsWith('.jsonl')).length
  } catch {
    return 0
  }
}
