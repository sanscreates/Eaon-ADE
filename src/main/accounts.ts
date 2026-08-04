import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_ACCOUNT_ID, type Account } from '../shared/accounts'

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

export class Accounts {
  private index: Index = { activeId: DEFAULT_ACCOUNT_ID, added: [] }
  private readonly file: string
  private readonly root: string

  constructor(dir?: string) {
    const base = dir ?? app.getPath('userData')
    this.file = path.join(base, 'accounts.json')
    this.root = path.join(base, 'accounts')
    this.read()
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
    return id === DEFAULT_ACCOUNT_ID ? homeConfigDir() : path.join(this.root, id)
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
      const { plan, tier, email, name, org } = describe(configDir)
      rows.push({
        id: entry.id,
        configDir,
        email,
        org,
        plan,
        tier,
        // Named after whoever it belongs to. The plan is shown beside it, so
        // falling back to the plan here would print it twice.
        label: email || name || 'Claude account',
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
    return path.join(this.activeConfigDir() ?? homeConfigDir(), 'projects')
  }

  /** The active account's credentials file, for the plan and tier. */
  activeCredentialsFile(): string {
    return path.join(this.activeConfigDir() ?? homeConfigDir(), '.credentials.json')
  }

  setActive(id: string): Account[] {
    if (this.exists(id)) {
      this.index.activeId = id
      this.write()
    }
    return this.list()
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
    if (describe(configDir).plan === '') {
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
