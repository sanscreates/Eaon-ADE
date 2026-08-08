/**
 * What the Stats surface shows.
 *
 * Two independent sources, deliberately kept apart rather than blended into one
 * number: the agent transcripts on disk say when you were *working*, and git
 * says what came *out* of it. A day spent reading and deciding is a real day
 * even though it produced no diff, and a heatmap that only counted commits
 * would call it empty.
 */

/** One square in the contribution grid. Dates are local, not UTC. */
export interface StatsDay {
  /** YYYY-MM-DD, local time. */
  date: string
  sessions: number
  commits: number
  added: number
  removed: number
}

export interface LanguageStat {
  /** File extension, lowercase, without the dot. `other` for anything unusual. */
  ext: string
  label: string
  added: number
  removed: number
  files: number
}

/** One day's token activity, for the intensity strip. */
export interface TokenDay {
  date: string
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  total: number
}

export interface ModelTokens {
  model: string
  label: string
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  total: number
  requests: number
  /** List-price estimate in USD. See PRICES. */
  cost: number
}

export interface TokenStats {
  total: number
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  requests: number
  /** List-price estimate in USD across every model. See PRICES. */
  cost: number
  /** Days with any agent activity at all, over everything on disk. */
  activeDays: number
  /** Share of everything sent in that came from the cache, 0-100. */
  cacheShare: number
  /** Per day over the window on screen, oldest first. */
  days: TokenDay[]
  best: TokenDay | null
  models: ModelTokens[]
}

export const EMPTY_TOKEN_STATS: TokenStats = {
  total: 0,
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  requests: 0,
  cost: 0,
  activeDays: 0,
  cacheShare: 0,
  days: [],
  best: null,
  models: []
}

/**
 * What a million tokens costs, per model family, in US dollars.
 *
 * Published API list prices, which is the only rate anyone can quote: a
 * subscription does not bill per token at all, so for anyone on Pro or Max
 * this is not a bill and never will be. It answers a different question —
 * what this work would have cost through the API — and the surface says so
 * rather than printing a dollar sign and leaving you to assume.
 *
 * Rates move. When they do, this table is the only thing to change.
 */
export const PRICES: Record<string, { input: number; output: number; write: number; read: number }> = {
  opus: { input: 15, output: 75, write: 18.75, read: 1.5 },
  sonnet: { input: 3, output: 15, write: 3.75, read: 0.3 },
  haiku: { input: 0.8, output: 4, write: 1, read: 0.08 }
}

/** Anything unrecognised is priced as Sonnet, the middle of the range. */
function priceFor(model: string): (typeof PRICES)[string] {
  const m = model.toLowerCase()
  for (const family of Object.keys(PRICES)) {
    if (m.includes(family)) return PRICES[family]
  }
  return PRICES.sonnet
}

export function costOf(
  model: string,
  t: { input: number; output: number; cacheWrite: number; cacheRead: number }
): number {
  const p = priceFor(model)
  return (
    (t.input * p.input + t.output * p.output + t.cacheWrite * p.write + t.cacheRead * p.read) / 1e6
  )
}

/** "claude-opus-4-5-20251101" reads as "Opus 4.5" beside five others. */
export function tokenModelLabel(model: string): string {
  if (!model) return 'Unknown'
  const bare = model.replace(/^claude[-_]/, '').replace(/-\d{8}$/, '')
  const [family, ...rest] = bare.split('-')
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  const version = rest.join('.').replace(/\.$/, '')
  return version ? `${name} ${version}` : name
}

export interface Stats {
  days: StatsDay[]
  /** Consecutive active days ending today or yesterday. */
  currentStreak: number
  longestStreak: number
  /** Days with any activity at all, within the window. */
  activeDays: number
  totalSessions: number
  totalCommits: number
  linesAdded: number
  linesRemoved: number
  filesTouched: number
  /** Sessions started in each hour, 0–23, local time. */
  byHour: number[]
  languages: LanguageStat[]
  busiest: StatsDay | null
  /** False when the folder is not a git repository, so code stats are absent. */
  hasRepo: boolean
  /** The folder these stats describe, or '' when counting every folder. */
  folder: string
  /** How far back the window reaches, YYYY-MM-DD. */
  from: string
  to: string
  /** What the agents spent, read from the transcripts themselves. */
  tokens: TokenStats
}

export const EMPTY_STATS: Stats = {
  days: [],
  currentStreak: 0,
  longestStreak: 0,
  activeDays: 0,
  totalSessions: 0,
  totalCommits: 0,
  linesAdded: 0,
  linesRemoved: 0,
  filesTouched: 0,
  byHour: new Array(24).fill(0),
  languages: [],
  busiest: null,
  hasRepo: false,
  folder: '',
  from: '',
  to: '',
  tokens: EMPTY_TOKEN_STATS
}

/** Weeks shown in the contribution grid, matching the usual year-at-a-glance. */
export const WEEKS = 53

const LANGUAGE_NAMES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  css: 'CSS',
  scss: 'CSS',
  html: 'HTML',
  json: 'JSON',
  md: 'Markdown',
  yml: 'YAML',
  yaml: 'YAML',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  rb: 'Ruby',
  swift: 'Swift',
  java: 'Java',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  sh: 'Shell',
  zsh: 'Shell',
  sql: 'SQL',
  toml: 'TOML',
  plist: 'Property list'
}

export function languageName(ext: string): string {
  if (LANGUAGE_NAMES[ext]) return LANGUAGE_NAMES[ext]
  if (!ext || ext === 'other') return 'Other'
  // An unknown extension is shown as-is rather than shouted at.
  return `.${ext}`
}
