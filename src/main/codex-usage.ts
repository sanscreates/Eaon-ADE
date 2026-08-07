import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
 * What Codex has spent, read from the rollouts it writes itself.
 *
 * Same idea as the Claude reader next door: the transcripts on disk record
 * what each turn cost, so the token counts are measured rather than guessed.
 * What is not on disk is the plan's ceiling, so the percentage is against a
 * limit you can set and the honest number — tokens actually spent — leads.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNVERIFIED AGAINST A LIVE INSTALL. The Codex CLI is not present on the
 * machine this was written on, so the event shapes below come from Codex's
 * documented rollout format rather than from bytes anyone here has seen. The
 * parser is deliberately permissive for that reason: it accepts several
 * plausible spellings of the same field, ignores anything it does not
 * recognise, and returns zeroes rather than throwing when a rollout looks
 * nothing like what it expected. A wrong guess should read as "no usage
 * recorded", never as a wrong number presented confidently.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Longest window worth keeping events for. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000

/** Where the active Codex account keeps its rollouts. Null means ~/.codex. */
let homeDir: () => string | null = () => null

export function setCodexUsageHome(fn: () => string | null): void {
  homeDir = fn
}

function sessionsRoot(): string {
  return path.join(homeDir() ?? path.join(os.homedir(), '.codex'), 'sessions')
}

interface Spend {
  t: number
  model: string
  input: number
  cacheCreate: number
  cacheRead: number
  output: number
}

/** A number from any of several plausible keys, or 0. */
function pick(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return 0
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Pull a token count out of one rollout line.
 *
 * Codex reports usage as an event carrying totals for the session so far,
 * which is why the caller takes deltas rather than summing these directly —
 * adding up cumulative totals would multiply a long session by its own
 * length. Returns null for every line that is not a usage event, which is
 * almost all of them.
 */
export function spendOf(line: string, fallbackTime: number): Spend | null {
  let row: Record<string, unknown> | null
  try {
    row = asRecord(JSON.parse(line))
  } catch {
    return null
  }
  if (!row) return null

  // The usage object hides at a different depth depending on which spelling
  // of the event this is; the first one that has token-shaped numbers wins.
  const candidates: (Record<string, unknown> | null)[] = [
    asRecord(row.total_token_usage),
    asRecord(row.token_usage),
    asRecord(row.usage),
    asRecord(asRecord(row.info)?.total_token_usage),
    asRecord(asRecord(row.info)?.token_usage),
    asRecord(asRecord(row.payload)?.total_token_usage),
    asRecord(asRecord(row.payload)?.token_usage),
    asRecord(asRecord(row.payload)?.usage),
    asRecord(asRecord(asRecord(row.payload)?.info)?.total_token_usage)
  ]

  for (const usage of candidates) {
    if (!usage) continue
    const input = pick(usage, 'input_tokens', 'prompt_tokens', 'input')
    const output = pick(usage, 'output_tokens', 'completion_tokens', 'output')
    const cacheRead = pick(usage, 'cached_input_tokens', 'cache_read_input_tokens', 'cached_tokens')
    const cacheCreate = pick(usage, 'cache_creation_input_tokens', 'cache_write_tokens')
    if (input === 0 && output === 0 && cacheRead === 0 && cacheCreate === 0) continue

    const stamp =
      typeof row.timestamp === 'string'
        ? Date.parse(row.timestamp)
        : typeof row.ts === 'number'
          ? row.ts
          : NaN

    const model =
      (typeof row.model === 'string' && row.model) ||
      (typeof asRecord(row.payload)?.model === 'string' && (asRecord(row.payload)!.model as string)) ||
      'codex'

    return {
      t: Number.isFinite(stamp) ? stamp : fallbackTime,
      model,
      // Codex counts cached input separately from fresh input, and reports
      // fresh input already excluding it — so they are kept apart here the
      // same way the Claude reader keeps them apart.
      input,
      cacheCreate,
      cacheRead,
      output
    }
  }
  return null
}

async function rolloutFiles(): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4 || out.length > 500) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.name.endsWith('.jsonl')) out.push(full)
    }
  }
  await walk(sessionsRoot(), 0)
  return out
}

/**
 * Turn one rollout's cumulative totals into the amount it actually added.
 *
 * Each usage event restates the session's running total, so the spend of a
 * file is its last event minus nothing — but attributing all of it to the
 * last timestamp would put a week of work inside the five-hour window. The
 * deltas between consecutive events are used instead, each stamped when it
 * was reported.
 */
function deltas(events: Spend[]): Spend[] {
  const out: Spend[] = []
  let prev: Spend | null = null
  for (const e of events) {
    if (!prev) {
      out.push(e)
    } else {
      const d = {
        t: e.t,
        model: e.model,
        input: e.input - prev.input,
        cacheCreate: e.cacheCreate - prev.cacheCreate,
        cacheRead: e.cacheRead - prev.cacheRead,
        output: e.output - prev.output
      }
      // A total that went down means this is a different session sharing the
      // file, or a restart — take it at face value rather than as a negative.
      const wentBackwards =
        d.input < 0 || d.output < 0 || d.cacheCreate < 0 || d.cacheRead < 0
      out.push(wentBackwards ? e : d)
    }
    prev = e
  }
  return out.filter((d) => d.input || d.output || d.cacheCreate || d.cacheRead)
}

function summarise(
  events: Spend[],
  spec: (typeof WINDOWS)[number],
  limit: number,
  now: number
): UsageWindow {
  const since = now - spec.spanMs
  const inWindow = events.filter((e) => e.t >= since)

  const byModel = new Map<string, ModelUse>()
  let used = 0
  let oldest = Infinity
  for (const e of inWindow) {
    oldest = Math.min(oldest, e.t)
    const row = byModel.get(e.model) ?? {
      model: e.model,
      label: modelLabel(e.model),
      input: 0,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
      billed: 0
    }
    row.input += e.input
    row.cacheCreate += e.cacheCreate
    row.cacheRead += e.cacheRead
    row.output += e.output
    row.billed += billedOf(e)
    byModel.set(e.model, row)
    used += billedOf(e)
  }

  return {
    ...spec,
    used,
    limit,
    pct: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    resetsAt: Number.isFinite(oldest) ? oldest + spec.spanMs : now,
    models: [...byModel.values()].sort((a, b) => b.billed - a.billed)
  }
}

/** What Codex has spent, measured from its own rollouts. */
export async function codexUsage(
  limitOverrides?: Partial<Record<'session' | 'week', number>>
): Promise<UsageReport> {
  const started = Date.now()
  const files = await rolloutFiles()
  const all: Spend[] = []

  for (const file of files) {
    try {
      const stat = await fs.stat(file)
      // Nothing in this file can land inside even the longest window.
      if (stat.mtimeMs < started - KEEP_MS) continue
      const text = await fs.readFile(file, 'utf8')
      const found: Spend[] = []
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        const spend = spendOf(line, stat.mtimeMs)
        if (spend) found.push(spend)
      }
      all.push(...deltas(found))
    } catch {
      /* one unreadable rollout must not lose the rest of the report */
    }
  }

  const now = Date.now()
  const base = limitsFor('')
  return {
    source: 'local',
    at: now,
    tookMs: now - started,
    // Codex reports no plan or tier on disk that this reader trusts; the
    // account switcher is where that is shown, from auth.json.
    plan: '',
    tier: '',
    messages: all.length,
    windows: WINDOWS.map((spec) =>
      summarise(all, spec, limitOverrides?.[spec.id] ?? base[spec.id], now)
    )
  }
}
