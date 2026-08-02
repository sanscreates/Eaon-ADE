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
  to: ''
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
