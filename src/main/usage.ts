import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import {
  WINDOWS,
  billedOf,
  limitsFor,
  modelLabel,
  type ModelUse,
  type UsageReport,
  type UsageWindow
} from '../shared/usage'

/**
 * Reading the plan's spend off the transcripts Claude Code already keeps.
 *
 * There is a lot of it — nearly half a gigabyte written in a week here — so the
 * whole file is read exactly once. After that only the bytes appended since the
 * last look are parsed, because a transcript is append-only and its length is
 * enough to know what is new. That is the difference between a readout that can
 * refresh every few seconds and one that re-reads 466 MB to tell you the same
 * number.
 */

interface Event {
  t: number
  model: string
  input: number
  cacheCreate: number
  cacheRead: number
  output: number
}

interface FileCursor {
  /** How far into the file has already been parsed. */
  offset: number
  events: Event[]
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Longest window we ever report on; nothing older is worth keeping. */
const KEEP_MS = WEEK_MS

const cursors = new Map<string, FileCursor>()
/** Guards against two refreshes overlapping and counting the same bytes twice. */
let running: Promise<UsageReport> | null = null

function projectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

async function transcripts(): Promise<string[]> {
  const root = projectsDir()
  const out: string[] = []
  let entries: string[]
  try {
    entries = await fsp.readdir(root)
  } catch {
    return out
  }
  const cutoff = Date.now() - KEEP_MS
  for (const dir of entries) {
    let files: string[]
    try {
      files = await fsp.readdir(path.join(root, dir))
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue
      const file = path.join(root, dir, name)
      try {
        // A transcript untouched for a week cannot hold anything in range, and
        // skipping it here is what keeps the first scan to the files that
        // matter rather than all 185 of them.
        if ((await fsp.stat(file)).mtimeMs < cutoff && !cursors.has(file)) continue
      } catch {
        continue
      }
      out.push(file)
    }
  }
  return out
}

/**
 * Parse whatever is new in one transcript.
 *
 * Streamed rather than read whole: these files reach hundreds of megabytes, and
 * holding one in memory to count a few hundred numbers out of it would be a
 * poor trade. Lines are filtered on a substring before being handed to
 * JSON.parse — most of a transcript is user turns and tool output with no usage
 * on them at all, and parsing those is the bulk of the work avoided.
 */
async function scanFile(file: string, seen: Set<string>): Promise<void> {
  let size = 0
  try {
    size = (await fsp.stat(file)).size
  } catch {
    return
  }

  let cursor = cursors.get(file)
  // A file that shrank was rotated or rewritten; everything known about it is
  // no longer trustworthy, so it is read again from the start.
  if (!cursor || size < cursor.offset) {
    cursor = { offset: 0, events: [] }
    cursors.set(file, cursor)
  }
  if (size === cursor.offset) return

  const stream = fs.createReadStream(file, { start: cursor.offset, encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of lines) {
      if (line.length < 40) continue
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue

      let row: {
        type?: string
        timestamp?: string
        requestId?: string
        message?: { model?: string; usage?: Record<string, number> }
      }
      try {
        row = JSON.parse(line)
      } catch {
        // A half-written final line is normal on a live session; the next pass
        // picks it up, because the offset only advances past what parsed.
        continue
      }

      if (row.type !== 'assistant' || !row.message?.usage || !row.timestamp) continue
      const t = Date.parse(row.timestamp)
      if (!Number.isFinite(t)) continue

      // One request can be written more than once across a retry or a resumed
      // transcript. Counting it twice would quietly inflate the total.
      const key = row.requestId ? `${row.requestId}` : `${t}:${row.message.model}`
      if (seen.has(key)) continue
      seen.add(key)

      const u = row.message.usage
      cursor.events.push({
        t,
        model: row.message.model ?? 'unknown',
        input: u.input_tokens ?? 0,
        cacheCreate: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0
      })
    }
    cursor.offset = size
  } finally {
    lines.close()
    stream.close()
  }

  // Anything past the longest window will never be counted again.
  const cutoff = Date.now() - KEEP_MS
  if (cursor.events.length && cursor.events[0].t < cutoff) {
    cursor.events = cursor.events.filter((e) => e.t >= cutoff)
  }
}

function readCredentials(): { plan: string; tier: string } {
  try {
    const file = path.join(os.homedir(), '.claude', '.credentials.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      claudeAiOauth?: { subscriptionType?: string; rateLimitTier?: string }
    }
    // Only the plan name and tier are read. The tokens beside them are not touched
    // unless the authenticated source is switched on, which is a separate door.
    return {
      plan: raw.claudeAiOauth?.subscriptionType ?? '',
      tier: raw.claudeAiOauth?.rateLimitTier ?? ''
    }
  } catch {
    return { plan: '', tier: '' }
  }
}

/** Fold the events inside one window into per-model totals. */
function summarise(
  events: Event[],
  spec: (typeof WINDOWS)[number],
  limit: number,
  now: number
): UsageWindow {
  const from = now - spec.spanMs
  const inWindow = events.filter((e) => e.t >= from)

  const byModel = new Map<string, ModelUse>()
  let used = 0
  let oldest = Infinity

  for (const e of inWindow) {
    let m = byModel.get(e.model)
    if (!m) {
      m = {
        model: e.model,
        label: modelLabel(e.model),
        input: 0,
        cacheCreate: 0,
        cacheRead: 0,
        output: 0,
        billed: 0
      }
      byModel.set(e.model, m)
    }
    m.input += e.input
    m.cacheCreate += e.cacheCreate
    m.cacheRead += e.cacheRead
    m.output += e.output
    const billed = billedOf(e)
    m.billed += billed
    used += billed
    if (e.t < oldest) oldest = e.t
  }

  return {
    ...spec,
    used,
    limit,
    pct: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
    // The window is rolling, so it does not reset all at once — the moment it
    // eases is when the oldest thing in it ages out.
    resetsAt: Number.isFinite(oldest) ? oldest + spec.spanMs : now,
    models: [...byModel.values()].sort((a, b) => b.billed - a.billed)
  }
}

/**
 * Read the plan's spend from disk.
 *
 * Overlapping calls share one pass. Without that, a refresh landing on top of
 * the first slow scan would parse the same bytes twice and double the totals,
 * because both would advance the same cursors.
 */
export function localUsage(limitOverrides?: Partial<Record<'session' | 'week', number>>): Promise<UsageReport> {
  if (running) return running
  running = (async () => {
    const started = Date.now()
    const { plan, tier } = readCredentials()
    const files = await transcripts()

    const seen = new Set<string>()
    // Existing events are already deduped; only re-check what is parsed now.
    for (const file of files) {
      try {
        await scanFile(file, seen)
      } catch {
        /* one unreadable transcript must not lose the rest of the report */
      }
    }

    const now = Date.now()
    const events: Event[] = []
    for (const [file, cursor] of cursors) {
      if (!files.includes(file)) continue
      for (const e of cursor.events) events.push(e)
    }
    events.sort((a, b) => a.t - b.t)

    const base = limitsFor(tier)
    return {
      source: 'local' as const,
      at: now,
      tookMs: now - started,
      plan,
      tier,
      messages: events.length,
      windows: WINDOWS.map((spec) =>
        summarise(events, spec, limitOverrides?.[spec.id] ?? base[spec.id], now)
      )
    }
  })().finally(() => {
    running = null
  })
  return running
}

/** Drop everything learned, so the next read starts from scratch. */
export function resetUsageCache(): void {
  cursors.clear()
}

/**
 * Ask Anthropic directly, using the credentials Claude Code already holds.
 *
 * This is the only way to the real percentages — the plan's ceiling is reported
 * at request time and is written down nowhere — and it is the reason this path
 * is off until it is switched on: it reads the OAuth token out of
 * `~/.claude/.credentials.json` and makes an authenticated request as you.
 *
 * The endpoint is not a documented one. It is what the CLI itself calls, so it
 * can change without notice; a failure here falls back to the local reading
 * rather than leaving the readout empty.
 */
export async function anthropicUsage(): Promise<UsageReport> {
  const started = Date.now()
  const fallback = async (error: string): Promise<UsageReport> => ({
    ...(await localUsage()),
    error
  })

  let token = ''
  let plan = ''
  let tier = ''
  try {
    const file = path.join(os.homedir(), '.claude', '.credentials.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      claudeAiOauth?: {
        accessToken?: string
        expiresAt?: number
        subscriptionType?: string
        rateLimitTier?: string
      }
    }
    const oauth = raw.claudeAiOauth
    token = oauth?.accessToken ?? ''
    plan = oauth?.subscriptionType ?? ''
    tier = oauth?.rateLimitTier ?? ''
    if (oauth?.expiresAt && oauth.expiresAt < Date.now()) {
      return fallback('That sign-in has expired. Open Claude Code once to refresh it.')
    }
  } catch {
    return fallback('No Claude credentials found on this machine.')
  }
  if (!token) return fallback('No Claude credentials found on this machine.')

  let body: Record<string, { utilization?: number; resets_at?: string }>
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        accept: 'application/json'
      }
    })
    if (!res.ok) return fallback(`Anthropic replied ${res.status}.`)
    body = (await res.json()) as typeof body
  } catch (err) {
    return fallback(`Could not reach Anthropic: ${err instanceof Error ? err.message : err}`)
  }

  const now = Date.now()
  const read = (key: string): { pct: number; resetsAt: number } | null => {
    const row = body[key]
    if (!row || typeof row.utilization !== 'number') return null
    const at = row.resets_at ? Date.parse(row.resets_at) : NaN
    return { pct: row.utilization, resetsAt: Number.isFinite(at) ? at : now }
  }

  const five = read('five_hour')
  const week = read('seven_day')
  if (!five && !week) return fallback('Anthropic returned no usage for this account.')

  // Per-model rows come back as their own seven-day windows.
  const perModel: ModelUse[] = []
  for (const [key, row] of Object.entries(body)) {
    const m = /^seven_day_([a-z0-9]+)$/.exec(key)
    if (!m || typeof row?.utilization !== 'number') continue
    perModel.push({
      model: m[1],
      label: m[1].charAt(0).toUpperCase() + m[1].slice(1),
      input: 0,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
      // Percent, not tokens: this source reports proportion and never counts.
      billed: row.utilization
    })
  }

  const windowFor = (spec: (typeof WINDOWS)[number], got: typeof five): UsageWindow => ({
    ...spec,
    used: got ? got.pct : 0,
    // 100 so `used` reads directly as the percentage it already is.
    limit: 100,
    pct: got ? Math.min(100, got.pct) : 0,
    resetsAt: got ? got.resetsAt : now,
    models: spec.id === 'week' ? perModel.sort((a, b) => b.billed - a.billed) : []
  })

  return {
    source: 'anthropic',
    at: now,
    tookMs: now - started,
    plan,
    tier,
    messages: 0,
    windows: [windowFor(WINDOWS[0], five), windowFor(WINDOWS[1], week)]
  }
}
