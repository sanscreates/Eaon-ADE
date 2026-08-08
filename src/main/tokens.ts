import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { projectDirsFor, projectsRoot } from './sessions'
import {
  EMPTY_TOKEN_STATS,
  costOf,
  tokenModelLabel,
  type ModelTokens,
  type TokenDay,
  type TokenStats
} from '../shared/stats'

/**
 * What the agents actually spent, read off the transcripts.
 *
 * The rest of the Stats surface deliberately never opens a transcript — it
 * reads file metadata, because there is nearly a gigabyte of them here and a
 * page you expect to appear at once cannot afford to read it. Tokens are the
 * one thing metadata cannot answer, so this does open them, and it was measured
 * before it was written: 0.94 GB across 94 files reads in 1.8 seconds, about
 * 535 MB/s, because a line is only parsed as JSON once a substring check says
 * it might carry usage. Most of a transcript is user turns and tool output.
 *
 * Answers are cached for the life of the app anyway, so the wait happens at
 * most once and only for somebody who opened the page.
 */

/** One assistant message is written as several lines, each repeating the same
 * cumulative usage — half of every transcript here. They arrive together, so
 * the previous request id is enough to tell a repeat from a new request, and
 * counting by line instead would roughly double the total. */
interface Totals {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  requests: number
}

const empty = (): Totals => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, requests: 0 })

function add(into: Totals, u: Record<string, number>): void {
  into.input += u.input_tokens ?? 0
  into.output += u.output_tokens ?? 0
  into.cacheWrite += u.cache_creation_input_tokens ?? 0
  into.cacheRead += u.cache_read_input_tokens ?? 0
  into.requests += 1
}

/** Local YYYY-MM-DD, matching the rest of the surface. */
function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface Scan {
  byDay: Map<string, Totals>
  byModel: Map<string, Totals>
}

/**
 * Cached per folder for the life of the app.
 *
 * Keyed by the folder asked about — the surface can be narrowed to one project
 * or opened on everything, and those are different answers.
 */
const cache = new Map<string, { at: number; stats: TokenStats }>()

/** Long enough that flipping between scopes is instant, short enough to notice
 * work done since the page was last opened. */
const FRESH_MS = 60_000

export function resetTokenCache(): void {
  cache.clear()
}

async function scanFile(file: string, into: Scan): Promise<void> {
  const stream = fs.createReadStream(file, { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let lastRid: string | null = null
  try {
    for await (const line of lines) {
      // Cheaper than JSON.parse by a wide margin, and most lines fail it.
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
        // A half-written last line on a live session. The next read gets it.
        continue
      }
      if (row.type !== 'assistant' || !row.message?.usage || !row.timestamp) continue

      const rid = row.requestId || row.uuid || null
      if (rid && rid === lastRid) continue
      lastRid = rid

      const at = Date.parse(row.timestamp)
      if (!Number.isFinite(at)) continue

      const day = dayKey(at)
      let dayTotals = into.byDay.get(day)
      if (!dayTotals) into.byDay.set(day, (dayTotals = empty()))
      add(dayTotals, row.message.usage)

      const model = row.message.model ?? 'unknown'
      let modelTotals = into.byModel.get(model)
      if (!modelTotals) into.byModel.set(model, (modelTotals = empty()))
      add(modelTotals, row.message.usage)
    }
  } finally {
    lines.close()
    stream.close()
  }
}

/** Project directories whose transcripts belong to this folder, or all of them. */
async function dirsFor(root: string, folder: string | null): Promise<string[]> {
  if (folder) return projectDirsFor(folder)
  try {
    return await fsp.readdir(root)
  } catch {
    return []
  }
}

/**
 * Token totals over the given days, oldest first.
 *
 * `days` comes from the caller so the strip lines up with the rest of the
 * surface rather than choosing its own window.
 */
export async function collectTokens(folder: string | null, days: string[]): Promise<TokenStats> {
  const key = folder ?? ''
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.stats

  const root = projectsRoot()
  const scan: Scan = { byDay: new Map(), byModel: new Map() }
  for (const dir of await dirsFor(root, folder)) {
    let entries: string[]
    try {
      entries = await fsp.readdir(path.join(root, dir))
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue
      try {
        await scanFile(path.join(root, dir, entry), scan)
      } catch {
        /* an unreadable transcript is not worth failing the page over */
      }
    }
  }

  const totals = empty()
  for (const t of scan.byDay.values()) {
    totals.input += t.input
    totals.output += t.output
    totals.cacheWrite += t.cacheWrite
    totals.cacheRead += t.cacheRead
    totals.requests += t.requests
  }

  const series: TokenDay[] = days.map((date) => {
    const t = scan.byDay.get(date) ?? empty()
    return {
      date,
      input: t.input,
      output: t.output,
      cacheWrite: t.cacheWrite,
      cacheRead: t.cacheRead,
      total: t.input + t.output + t.cacheWrite + t.cacheRead
    }
  })

  const models: ModelTokens[] = [...scan.byModel.entries()]
    // Claude Code records a synthetic model for messages it wrote itself, and
    // those never cost anything.
    .filter(([model, t]) => model !== '<synthetic>' && t.requests > 0)
    .map(([model, t]) => ({
      model,
      label: tokenModelLabel(model),
      input: t.input,
      output: t.output,
      cacheWrite: t.cacheWrite,
      cacheRead: t.cacheRead,
      total: t.input + t.output + t.cacheWrite + t.cacheRead,
      requests: t.requests,
      cost: costOf(model, t)
    }))
    .sort((a, b) => b.total - a.total)

  const best = series.reduce<TokenDay | null>(
    (top, d) => (d.total > (top?.total ?? 0) ? d : top),
    null
  )

  // Everything that went in, of which cache reads are the cheap part.
  const wentIn = totals.input + totals.cacheWrite + totals.cacheRead

  const stats: TokenStats = {
    ...EMPTY_TOKEN_STATS,
    input: totals.input,
    output: totals.output,
    cacheWrite: totals.cacheWrite,
    cacheRead: totals.cacheRead,
    total: totals.input + totals.output + totals.cacheWrite + totals.cacheRead,
    requests: totals.requests,
    cost: models.reduce((sum, m) => sum + m.cost, 0),
    // Counted over everything on disk, not just the window on screen: it says
    // how many days this machine has had agents working, and truncating that
    // to the strip would quietly rename it.
    activeDays: [...scan.byDay.values()].filter((t) => t.requests > 0).length,
    cacheShare: wentIn > 0 ? (totals.cacheRead / wentIn) * 100 : 0,
    days: series,
    best: best && best.total > 0 ? best : null,
    models
  }

  cache.set(key, { at: Date.now(), stats })
  return stats
}
