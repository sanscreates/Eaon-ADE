import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, History, Play, Trash2, X } from 'lucide-react'
import type { ResumableSession } from '@shared/types'
import { useStore } from '../store/useStore'
import { relTime, shortPath } from '../lib/util'

/**
 * Reads the transcripts Claude Code and Codex leave on disk and offers them
 * back. Nothing here is invented — each row is a real `--resume` command.
 */
export function ResumeDialog(): React.JSX.Element | null {
  const open = useStore((s) => s.resumeOpen)
  const setOpen = useStore((s) => s.setResumeOpen)
  const dismissed = useStore((s) => s.dismissedResume)
  const dismissResume = useStore((s) => s.dismissResume)
  const resumeSessions = useStore((s) => s.resumeSessions)
  const addPane = useStore((s) => s.addPane)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const home = useStore((s) => s.home)

  const [all, setAll] = useState<ResumableSession[] | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAll(null)
    window.eaon.sessions.resumable().then(setAll)
  }, [open])

  const sessions = useMemo(
    () => (all ?? []).filter((s) => !dismissed.includes(s.id)),
    [all, dismissed]
  )

  if (!open) return null

  const resumeOne = (session: ResumableSession): void => {
    if (activeWorkspaceId) {
      addPane(activeWorkspaceId, {
        agentId: 'shell',
        command: session.command,
        cwd: session.cwd || home
      })
      setOpen(false)
    } else {
      resumeSessions([session])
    }
  }

  return (
    <div className="scrim" data-align="center" onMouseDown={() => setOpen(false)}>
      <div
        className="modal"
        role="dialog"
        aria-label="Resume a session"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-mark">
            <History size={16} />
          </span>
          <div className="modal-titles">
            <div className="modal-title">Pick up where you left off</div>
            <div className="modal-sub">
              {all === null
                ? 'Reading your transcripts…'
                : `${sessions.length} session${sessions.length === 1 ? '' : 's'} found on this machine`}
            </div>
          </div>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {all !== null && sessions.length === 0 && (
            <div className="empty">
              <strong>No transcripts to resume.</strong>
              <span>
                Sessions show up here after you have run Claude Code or Codex in a terminal.
              </span>
            </div>
          )}

          {sessions.map((s) => (
            <div className="resume-item" key={s.id}>
              <div className="resume-meta">
                <div className="resume-top">
                  <span className="resume-tool">{s.tool}</span>
                  <span className="resume-when">{relTime(s.updatedAt)}</span>
                </div>
                <div className="resume-label" title={s.label}>
                  {s.cwd ? shortPath(s.cwd, home) : s.label}
                </div>
                <div className="resume-cmd">
                  <code>{s.command}</code>
                  <button
                    className="icon-btn"
                    style={{ width: 20, height: 20 }}
                    aria-label="Copy command"
                    onClick={() => {
                      navigator.clipboard.writeText(s.command)
                      setCopied(s.id)
                      window.setTimeout(() => setCopied(null), 1400)
                    }}
                  >
                    {copied === s.id ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <button className="btn" style={{ height: 28 }} onClick={() => resumeOne(s)}>
                  <Play size={12} />
                  Resume
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ height: 24 }}
                  onClick={() => dismissResume([s.id])}
                  aria-label="Hide this session"
                >
                  <Trash2 size={12} />
                  Hide
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <span className="modal-foot-note">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </span>
          <span className="spacer" />
          <button
            className="btn btn-ghost"
            disabled={!sessions.length}
            onClick={() => dismissResume(sessions.map((s) => s.id))}
          >
            Hide all
          </button>
          <button
            className="btn btn-primary"
            disabled={!sessions.length}
            onClick={() => resumeSessions(sessions.slice(0, 12))}
          >
            <Play size={13} />
            Resume {Math.min(sessions.length, 12)} in a new workspace
          </button>
        </div>
      </div>
    </div>
  )
}
