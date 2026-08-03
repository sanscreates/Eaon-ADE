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
  /**
   * The request this line belongs to.
   *
   * Claude Code writes one assistant message as several lines — four out of
   * five here — each repeating the same cumulative usage. The id is what tells
   * them apart from genuinely separate requests, and counting by line instead
   * inflates the total by about 62%.
   */
  rid: string
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
async function scanFile(file: string): Promise<void> {
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
        uuid?: string
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

      const u = row.message.usage
      cursor.events.push({
        // Without a request id there is nothing to group by, so the line's own
        // uuid stands in and it is counted once, on its own.
        rid: row.requestId || row.uuid || `${t}:${row.message.model}`,
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
  /*
   * A block window opens on the first message after a gap as long as the window
   * itself, and closes five hours later — which is how the limit it stands for
   * actually behaves. Measuring it as a rolling five hours instead made the
   * countdown mean "when the oldest thing drops off", a number that slides
   * forward every time you speak and never matches what the agent tells you.
   */
  let from = now - spec.spanMs
  let opensAt = 0
  if (spec.kind === 'block') {
    /*
     * Blocks tile forward rather than there being only one.
     *
     * Work through a long day and the first block closes while you are still
     * going; the next message opens the next one. Looking only for a gap as
     * long as the window found a single start hours back, called it expired,
     * and reported nothing used at all — during a session that was plainly
     * spending. Opening a new block whenever a message falls outside the
     * current one covers both cases: a long pause and a long stretch.
     */
    let start = 0
    for (const e of events) {
      if (!start || e.t - start >= spec.spanMs) start = e.t
    }
    // A block that has already run its course counts nothing.
    opensAt = start && now - start < spec.spanMs ? start : 0
    from = opensAt || now + 1
  }

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
    /*
     * A block closes at a knowable moment. A rolling window has none, so it
     * reports when its oldest activity ages out and the interface says
     * "rolling" rather than dressing that up as a reset.
     */
    resetsAt:
      spec.kind === 'block'
        ? opensAt
          ? opensAt + spec.spanMs
          : 0
        : Number.isFinite(oldest)
          ? oldest + spec.spanMs
          : now,
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

    for (const file of files) {
      try {
        await scanFile(file)
      } catch {
        /* one unreadable transcript must not lose the rest of the report */
      }
    }

    const now = Date.now()
    const cutoff = now - KEEP_MS

    /*
     * Deduplicated here rather than as each line is read.
     *
     * Doing it at parse time needs a set of everything seen so far, and an
     * incremental scan only reads what is new — so the sibling lines of one
     * message, arriving after the last look, had nothing to be recognised
     * against and were counted a second time. The total then crept upwards for
     * as long as the app stayed open and snapped back on restart. Deciding it
     * here, with every event in hand, does not care which pass read what. It
     * also catches one request appearing in two transcripts, which is what a
     * resumed or forked session produces.
     */
    const counted = new Set<string>()
    const events: Event[] = []
    for (const [file, cursor] of cursors) {
      if (!files.includes(file)) continue
      // Older than the longest window and it can never be counted again.
      if (cursor.events.length && cursor.events[0].t < cutoff) {
        cursor.events = cursor.events.filter((e) => e.t >= cutoff)
      }
      for (const e of cursor.events) {
        if (counted.has(e.rid)) continue
        counted.add(e.rid)
        events.push(e)
      }
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
