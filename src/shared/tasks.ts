/**
 * Work waiting for you: pull requests, issues, Linear tickets.
 *
 * Three providers with three different vocabularies — a GitHub PR, a GitLab
 * merge request and a Linear ticket are the same thing to a person and
 * nothing alike in their APIs. They are normalised into one `WorkItem` here
 * so the panel renders one list and the "open a worktree from this" action
 * has one shape to work with, rather than three near-identical branches.
 */

export type TaskProvider = 'github' | 'gitlab' | 'linear'
export type TaskKind = 'pr' | 'issue'

/**
 * State, flattened to what changes how a row looks.
 *
 * Every provider names these differently — GitHub says MERGED, GitLab says
 * merged, Linear has user-defined workflow states with a `type` behind them.
 * Mapping to a fixed set here is what keeps that mess out of the renderer.
 */
export type TaskTone = 'open' | 'draft' | 'merged' | 'closed'

export interface WorkItem {
  /** Stable across refreshes: `${provider}:${kind}:${ref}`. */
  id: string
  provider: TaskProvider
  kind: TaskKind
  /** What a person calls it: "#12" on GitHub, "ENG-42" on Linear. */
  ref: string
  title: string
  /** The provider's own word for the state, shown verbatim on the row. */
  state: string
  tone: TaskTone
  author: string | null
  url: string
  /**
   * The branch this work lives on.
   *
   * A pull request has a real head branch. A Linear issue has a *suggested*
   * one it generates for you. A plain GitHub issue has neither, so this is
   * null and the UI offers to cut a new branch named after it instead.
   */
  branch: string | null
  /** True when `branch` already exists somewhere rather than being a suggestion. */
  branchExists: boolean
  labels: string[]
  updatedAt: string | null
  /** Pull requests only: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or null. */
  reviewDecision: string | null
}

/** A Linear team, for the selector on the "new issue" form. */
export interface LinearTeam {
  id: string
  key: string
  name: string
}

export interface TaskFetch {
  items: WorkItem[]
  /**
   * Why a provider returned nothing, when it is worth saying.
   *
   * An empty list and "gh is not installed" look identical in a UI that only
   * carries items, and the second one is the only one the user can act on.
   */
  notes: { provider: TaskProvider; message: string }[]
}

/** A branch name a provider would be happy with, from an issue title. */
export function branchNameFor(item: Pick<WorkItem, 'ref' | 'title'>): string {
  const slug = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  const ref = item.ref.replace(/^#/, '').toLowerCase()
  return `eaon/${ref}${slug ? `-${slug}` : ''}`
}

export function toneOfGithubPr(state: string, isDraft: boolean): TaskTone {
  if (isDraft) return 'draft'
  const s = state.toUpperCase()
  if (s === 'MERGED') return 'merged'
  if (s === 'CLOSED') return 'closed'
  return 'open'
}

export function toneOfGithubIssue(state: string): TaskTone {
  return state.toUpperCase() === 'CLOSED' ? 'closed' : 'open'
}

/**
 * Linear's workflow states are user-defined, but each carries a fixed `type`
 * — that is the part worth mapping, since a team may well have renamed
 * "Done" to anything at all.
 */
export function toneOfLinear(stateType: string): TaskTone {
  if (stateType === 'completed') return 'merged'
  if (stateType === 'canceled') return 'closed'
  return 'open'
}
