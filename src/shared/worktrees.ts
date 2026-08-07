/**
 * Isolated checkouts, one per task.
 *
 * The point of a worktree here is that two agents editing the same repository
 * never see each other's half-finished work. No stashing, no branch juggling:
 * each gets a real directory on a branch of its own, cut from the same base
 * commit, and the one you like is merged back.
 */

import type { SshHost } from './ssh'

export interface Worktree {
  /** Absolute path of the checkout. */
  path: string
  /** Branch it is on, or null when detached. */
  branch: string | null
  /** Short commit it currently points at. */
  head: string
  /**
   * The repository's own checkout. It appears in `git worktree list` like any
   * other and is the one thing here that must never be removed.
   */
  isMain: boolean
  locked: boolean
}

/** What an agent actually changed, measured against the commit it started from. */
export interface WorktreeChange {
  path: string
  filesChanged: number
  insertions: number
  deletions: number
  /** New files git has not been told about yet — agents create plenty. */
  untracked: number
  /** Commits this branch has that the base does not. */
  commits: number
  /** Work that has not been committed. Merging has to deal with this. */
  dirty: boolean
}

/** One agent's attempt, inside a trial. */
export interface TrialMember {
  id: string
  /** Which agent ran here, e.g. "claude". */
  agentId: string
  /** Short handle shown on the card: "A", "B", … */
  label: string
  branch: string
  path: string
  /** The pane running it, once spawned. */
  paneId: string | null
}

/**
 * One prompt, run several times side by side.
 *
 * The base commit is recorded rather than re-read: every member is compared
 * against the commit the trial actually started from, so a commit landing on
 * the branch mid-trial cannot quietly change what "changed" means.
 */
export interface Trial {
  id: string
  /** The workspace holding this trial's panes. */
  workspaceId: string
  prompt: string
  /** The repository every member was cut from. */
  repoRoot: string
  /** Commit every member branched from, resolved once at creation. */
  baseSha: string
  /** Human name of the base, e.g. "main". */
  baseRef: string
  members: TrialMember[]
  /** Member id that was merged, once one has been. */
  winnerId: string | null
  createdAt: number
  /** The remote box every member's worktree was cut on, or null for local. */
  host?: SshHost | null
}

/** Branch and directory names come from this, so both stay predictable. */
export function memberLabel(index: number): string {
  // A…Z, then A2, B2 … — a trial of 30 is absurd, but it should not collide.
  const letter = String.fromCharCode(65 + (index % 26))
  const lap = Math.floor(index / 26)
  return lap === 0 ? letter : `${letter}${lap + 1}`
}

/**
 * A filesystem- and git-safe version of a name.
 *
 * Git refuses refs with spaces, a leading dot, a trailing `.lock`, and a fair
 * few other things; rather than encode that rulebook, anything that is not
 * plainly safe becomes a dash.
 */
export function slugify(text: string, fallback = 'task'): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')
  return slug || fallback
}
