/**
 * How much of the plan has been spent, and how much is left.
 *
 * Two ways of knowing that, and they are not equally good.
 *
 * The default reads the transcripts Claude Code already writes to disk. Every
 * assistant message records exactly what it cost, so the token counts are real
 * — not sampled, not estimated. What is *not* on disk anywhere is the plan's
 * ceiling: Anthropic reports that at request time and nothing caches it. So the
 * percentage here is measured against a limit you can set, and the honest
 * number — tokens actually spent, and when the window rolls — is the one shown
 * first.
 *
 * The other way asks Anthropic directly, which gives the true percentage but
 * means holding the user's credentials. It stays switched off until asked for.
 */

export type UsageSource = 'local' | 'anthropic'

/** Rolling windows a subscription is measured over. */
export type WindowId = 'session' | 'week'

export interface ModelUse {
  /** Raw id out of the transcript, e.g. "claude-opus-5". */
  model: string
  label: string
  input: number
  cacheCreate: number
  cacheRead: number
  output: number
  /** The figure the window's total is built from. See BILLED_NOTE. */
  billed: number
}

export interface UsageWindow {
  id: WindowId
  label: string
  /** Two or three characters, for the pill. */
  short: string
  spanMs: number
  used: number
  limit: number
  /** 0–100, clamped. */
  pct: number
  /** When the oldest counted activity falls out of the window. */
  resetsAt: number
  models: ModelUse[]
}

export interface UsageReport {
  source: UsageSource
  /** When this was measured. */
  at: number
  /** How long the read took, so a slow scan is visible rather than mysterious. */
  tookMs: number
  plan: string
  tier: string
  windows: UsageWindow[]
  /** Messages counted, for the detail view. */
  messages: number
  error?: string
}

export const WINDOWS: { id: WindowId; label: string; short: string; spanMs: number }[] = [
  { id: 'session', label: 'Session', short: '5h', spanMs: 5 * 60 * 60 * 1000 },
  { id: 'week', label: 'Week', short: 'wk', spanMs: 7 * 24 * 60 * 60 * 1000 }
]

/**
 * Why cache reads are left out of the total.
 *
 * A single message here read 785,779 cached tokens against 2,255 written. Cache
 * reads are an order of magnitude cheaper than fresh input and counting them
 * would drown everything else — the number would move with how long the
 * conversation is rather than with how much work was asked for.
 */
export const BILLED_NOTE = 'Input + cache writes + output. Cache reads are counted separately.'

export function billedOf(u: {
  input: number
  cacheCreate: number
  output: number
}): number {
  return u.input + u.cacheCreate + u.output
}

/**
 * Starting limits per plan, in billed tokens per window.
 *
 * Anthropic publishes subscription limits in prompts rather than tokens, and
 * the real ceiling moves with demand, so these are a starting point rather than
 * a fact — which is why they are a setting. Anything unrecognised falls back to
 * the Max 5x row.
 */
export const TIER_LIMITS: Record<string, Record<WindowId, number>> = {
  default_claude_free: { session: 200_000, week: 1_000_000 },
  default_claude_pro: { session: 2_000_000, week: 20_000_000 },
  default_claude_max_5x: { session: 10_000_000, week: 100_000_000 },
  default_claude_max_20x: { session: 40_000_000, week: 400_000_000 }
}

export function limitsFor(tier: string): Record<WindowId, number> {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.default_claude_max_5x
}

/** "claude-opus-5" reads as "Opus 5" once it is on screen next to five others. */
export function modelLabel(model: string): string {
  if (!model) return 'Unknown'
  const bare = model.replace(/^claude[-_]/, '').replace(/-\d{8}$/, '')
  const [family, ...rest] = bare.split('-')
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  const version = rest.join('.').replace(/\.$/, '')
  return version ? `${name} ${version}` : name
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

/** "2h 34m", the way a countdown reads. Empty once it has passed. */
export function formatUntil(at: number, now = Date.now()): string {
  const ms = at - now
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rest = mins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rest}m`
  return `${rest}m`
}

export const EMPTY_REPORT: UsageReport = {
  source: 'local',
  at: 0,
  tookMs: 0,
  plan: '',
  tier: '',
  messages: 0,
  windows: WINDOWS.map((w) => ({
    ...w,
    used: 0,
    limit: limitsFor('')[w.id],
    pct: 0,
    resetsAt: 0,
    models: []
  }))
}
