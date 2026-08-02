import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { projectSlug } from './sessions'
import { EMPTY_STATS, WEEKS, languageName, type LanguageStat, type Stats, type StatsDay } from '../shared/stats'

/**
 * Where the numbers on the Stats surface come from.
 *
 * Sessions are counted from file metadata alone — 189 transcripts here run to
 * the better part of a gigabyte, and opening them to count messages would put a
 * second of disk read in front of a page you expect to appear at once. A
 * transcript's birth time is when you started working, which is the only thing
 * the grid actually needs.
 */

/** Local YYYY-MM-DD. Deliberately not toISOString, which would shift the day. */
function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * The days of the grid, oldest first, ending today and beginning on a Sunday so
 * the columns line up as whole weeks.
 */
function windowDays(): string[] {
  const today = startOfDay(new Date())
  const start = new Date(today)
  start.setDate(start.getDate() - (WEEKS * 7 - 1))
  // Back up to Sunday so every column is a full week.
  start.setDate(start.getDate() - start.getDay())

  const out: string[] = []
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    out.push(dayKey(d.getTime()))
  }
  return out
}

/** Project directories whose sessions belong to this folder, or all of them. */
async function projectDirs(root: string, folder: string | null): Promise<string[]> {
  let all: string[]
  try {
    all = await fs.readdir(root)
  } catch {
    return []
  }
  if (!folder) return all
  // A descendant folder slugifies to the parent's slug plus a separator, so the
  // prefix test finds nested checkouts too. Over-matching is possible because
  // slugs are lossy, and is preferable to missing a folder's own history.
  const slug = projectSlug(folder)
  return all.filter((d) => d === slug || d.startsWith(`${slug}-`))
}

interface SessionPoint {
  day: string
  hour: number
}

async function collectSessions(folder: string | null): Promise<SessionPoint[]> {
  const root = path.join(os.homedir(), '.claude', 'projects')
  const dirs = await projectDirs(root, folder)
  const out: SessionPoint[] = []

  for (const dir of dirs) {
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
        // birthtime is when the session began; some filesystems do not record
        // it and report 0, in which case the last write is the better guess.
        const started = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs
        out.push({ day: dayKey(started), hour: new Date(started).getHours() })
      } catch {
        /* unreadable transcript */
      }
    }
  }
  return out
}

/**
 * Files whose lines nobody wrote.
 *
 * A lockfile refresh is ten thousand lines that took one command, and counting
 * it would make the headline number meaningless — a quiet week of dependency
 * bumps would outrank a month of real work. Build output is excluded for the
 * same reason. The surface says so, rather than quietly reporting a number that
 * does not mean what it appears to.
 */
function isGenerated(file: string): boolean {
  return (
    /(^|\/)(node_modules|dist|out|build|vendor|\.next|coverage)\//.test(file) ||
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock)$/.test(
      file
    ) ||
    /\.(min\.js|min\.css|map|lock)$/.test(file)
  )
}

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : stdout)
    })
  })
}

interface GitTotals {
  byDay: Map<string, { commits: number; added: number; removed: number }>
  languages: Map<string, LanguageStat>
  files: Set<string>
  commits: number
  added: number
  removed: number
}

/**
 * Commits and line counts, by day.
 *
 * Merges are excluded: a merge commit reports the whole of the branch it brings
 * in, which would count the same lines twice and flatter the totals.
 */
async function collectGit(folder: string, since: string): Promise<GitTotals | null> {
  const inside = (await run('git', ['rev-parse', '--is-inside-work-tree'], folder)).trim()
  if (inside !== 'true') return null

  const log = await run(
    'git',
    ['log', '--no-merges', `--since=${since}`, '--date=short', '--format=%x01%ad', '--numstat'],
    folder
  )

  const totals: GitTotals = {
    byDay: new Map(),
    languages: new Map(),
    files: new Set(),
    commits: 0,
    added: 0,
    removed: 0
  }

  let day = ''
  for (const line of log.split('\n')) {
    if (line.startsWith('\x01')) {
      day = line.slice(1).trim()
      if (!day) continue
      totals.commits += 1
      const cell = totals.byDay.get(day) ?? { commits: 0, added: 0, removed: 0 }
      cell.commits += 1
      totals.byDay.set(day, cell)
      continue
    }
    if (!line.trim() || !day) continue

    // added \t removed \t path — binary files report a dash for both.
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const added = Number(parts[0])
    const removed = Number(parts[1])
    if (!Number.isFinite(added) || !Number.isFinite(removed)) continue
    const file = parts.slice(2).join('\t')
    if (isGenerated(file)) continue

    const cell = totals.byDay.get(day) ?? { commits: 0, added: 0, removed: 0 }
    cell.added += added
    cell.removed += removed
    totals.byDay.set(day, cell)

    totals.added += added
    totals.removed += removed
    totals.files.add(file)

    // Grouped by language, not by extension: .ts and .tsx are one language, and
    // listing "TypeScript" twice would look like a bug.
    const ext = path.extname(file).replace(/^\./, '').toLowerCase()
    const label = languageName(ext || 'other')
    const lang = totals.languages.get(label) ?? {
      ext: ext || 'other',
      label,
      added: 0,
      removed: 0,
      files: 0
    }
    lang.added += added
    lang.removed += removed
    lang.files += 1
    totals.languages.set(label, lang)
  }

  return totals
}

/** Longest and current runs of consecutive active days, oldest first. */
function streaks(days: StatsDay[]): { current: number; longest: number } {
  const active = (d: StatsDay): boolean => d.sessions > 0 || d.commits > 0

  let longest = 0
  let run = 0
  for (const d of days) {
    run = active(d) ? run + 1 : 0
    if (run > longest) longest = run
  }

  // Counted backwards from the end. A streak still counts if today is quiet but
  // yesterday was not — the day is not over yet, and breaking someone's streak
  // at midnight for a day they are still in the middle of would be wrong.
  let current = 0
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (active(days[i])) current += 1
    else if (i === days.length - 1) continue
    else break
  }

  return { current, longest }
}

/**
 * @param folder the workspace to describe, or null to count every folder. Code
 * stats need a repository, so they are only ever present for a folder.
 */
export async function collectStats(folder: string | null): Promise<Stats> {
  const keys = windowDays()
  if (!keys.length) return { ...EMPTY_STATS }

  const index = new Map<string, StatsDay>()
  const days: StatsDay[] = keys.map((date) => {
    const cell: StatsDay = { date, sessions: 0, commits: 0, added: 0, removed: 0 }
    index.set(date, cell)
    return cell
  })

  const byHour = new Array(24).fill(0)
  const sessions = await collectSessions(folder)
  let totalSessions = 0
  for (const s of sessions) {
    const cell = index.get(s.day)
    if (!cell) continue // older than the window
    cell.sessions += 1
    byHour[s.hour] += 1
    totalSessions += 1
  }

  const git = folder ? await collectGit(folder, keys[0]) : null
  if (git) {
    for (const [date, cell] of git.byDay) {
      const target = index.get(date)
      if (!target) continue
      target.commits += cell.commits
      target.added += cell.added
      target.removed += cell.removed
    }
  }

  const { current, longest } = streaks(days)
  const busiest = days.reduce<StatsDay | null>((best, d) => {
    const score = d.sessions + d.commits
    const bestScore = best ? best.sessions + best.commits : 0
    return score > bestScore ? d : best
  }, null)

  return {
    days,
    currentStreak: current,
    longestStreak: longest,
    activeDays: days.filter((d) => d.sessions > 0 || d.commits > 0).length,
    totalSessions,
    totalCommits: git?.commits ?? 0,
    linesAdded: git?.added ?? 0,
    linesRemoved: git?.removed ?? 0,
    filesTouched: git?.files.size ?? 0,
    byHour,
    languages: [...(git?.languages.values() ?? [])]
      // By lines written, which is what the surface shows beside each one.
      .sort((a, b) => b.added - a.added)
      .slice(0, 8),
    busiest: busiest && busiest.sessions + busiest.commits > 0 ? busiest : null,
    hasRepo: Boolean(git),
    folder: folder ?? '',
    from: keys[0],
    to: keys[keys.length - 1]
  }
}
