/**
 * Signing in to more than one Claude account, and choosing which one works.
 *
 * Claude Code keeps everything about an account — credentials, transcripts,
 * settings — under one configuration directory, and honours `CLAUDE_CONFIG_DIR`
 * when deciding where that is. Measured: pointed at an empty directory it
 * reports "Not logged in · Please run /login" and builds its own `.claude.json`,
 * `projects/` and `sessions/` inside it.
 *
 * That is the whole mechanism. An account here is a directory, switching is
 * choosing which one the shells are given, and the sign-in is Claude Code's
 * own — this app never implements the OAuth exchange and never writes anybody's
 * tokens. The account you already had stays exactly where it is, in `~/.claude`,
 * untouched, which is why a switch cannot sign you out of it.
 */

/** The account that was already on this machine before any of this existed. */
export const DEFAULT_ACCOUNT_ID = 'default'

/**
 * Which agent an account belongs to.
 *
 * Claude Code and Codex work the same way — a configuration directory, chosen
 * by an environment variable — so they share this whole mechanism. What they
 * do not share is where that directory lives, what the variable is called, or
 * what is written inside it, which is all that `VendorSpec` in
 * `src/main/accounts.ts` carries.
 */
export type AgentVendor = 'claude' | 'codex'

export const VENDOR_LABEL: Record<AgentVendor, string> = {
  claude: 'Claude',
  codex: 'Codex'
}

export interface Account {
  vendor: AgentVendor
  id: string
  /** Where Claude Code keeps this account. `~/.claude` for the original one. */
  configDir: string
  /** Whatever the account calls itself, falling back to the plan. */
  label: string
  email: string | null
  /** The organisation, when the account belongs to one. */
  org: string | null
  /** "max", "pro" — as the credentials record it. Empty until signed in. */
  plan: string
  /** Rate limit tier, which is what the usage limits are read from. */
  tier: string
  /** False for a directory whose sign-in never completed. */
  signedIn: boolean
  /** The one new shells are given. */
  active: boolean
  /**
   * True only for `~/.claude`. It is listed like any other account but never
   * written to and never removed: it is the account every other tool on the
   * machine is already using.
   */
  isDefault: boolean
  addedAt: number
}

/** How far along a sign-in is, for the dialog to follow. */
export type LoginPhase =
  | 'starting'
  | 'opening'
  /** Waiting for the code the browser shows after you approve. */
  | 'code'
  | 'finishing'
  | 'done'
  | 'error'

export interface LoginState {
  phase: LoginPhase
  /** The address opened in the browser, kept so it can be opened again. */
  url: string | null
  error: string | null
  /**
   * The last thing Claude Code printed, shown only when the flow is not
   * recognised. A sign-in nobody can see is worse than an ugly one.
   */
  output: string | null
}

export const IDLE_LOGIN: LoginState = {
  phase: 'starting',
  url: null,
  error: null,
  output: null
}

/** "max" reads as "Max" beside an email address. */
export function planLabel(plan: string): string {
  if (!plan) return 'Not signed in'
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}
