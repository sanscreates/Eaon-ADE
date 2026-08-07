import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_ACCOUNT_ID, type Account, type AgentVendor } from '../shared/accounts'

/**
 * The Claude accounts this machine knows about.
 *
 * Each one is a Claude Code configuration directory. The original lives at
 * `~/.claude` and is only ever read; the ones added here live under the app's
 * own data directory, so nothing this feature does can disturb the account you
 * were already using.
 *
 * Reading is deliberately shallow: the plan and the tier, and an email address
 * if the account happens to record one. The tokens sitting beside them are not
 * read, not copied and not written. Switching accounts is done by handing a
 * shell a different `CLAUDE_CONFIG_DIR`, never by moving credentials around.
 */

interface Index {
  activeId: string
  added: { id: string; addedAt: number }[]
}

function homeConfigDir(): string {
  return path.join(os.homedir(), '.claude')
}

/** Reads the parts of a config directory worth showing. Never the tokens. */
function describe(configDir: string): {
  plan: string
  tier: string
  email: string | null
  name: string | null
  org: string | null
} {
  let plan = ''
  let tier = ''
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf8')
    ) as { claudeAiOauth?: { subscriptionType?: string; rateLimitTier?: string } }
    plan = raw.claudeAiOauth?.subscriptionType ?? ''
    tier = raw.claudeAiOauth?.rateLimitTier ?? ''
  } catch {
    /* not signed in yet, or a directory we cannot read */
  }

  /*
   * Who the account belongs to, which is not kept in the same place twice.
   *
   * An account given its own directory keeps `.claude.json` inside it. The
   * original keeps its config beside the directory rather than in it —
   * `~/.claude.json`, next to `~/.claude` — so looking only inside is how every
   * account ends up named after its plan and two of them become
   * indistinguishable. Both places are tried, nearest first.
   */
  let email: string | null = null
  let name: string | null = null
  let org: string | null = null
  for (const file of [
    path.join(configDir, '.claude.json'),
    path.join(path.dirname(configDir), '.claude.json')
  ]) {
    try {
      const conf = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        oauthAccount?: {
          emailAddress?: string
          email?: string
          displayName?: string
          organizationName?: string
        }
      }
      const acct = conf.oauthAccount
      if (!acct) continue
      email = acct.emailAddress ?? acct.email ?? null
      name = acct.displayName ?? null
      org = acct.organizationName ?? null
      if (email || name) break
    } catch {
      /* not there, or not ours to read */
    }
  }

  return { plan, tier, email, name, org }
}

/* ------------------------------------------------------------------------ *
 * Codex
 * ------------------------------------------------------------------------ */

/**
 * What the Codex CLI keeps, and what is safe to look at.
 *
 * Codex stores its configuration under `~/.codex` and honours `CODEX_HOME`
 * when told to look elsewhere — the same shape as Claude Code's
 * `CLAUDE_CONFIG_DIR`, which is why both share the class below.
 *
 * `auth.json` holds an id token whose *payload* names the account and its
 * plan. That payload is read for the label and nothing else: the token string
 * is never copied, never written, never sent anywhere, and the signature is
 * neither read nor verified — this is the same line the Claude reader draws
 * when it takes `subscriptionType` out of `.credentials.json` and leaves the
 * credentials themselves alone.
 *
 * NOTE: unverified against a live install. The Codex CLI is not present on
 * the machine this was written on, and the `~/.codex` that *is* there belongs
 * to ChatGPT Desktop, not the CLI. Everything here is written against Codex's
 * documented layout and degrades to "not signed in" when the files are shaped
 * differently — which is exactly what that ChatGPT Desktop directory does.
 */
function codexHomeDir(): string {
  return path.join(os.homedir(), '.codex')
}

/** The middle segment of a JWT, decoded. Never the signature. */
function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const middle = token.split('.')[1]
    if (!middle) return null
    const json = Buffer.from(middle.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function describeCodex(configDir: string): {
  plan: string
  tier: string
  email: string | null
  name: string | null
  org: string | null
} {
  const empty = { plan: '', tier: '', email: null, name: null, org: null }
  let raw: {
    tokens?: { id_token?: string; account_id?: string }
    OPENAI_API_KEY?: string | null
  }
  try {
    raw = JSON.parse(fs.readFileSync(path.join(configDir, 'auth.json'), 'utf8'))
  } catch {
    // No auth.json at all — including the ChatGPT Desktop directory, which is
    // why that one correctly reads as an empty, not-signed-in row.
    return empty
  }

  // An API-key sign-in has no token to describe, so it is reported as signed
  // in and otherwise anonymous. The key itself is not read — only whether the
  // field is populated.
  if (!raw.tokens?.id_token) {
    return raw.OPENAI_API_KEY ? { ...empty, plan: 'api' } : empty
  }

  const claims = jwtPayload(raw.tokens.id_token) ?? {}
  const authClaim =
    (claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined) ?? {}
  const plan = String(authClaim.chatgpt_plan_type ?? '')
  const email = typeof claims.email === 'string' ? claims.email : null

  return {
    plan,
    // Codex has no separate rate-limit tier of its own; the plan is the tier.
    tier: plan,
    email,
    name: typeof claims.name === 'string' ? claims.name : null,
    org: null
  }
}

/* ------------------------------------------------------------------------ *
 * The shared mechanism
 * ------------------------------------------------------------------------ */

type Described = ReturnType<typeof describe>

/**
 * Everything that differs between one agent's accounts and another's.
 *
 * Deliberately small: if this grows past "where, what it is called, and how
 * to read it", the two are not really the same mechanism and should stop
 * pretending to be.
 */
export interface VendorSpec {
  vendor: AgentVendor
  /** The directory the agent uses when nothing overrides it. Never written to. */
  homeDir: () => string
  /** The environment variable that points a shell at a different one. */
  envVar: string
  describe: (configDir: string) => Described
  /** Where this vendor's index and added accounts live under userData. */
  indexFile: string
  rootDir: string
  /** Shown when an account records no name of its own. */
  fallbackLabel: string
}

export const CLAUDE_SPEC: VendorSpec = {
  vendor: 'claude',
  homeDir: homeConfigDir,
  envVar: 'CLAUDE_CONFIG_DIR',
  describe,
  indexFile: 'accounts.json',
  rootDir: 'accounts',
  fallbackLabel: 'Claude account'
}

export const CODEX_SPEC: VendorSpec = {
  vendor: 'codex',
  homeDir: codexHomeDir,
  envVar: 'CODEX_HOME',
  describe: describeCodex,
  indexFile: 'codex-accounts.json',
  rootDir: 'codex-accounts',
  fallbackLabel: 'Codex account'
}

export class Accounts {
  private index: Index = { activeId: DEFAULT_ACCOUNT_ID, added: [] }
  private readonly file: string
  private readonly root: string

  private readonly spec: VendorSpec

  // Defaults to Claude so every existing call site keeps working untouched.
  constructor(dir?: string, spec: VendorSpec = CLAUDE_SPEC) {
    this.spec = spec
    const base = dir ?? app.getPath('userData')
    this.file = path.join(base, spec.indexFile)
    this.root = path.join(base, spec.rootDir)
    this.read()
  }

  /** Which agent these accounts belong to, and how a shell is pointed at one. */
  get vendor(): AgentVendor {
    return this.spec.vendor
  }
  get envVar(): string {
    return this.spec.envVar
  }

  private read(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Index>
      this.index = {
        activeId: parsed.activeId || DEFAULT_ACCOUNT_ID,
        added: (parsed.added ?? []).filter((a) => a && typeof a.id === 'string')
      }
    } catch {
      /* first run */
    }
    // A directory removed from underneath us must not leave the app pointing at
    // an account that is not there; that would send every new shell to a
    // configuration directory Claude Code would treat as a fresh sign-in.
    if (!this.exists(this.index.activeId)) this.index.activeId = DEFAULT_ACCOUNT_ID
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.index, null, 2))
      fs.renameSync(tmp, this.file)
    } catch {
      /* the list is a convenience; failing to save it must not break a launch */
    }
  }

  private dirFor(id: string): string {
    return id === DEFAULT_ACCOUNT_ID ? this.spec.homeDir() : path.join(this.root, id)
  }

  private exists(id: string): boolean {
    if (id === DEFAULT_ACCOUNT_ID) return true
    return this.index.added.some((a) => a.id === id) && fs.existsSync(this.dirFor(id))
  }

  list(): Account[] {
    const rows: Account[] = []
    const entries = [
      { id: DEFAULT_ACCOUNT_ID, addedAt: 0 },
      ...this.index.added.filter((a) => fs.existsSync(this.dirFor(a.id)))
    ]
    for (const entry of entries) {
      const configDir = this.dirFor(entry.id)
      const { plan, tier, email, name, org } = this.spec.describe(configDir)
      rows.push({
        vendor: this.spec.vendor,
        id: entry.id,
        configDir,
        email,
        org,
        plan,
        tier,
        // Named after whoever it belongs to. The plan is shown beside it, so
        // falling back to the plan here would print it twice.
        label: email || name || this.spec.fallbackLabel,
        signedIn: plan !== '',
        active: entry.id === this.index.activeId,
        isDefault: entry.id === DEFAULT_ACCOUNT_ID,
        addedAt: entry.addedAt
      })
    }
    return rows
  }

  /**
   * The configuration directory a new shell should be given, or null when the
   * original account is the active one.
   *
   * Null matters: leaving `CLAUDE_CONFIG_DIR` unset is not the same as setting
   * it to `~/.claude`. Unset is what every other terminal on this machine does,
   * and staying identical to that is the point of never touching it.
   */
  activeConfigDir(): string | null {
    const id = this.index.activeId
    if (id === DEFAULT_ACCOUNT_ID || !this.exists(id)) return null
    return this.dirFor(id)
  }

  /** Where the active account keeps its transcripts. */
  activeProjectsDir(): string {
    return path.join(this.activeConfigDir() ?? this.spec.homeDir(), 'projects')
  }

  /** The active account's credentials file, for the plan and tier. */
  activeCredentialsFile(): string {
    return path.join(this.activeConfigDir() ?? this.spec.homeDir(), '.credentials.json')
  }

  setActive(id: string): Account[] {
    if (this.exists(id)) {
      this.index.activeId = id
      this.write()
    }
    return this.list()
  }

  /**
   * Who the original account belongs to, as an opaque id.
   *
   * Watched across a sign-in. Everything else about this feature rests on
   * Claude Code keeping an account entirely inside its configuration
   * directory — which is what it does with `projects/`, `sessions/` and
   * `.claude.json`, measured — but a sign-in could not be completed here
   * without a second account to complete it with, so the one step that was
   * inferred rather than watched is the one that gets a guard. If signing in
   * somewhere else changes who `~/.claude` belongs to, that is a sign-in that
   * landed on the account it was supposed to leave alone, and saying so plainly
   * beats leaving somebody to discover it.
   *
   * The identity, not the credentials: this is an opaque id, and it is compared
   * rather than kept. Tokens are refreshed on their own schedule, so anything
   * derived from them would cry wolf.
   */
  defaultIdentity(): string {
    const { email } = this.spec.describe(this.spec.homeDir())
    try {
      const conf = JSON.parse(
        fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')
      ) as { oauthAccount?: { accountUuid?: string } }
      return conf.oauthAccount?.accountUuid ?? email ?? ''
    } catch {
      return email ?? ''
    }
  }

  /** Makes an empty configuration directory for a sign-in to fill in. */
  reserve(): { id: string; configDir: string } {
    const id = `acct_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    const configDir = this.dirFor(id)
    fs.mkdirSync(configDir, { recursive: true })
    return { id, configDir }
  }

  /**
   * Keeps a reserved directory, once something actually signed in to it.
   *
   * An abandoned sign-in leaves a directory with no credentials in it, and
   * adding that to the list would offer an account that cannot be switched to.
   */
  commit(id: string): Account[] {
    const configDir = this.dirFor(id)
    if (this.spec.describe(configDir).plan === '') {
      this.discard(id)
      return this.list()
    }
    if (!this.index.added.some((a) => a.id === id)) {
      this.index.added.push({ id, addedAt: Date.now() })
    }
    this.write()
    return this.list()
  }

  /** Throws away a reserved directory whose sign-in did not finish. */
  discard(id: string): void {
    if (id === DEFAULT_ACCOUNT_ID) return
    try {
      fs.rmSync(this.dirFor(id), { recursive: true, force: true })
    } catch {
      /* it can stay; it is inert */
    }
  }

  /**
   * Removes an account. The original is never removable — it is not this app's
   * to delete, and every other tool on the machine is using it.
   */
  remove(id: string): Account[] {
    if (id === DEFAULT_ACCOUNT_ID) return this.list()
    this.discard(id)
    this.index.added = this.index.added.filter((a) => a.id !== id)
    if (this.index.activeId === id) this.index.activeId = DEFAULT_ACCOUNT_ID
    this.write()
    return this.list()
  }
}
