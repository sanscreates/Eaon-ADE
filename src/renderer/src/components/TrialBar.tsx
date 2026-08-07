import { useCallback, useEffect, useState } from 'react'
import { Check, GitMerge, Loader, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react'
import type { WorktreeChange } from '@shared/worktrees'
import { useStore } from '../store/useStore'

/**
 * The strip above a trial's panes.
 *
 * Five agents given the same instruction produce five answers, and the only
 * question that matters is which one to keep. This shows what each actually
 * changed while they are still working, lets you read any of the diffs, and
 * merges the one you pick — which is the whole reason the runs were isolated.
 */

/** How often the change counts are re-read while agents are running. */
const POLL_MS = 4000

function Stat({ change }: { change?: WorktreeChange }): React.JSX.Element {
  if (!change) return <span className="tr-stat tr-stat-idle">reading…</span>
  const touched = change.filesChanged + change.untracked
  if (!touched) return <span className="tr-stat tr-stat-idle">nothing yet</span>
  return (
    <span className="tr-stat">
      <span className="tr-files">
        {touched} file{touched === 1 ? '' : 's'}
      </span>
      {change.insertions > 0 && <span className="tr-add">+{change.insertions}</span>}
      {change.deletions > 0 && <span className="tr-del">−{change.deletions}</span>}
    </span>
  )
}

export function TrialBar({ workspaceId }: { workspaceId: string }): React.JSX.Element | null {
  const trial = useStore((s) => s.trials.find((t) => t.workspaceId === workspaceId))
  const mergeMember = useStore((s) => s.mergeTrialMember)
  const discard = useStore((s) => s.discardTrial)
  const focusPane = useStore((s) => s.focusPane)
  const notify = useStore((s) => s.notify)

  const [changes, setChanges] = useState<Record<string, WorktreeChange>>({})
  const [diffFor, setDiffFor] = useState<string | null>(null)
  const [diffText, setDiffText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const members = trial?.members
  const baseSha = trial?.baseSha
  const host = trial?.host ?? null

  const read = useCallback(async (): Promise<void> => {
    if (!members || !baseSha) return
    const entries = await Promise.all(
      members.map(
        async (m) => [m.id, await window.eaon.worktrees.change(m.path, baseSha, host)] as const
      )
    )
    setChanges(Object.fromEntries(entries))
  }, [members, baseSha, host])

  // Polled rather than pushed: the agents are writing files directly, and
  // nothing in the app is told when they do.
  useEffect(() => {
    if (!trial || trial.winnerId) return
    void read()
    const timer = window.setInterval(() => void read(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [trial, read])

  if (!trial) return null

  const openDiff = async (memberId: string, path: string): Promise<void> => {
    if (diffFor === memberId) {
      setDiffFor(null)
      return
    }
    setDiffFor(memberId)
    setDiffText('')
    setDiffText(await window.eaon.worktrees.diff(path, trial.baseSha, host))
  }

  const merge = async (memberId: string, label: string): Promise<void> => {
    setBusy(memberId)
    try {
      const res = await mergeMember(trial.id, memberId)
      if (res.ok) {
        notify({
          kind: 'info',
          title: `Merged attempt ${label}`,
          text: 'Its work is on your branch. The other attempts are still here until you discard them.'
        })
      } else {
        notify({
          kind: res.conflicts.length ? 'attention' : 'error',
          title: res.conflicts.length ? 'Merged with conflicts' : 'Could not merge',
          text: res.conflicts.length
            ? `Left in your tree to resolve: ${res.conflicts.join(', ')}`
            : res.message
        })
      }
    } finally {
      setBusy(null)
    }
  }

  const winner = trial.members.find((m) => m.id === trial.winnerId)

  return (
    <div className="trialbar">
      <div className="tr-head">
        <span className="eyebrow">Trial</span>
        <span className="tr-prompt" title={trial.prompt}>
          {trial.prompt || 'No prompt given'}
        </span>
        <span className="tr-base mono">from {trial.baseRef}</span>

        <span className="tr-head-actions">
          <button className="tr-icon" onClick={() => void read()} title="Re-read the changes">
            <RefreshCw size={12} />
          </button>
          {confirmDiscard ? (
            <>
              <span className="tr-confirm">Delete all {trial.members.length} checkouts?</span>
              <button
                className="tr-danger"
                onClick={() => {
                  setConfirmDiscard(false)
                  void discard(trial.id)
                }}
              >
                Delete
              </button>
              <button className="tr-icon" onClick={() => setConfirmDiscard(false)}>
                <X size={12} />
              </button>
            </>
          ) : (
            <button
              className="tr-icon"
              onClick={() => setConfirmDiscard(true)}
              title="Discard the trial and every checkout in it"
            >
              <Trash2 size={12} />
            </button>
          )}
        </span>
      </div>

      {winner && (
        <p className="tr-won">
          <Check size={12} />
          Attempt {winner.label} was merged into {trial.baseRef}. Discard the trial to clean the
          rest up.
        </p>
      )}

      <div className="tr-members">
        {trial.members.map((m) => {
          const change = changes[m.id]
          const isWinner = trial.winnerId === m.id
          return (
            <div key={m.id} className="tr-member" data-won={isWinner}>
              <button
                className="tr-label"
                onClick={() => m.paneId && focusPane(workspaceId, m.paneId)}
                title="Show this attempt's pane"
              >
                {m.label}
              </button>

              <span className="tr-body">
                <Stat change={change} />
                <span className="tr-branch mono" title={m.path}>
                  {change?.dirty ? 'uncommitted' : change?.commits ? `${change.commits} commit${change.commits === 1 ? '' : 's'}` : 'clean'}
                </span>
              </span>

              <button className="tr-link" onClick={() => void openDiff(m.id, m.path)}>
                {diffFor === m.id ? 'Hide' : 'Diff'}
              </button>

              {isWinner ? (
                <span className="tr-merged">
                  <Check size={12} />
                  Merged
                </span>
              ) : (
                <button
                  className="tr-merge"
                  disabled={busy !== null || Boolean(trial.winnerId)}
                  onClick={() => void merge(m.id, m.label)}
                  title={`Commit attempt ${m.label} and merge it into ${trial.baseRef}`}
                >
                  {busy === m.id ? <Loader size={12} className="spin" /> : <GitMerge size={12} />}
                  Keep
                </button>
              )}
            </div>
          )
        })}
      </div>

      {diffFor && (
        <pre className="tr-diff mono">
          {diffText || <span className="tr-stat-idle">reading the diff…</span>}
        </pre>
      )}

      {trial.members.length > 1 && !trial.winnerId && (
        <p className="tr-note">
          <TriangleAlert size={11} />
          Keeping one commits that attempt and merges it. The others stay on disk until you discard
          the trial.
        </p>
      )}
    </div>
  )
}
