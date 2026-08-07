import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { slugify, type Worktree, type WorktreeChange } from '../shared/worktrees'
import type { SshHost } from '../shared/ssh'
import { existsRemote, mkdirRemote, realpathRemote, remoteExec, remoteWorktreeBase } from './ssh'

const run = promisify(execFile)

/**
 * Git worktrees, one per task — local or on a remote box.
 *
 * `host` is an optional trailing parameter on every function below. When it
 * is absent every operation is the exact local `fs`/`execFile` code this
 * file always ran — nothing about the local path changed to make room for
 * the remote one. When present, the same operation runs over `ssh` instead:
 * `git -C <dir>` in place of the `cwd` child-process option (ssh has no
 * equivalent of "start here"), and `mkdirRemote`/`existsRemote`/
 * `realpathRemote` in place of the `fs` calls that touch the checkout's own
 * directory, since those have to happen on the far end too.
 */

let baseDir = ''

/** Where local worktrees are created. Set once, from the app's userData folder. */
export function setBaseDir(dir: string): void {
  baseDir = dir
}

export function getBaseDir(): string {
  return baseDir
}

async function git(cwd: string, args: string[], host?: SshHost | null): Promise<string> {
  if (host) {
    const res = await remoteExec(host, 'git', ['-C', cwd, ...args], { maxBuffer: 32 * 1024 * 1024 })
    if (!res.ok) {
      const err = new Error(res.stderr || 'git failed') as Error & {
        stdout?: string
        stderr?: string
      }
      err.stdout = res.stdout
      err.stderr = res.stderr
      throw err
    }
    return res.stdout
  }
  const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

/**
 * A path with its symlinks resolved.
 *
 * git always reports the resolved form, and macOS puts temporary directories —
 * and some home directories — behind a symlink (`/var` is `/private/var`).
 * Comparing a caller's unresolved path against git's answer therefore never
 * matches, silently: the branch of a removed worktree would not be cleaned up,
 * and the guard against removing the repository's own checkout would never
 * fire. Both were real, and both were invisible until a test ran on a Mac.
 * The same class of bug can exist on a remote box just as easily, so the
 * remote path resolves too rather than trusting the string it was given.
 */
async function realOf(p: string, host?: SshHost | null): Promise<string> {
  if (host) return (await realpathRemote(host, p)) ?? p
  try {
    return await fs.realpath(p)
  } catch {
    // Not created yet, or already gone — resolving is the best available answer.
    return path.resolve(p)
  }
}

/**
 * Files Eaon puts into a checkout itself.
 *
 * A workspace is provisioned with the memory tooling — `.mcp.json` and
 * `.claude/skills` — the moment a pane opens in it, which for a trial is every
 * checkout. Those are ours, not the agent's work. Counting them would report
 * "3 files changed" against an attempt that changed one, and committing them
 * on merge would push Eaon's own plumbing into the user's repository.
 *
 * Only ever filtered while untracked: a project that genuinely tracks a
 * `.mcp.json` owns that file, and a change to it is a real change.
 */
function isProvisioned(file: string): boolean {
  return file === '.mcp.json' || file === '.claude' || file.startsWith('.claude/')
}

/** Untracked files, split into the agent's and ours. */
async function untracked(
  worktreePath: string,
  host?: SshHost | null
): Promise<{ theirs: string[]; ours: string[] }> {
  const out = await git(worktreePath, ['ls-files', '--others', '--exclude-standard'], host)
  const all = out.split('\n').filter(Boolean)
  return {
    theirs: all.filter((f) => !isProvisioned(f)),
    ours: all.filter(isProvisioned)
  }
}

/** Error text from git, which puts the useful half on stderr. */
function gitError(err: unknown): string {
  const e = err as { stdout?: string; stderr?: string; message?: string }
  return (e.stderr || e.stdout || e.message || 'git failed').trim()
}

/**
 * The top of the working tree, given anywhere inside it.
 *
 * Asked rather than assumed: a workspace's cwd is frequently a subdirectory,
 * and `git worktree add` run from one still belongs to the repository root.
 */
export async function repoRoot(cwd: string, host?: SshHost | null): Promise<string | null> {
  try {
    const out = await git(cwd, ['rev-parse', '--show-toplevel'], host)
    return out.trim() || null
  } catch {
    return null
  }
}

/**
 * Where this repository's checkouts live.
 *
 * Outside the repository, so a worktree never shows up as untracked noise in
 * the repository that owns it. The hash keeps two projects with the same
 * folder name — `client/api` and `server/api` — from sharing a directory.
 *
 * Async because the remote case needs to ask the far end for its own home
 * directory first — there is no Eaon install there to own an app-data folder
 * the way `baseDir` does locally, so `~/.eaon-worktrees` is resolved fresh
 * each time rather than assumed or cached across a connection that could, in
 * principle, point at a different box on a later call.
 */
async function dirForRepo(root: string, host?: SshHost | null): Promise<string | { error: string }> {
  const hash = crypto.createHash('sha1').update(root).digest('hex').slice(0, 8)
  const name = `${slugify(path.basename(root), 'repo')}-${hash}`
  if (host) {
    const base = await remoteWorktreeBase(host)
    if (!base) return { error: 'Could not resolve a home directory on the remote host.' }
    return `${base}/${name}`
  }
  return path.join(baseDir, name)
}

/** Every checkout git knows about, including the repository's own. */
export async function list(cwd: string, host?: SshHost | null): Promise<Worktree[]> {
  const root = await repoRoot(cwd, host)
  if (!root) return []
  try {
    const out = await git(root, ['worktree', 'list', '--porcelain'], host)
    const trees: Worktree[] = []
    let current: Partial<Worktree> = {}

    // Records are separated by a blank line; the last one has no trailing one.
    const flush = (): void => {
      if (current.path) {
        trees.push({
          path: current.path,
          branch: current.branch ?? null,
          head: current.head ?? '',
          locked: current.locked ?? false,
          isMain: trees.length === 0
        })
      }
      current = {}
    }

    for (const line of out.split('\n')) {
      if (!line.trim()) {
        flush()
        continue
      }
      if (line.startsWith('worktree ')) current.path = line.slice(9).trim()
      else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim().slice(0, 8)
      else if (line.startsWith('branch '))
        current.branch = line.slice(7).trim().replace('refs/heads/', '')
      else if (line === 'detached') current.branch = null
      else if (line.startsWith('locked')) current.locked = true
    }
    flush()
    // Normalised here, once, so every comparison downstream is against the
    // same form git itself uses.
    return Promise.all(trees.map(async (w) => ({ ...w, path: await realOf(w.path, host) })))
  } catch {
    return []
  }
}

export interface CreateRequest {
  /** Anywhere inside the repository. */
  cwd: string
  /** Branch name to create. Slugified by the caller if it came from a human. */
  branch: string
  /** What to cut from. Defaults to the current HEAD. */
  baseRef?: string
  /**
   * Check out a branch that already exists instead of cutting a new one.
   *
   * This is what "open a worktree from this pull request" needs: the head
   * branch is real and already pushed, so inventing a fresh one from HEAD
   * would give you an empty checkout of the wrong thing entirely. The branch
   * is fetched first, since a PR's head usually exists only on the remote.
   */
  existing?: boolean
}

export interface CreateResult {
  ok: boolean
  worktree?: Worktree
  /** The commit it was actually cut from, for comparing against later. */
  baseSha?: string
  error?: string
}

/**
 * Cut a new checkout from a base commit.
 *
 * The base is resolved to a SHA before the worktree is made, and that SHA is
 * what gets handed back: a trial compares every member against the commit it
 * started from, and a branch that moves underneath it would otherwise change
 * what each agent appears to have done.
 */
export async function create(req: CreateRequest, host?: SshHost | null): Promise<CreateResult> {
  if (!host && !baseDir) return { ok: false, error: 'Worktree directory is not configured.' }

  const root = await repoRoot(req.cwd, host)
  if (!root) return { ok: false, error: 'Not a git repository.' }

  /*
   * Where an existing branch actually is.
   *
   * A pull request's head is normally only on the remote, so it is fetched
   * first — quietly, and without treating failure as fatal, because being
   * offline with the branch already local is a perfectly workable case and
   * the checks below are what really decide.
   */
  let checkoutFrom: string | null = null
  if (req.existing) {
    try {
      await git(root, ['fetch', '--quiet', 'origin', req.branch], host)
    } catch {
      /* offline, no origin, or no such branch upstream — decided just below */
    }
    const has = async (ref: string): Promise<boolean> => {
      try {
        await git(root, ['rev-parse', '--verify', '--quiet', ref], host)
        return true
      } catch {
        return false
      }
    }
    if (await has(`refs/heads/${req.branch}`)) checkoutFrom = 'local'
    else if (await has(`refs/remotes/origin/${req.branch}`)) checkoutFrom = `origin/${req.branch}`
    else {
      return { ok: false, error: `Branch ${req.branch} is not here or on origin.` }
    }
  }

  let baseSha: string
  try {
    /*
     * For an existing branch the base is its own tip, not HEAD.
     *
     * Everything downstream compares against this SHA to answer "what changed
     * here" — and for a checked-out pull request the useful answer is what
     * *you* change from now on, not the diff the PR already contained, which
     * is a different question with a perfectly good answer on GitHub already.
     */
    const ref = req.existing ? (checkoutFrom === 'local' ? req.branch : checkoutFrom!) : req.baseRef || 'HEAD'
    baseSha = (await git(root, ['rev-parse', ref], host)).trim()
  } catch {
    return { ok: false, error: `Cannot resolve ${req.baseRef || 'HEAD'}.` }
  }

  const dir = await dirForRepo(root, host)
  if (typeof dir !== 'string') return { ok: false, error: dir.error }

  if (host) {
    const made = await mkdirRemote(host, dir)
    if (!made.ok) return { ok: false, error: made.stderr || 'Could not create the remote directory.' }
  } else {
    await fs.mkdir(dir, { recursive: true })
  }

  // path.join for local so Windows keeps its native separator; a remote
  // worktree base is always POSIX (ssh targets are Linux/macOS boxes), so a
  // plain forward-slash join is correct there regardless of what platform
  // Eaon itself is running on.
  const target = host
    ? `${dir}/${req.branch.replace(/\//g, '-')}`
    : path.join(dir, req.branch.replace(/\//g, '-'))

  const already = host ? await existsRemote(host, target) : await exists(target)
  if (already) {
    // path.posix regardless of what platform Eaon itself runs on — a remote
    // target is forward-slash-joined above and a Windows-flavoured basename()
    // would not find a separator in it at all, showing the whole path instead
    // of just the branch name in this one message.
    const base = host ? path.posix.basename(target) : path.basename(target)
    return { ok: false, error: `${base} already exists.` }
  }

  try {
    if (checkoutFrom === 'local') {
      // Already a local branch: attach a worktree to it as it stands.
      await git(root, ['worktree', 'add', target, req.branch], host)
    } else if (checkoutFrom) {
      // Remote-only: create the local branch here, tracking what was fetched.
      await git(root, ['worktree', 'add', '-b', req.branch, target, checkoutFrom], host)
    } else {
      await git(root, ['worktree', 'add', '-b', req.branch, target, baseSha], host)
    }
  } catch (err) {
    return { ok: false, error: gitError(err) }
  }

  const targetReal = await realOf(target, host)
  const made = (await list(root, host)).find((w) => w.path === targetReal)
  return {
    ok: true,
    baseSha,
    worktree: made ?? {
      path: targetReal,
      branch: req.branch,
      head: baseSha.slice(0, 8),
      isMain: false,
      locked: false
    }
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * What changed here, against the commit this worktree started from.
 *
 * Measured against the working tree rather than the last commit, because an
 * agent that has edited but not committed has still done the work — and a
 * comparison that showed nothing until it committed would be useless for
 * exactly the case this feature exists for.
 */
export async function change(
  worktreePath: string,
  baseSha: string,
  host?: SshHost | null
): Promise<WorktreeChange> {
  const empty: WorktreeChange = {
    path: worktreePath,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    untracked: 0,
    commits: 0,
    dirty: false
  }

  try {
    const stat = await git(worktreePath, ['diff', '--shortstat', baseSha], host)
    // "3 files changed, 42 insertions(+), 7 deletions(-)" — any part may be absent.
    const filesChanged = Number(stat.match(/(\d+) files? changed/)?.[1] ?? 0)
    const insertions = Number(stat.match(/(\d+) insertions?\(\+\)/)?.[1] ?? 0)
    const deletions = Number(stat.match(/(\d+) deletions?\(-\)/)?.[1] ?? 0)

    const { theirs } = await untracked(worktreePath, host)

    const commitsOut = await git(worktreePath, ['rev-list', '--count', `${baseSha}..HEAD`], host)
    const commits = Number(commitsOut.trim() || 0)

    /*
     * Dirty means uncommitted, which is a property of the working tree right
     * now — not of `filesChanged` above, which is a diff against the base and
     * stays non-zero forever once a single commit has landed on the branch.
     * Conflating the two made a freshly committed attempt read as dirty
     * forever. `git status` is asked directly instead, and its untracked
     * lines are filtered the same way `untracked()` filters `ls-files`, so
     * our own provisioning sitting there unstaged does not count either.
     */
    const statusOut = await git(worktreePath, ['status', '--porcelain=v1'], host)
    const dirty = statusOut
      .split('\n')
      .filter(Boolean)
      .some((line) => line.slice(0, 2) !== '??' || !isProvisioned(line.slice(3)))

    return {
      path: worktreePath,
      filesChanged,
      insertions,
      deletions,
      untracked: theirs.length,
      commits,
      dirty
    }
  } catch {
    return empty
  }
}

/** The full patch against the base, for reading side by side. */
export async function diff(
  worktreePath: string,
  baseSha: string,
  host?: SshHost | null
): Promise<string> {
  try {
    const out = await git(worktreePath, ['diff', '--no-color', baseSha], host)
    if (out.trim()) return out
    const { theirs } = await untracked(worktreePath, host)
    if (theirs.length) {
      return `No tracked changes.\n\nNew files not yet added to git:\n${theirs
        .map((f) => `  ${f}`)
        .join('\n')}`
    }
    return 'No changes yet.'
  } catch (err) {
    return gitError(err)
  }
}

/**
 * Commit whatever the agent left lying around.
 *
 * Agents routinely stop with the work saved but not committed, and a branch
 * cannot be merged in that state. Called just before a merge rather than on a
 * timer, so nothing is committed on a worktree you were only looking at.
 */
export async function commitAll(
  worktreePath: string,
  message: string,
  host?: SshHost | null
): Promise<CreateResult> {
  try {
    const { ours } = await untracked(worktreePath, host)
    await git(worktreePath, ['add', '-A'], host)
    // Un-stage our own provisioning, so merging an attempt does not carry
    // Eaon's plumbing into the user's repository along with the work.
    if (ours.length) await git(worktreePath, ['reset', '-q', '--', ...ours], host)

    const staged = (await git(worktreePath, ['diff', '--cached', '--name-only'], host)).trim()
    if (!staged) return { ok: true }

    await git(worktreePath, ['commit', '-m', message], host)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: gitError(err) }
  }
}

export interface MergeResult {
  ok: boolean
  /** Files left conflicted, when the merge could not complete on its own. */
  conflicts: string[]
  message: string
}

/**
 * Merge a member's branch into whatever the repository has checked out.
 *
 * `--no-ff` on purpose: the point of a trial is that several attempts existed,
 * and a fast-forward would erase the evidence that this one was chosen. A
 * conflicted merge is left in place, not aborted — resolving it is work the
 * user may well want to hand to an agent.
 */
export async function merge(
  cwd: string,
  branch: string,
  host?: SshHost | null
): Promise<MergeResult> {
  const root = await repoRoot(cwd, host)
  if (!root) return { ok: false, conflicts: [], message: 'Not a git repository.' }

  try {
    const out = await git(root, ['merge', '--no-ff', '-m', `Merge ${branch}`, branch], host)
    return { ok: true, conflicts: [], message: out.trim() || 'Merged.' }
  } catch (err) {
    let conflicts: string[] = []
    try {
      const names = await git(root, ['diff', '--name-only', '--diff-filter=U'], host)
      conflicts = names.split('\n').filter(Boolean)
    } catch {
      /* the conflict list is a nicety; the error text below is the substance */
    }
    return { ok: false, conflicts, message: gitError(err) }
  }
}

/**
 * Remove a checkout, and optionally the branch with it.
 *
 * Force is the default from the UI because the losing attempts in a trial are
 * dirty by definition, and refusing to clean them up would leave the user to
 * delete half a dozen directories by hand.
 */
export async function remove(
  cwd: string,
  worktreePath: string,
  opts: { force?: boolean; deleteBranch?: boolean } = {},
  host?: SshHost | null
): Promise<{ ok: boolean; error?: string }> {
  const root = await repoRoot(cwd, host)
  if (!root) return { ok: false, error: 'Not a git repository.' }

  // The repository's own checkout is in this list too, and removing it would
  // take the user's working copy with it.
  const trees = await list(root, host)
  const wanted = await realOf(worktreePath, host)
  const main = trees.find((w) => w.isMain)
  if (main && main.path === wanted) {
    return { ok: false, error: 'That is the repository itself.' }
  }

  const branch = trees.find((w) => w.path === wanted)?.branch

  try {
    const args = ['worktree', 'remove']
    if (opts.force) args.push('--force')
    args.push(worktreePath)
    await git(root, args, host)
  } catch (err) {
    return { ok: false, error: gitError(err) }
  }

  if (opts.deleteBranch && branch) {
    try {
      await git(root, ['branch', '-D', branch], host)
    } catch {
      // A branch that is checked out somewhere else, or already gone. The
      // checkout is what the user asked to be rid of, and it is gone.
    }
  }
  return { ok: true }
}

/** Forget checkouts whose directories have been deleted from underneath git. */
export async function prune(
  cwd: string,
  host?: SshHost | null
): Promise<{ ok: boolean; error?: string }> {
  const root = await repoRoot(cwd, host)
  if (!root) return { ok: false, error: 'Not a git repository.' }
  try {
    await git(root, ['worktree', 'prune'], host)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: gitError(err) }
  }
}
