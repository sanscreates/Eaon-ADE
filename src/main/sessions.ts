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

const CWD_RE = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/

/**
 * The folder a transcript was recorded in.
 *
 * Usually in the first line, but not always — a session that opens with a long
 * summary can push it well past the head we read. Those get one deeper pass,
 * because a session with no folder cannot be shown when the list is narrowed to
 * one project, and silently dropping it is worse than the extra read.
 */
async function readCwd(file: string, head: string): Promise<string> {
  const found = firstMatch(head, CWD_RE) ?? firstMatch(await readHead(file, 262144), CWD_RE)
  return found ? found.replace(/\\\\/g, '\\').replace(/\\"/g, '"') : ''
}

function tidy(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * How many transcripts to open per scan.
 *
 * Every session is returned with the folder it ran in so the caller can narrow
 * the list to one project. That filter has to be applied to the whole set, not
 * to a page of it — slicing to a handful of the most recent first would let a
 * busy project crowd out every session belonging to the folder you are actually
 * in, and the list would look empty when it is not.
 */
const MAX_SCAN = 400

/** The folder name Claude Code derives from a working directory. */
export function projectSlug(cwd: string): string {
  // Character for character, with no collapsing of runs: /a/-b becomes -a--b.
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
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

  const found: { file: string; dir: string; id: string; mtime: number }[] = []
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
          dir,
          id: entry.replace(/\.jsonl$/, ''),
          mtime: stat.mtimeMs
        })
      } catch {
        /* skip unreadable transcripts */
      }
    }
  }

  found.sort((a, b) => b.mtime - a.mtime)
  const head = found.slice(0, Math.max(limit, MAX_SCAN))

  // One folder per directory, so a transcript that never recorded its cwd can
  // borrow it from a sibling. Without this those sessions have no folder at all
  // and vanish the moment the list is narrowed to one project.
  const cwdByDir = new Map<string, string>()

  const out: (ResumableSession & { dir: string })[] = []
  for (const item of head) {
    const text = await readHead(item.file)
    const cwd = await readCwd(item.file, text)
    if (cwd && !cwdByDir.has(item.dir)) cwdByDir.set(item.dir, cwd)

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
      cwd,
      dir: item.dir,
      label: label || 'Session',
      command: `claude --resume ${item.id}`,
      updatedAt: item.mtime
    })
  }

  return out.map(({ dir, ...session }) => ({
    ...session,
    cwd: session.cwd || cwdByDir.get(dir) || ''
  }))
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
    out.push({
      id: item.id,
      tool: 'Codex',
      cwd: await readCwd(item.file, text),
      label: tidy(firstMatch(text, /"instructions"\s*:\s*"((?:[^"\\]|\\.)*)"/) ?? 'Session'),
      command: `codex resume ${item.id}`,
      updatedAt: item.mtime
    })
  }
  return out
}

/**
 * Every resumable session on this machine, newest first, each carrying the
 * folder it ran in. Narrowing to a single project is the caller's job: it is
 * the renderer that knows which workspace you are looking at, and it can
 * re-narrow as you switch between them without going back to disk.
 */
export async function listResumable(limit = MAX_SCAN): Promise<ResumableSession[]> {
  const [claude, codex] = await Promise.all([claudeSessions(limit), codexSessions(limit)])
  return [...claude, ...codex].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

/** How many transcripts exist for a folder — shown next to recent folders. */
export async function sessionCountFor(cwd: string): Promise<number> {
  const dir = path.join(os.homedir(), '.claude', 'projects', projectSlug(cwd))
  try {
    const entries = await fs.readdir(dir)
    return entries.filter((e) => e.endsWith('.jsonl')).length
  } catch {
    return 0
  }
}
