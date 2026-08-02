import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, Download, X } from 'lucide-react'
import { formatRate, formatSize } from '@shared/update'
import { useStore } from '../store/useStore'

/**
 * The update card.
 *
 * It appears once, in the corner, and only when there is genuinely something to
 * do — a build finished downloading and a restart would apply it. Downloading
 * happens quietly behind it; nothing interrupts a running agent.
 *
 * Dismissing hides it for this session. The titlebar keeps a lit dot so the
 * update is never lost, just out of the way.
 */
export function UpdateCard(): React.JSX.Element | null {
  const update = useStore((s) => s.update)
  const dismissed = useStore((s) => s.updateDismissed)
  const dismiss = useStore((s) => s.dismissUpdate)

  const [expanded, setExpanded] = useState(false)
  const [installing, setInstalling] = useState(false)
  // Mount first, then animate in — otherwise the entrance is skipped.
  const [shown, setShown] = useState(false)

  const visible =
    (update.phase === 'ready' || update.phase === 'downloading') &&
    dismissed !== update.version

  useEffect(() => {
    if (!visible) {
      setShown(false)
      return
    }
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [visible])

  if (!visible) return null

  const ready = update.phase === 'ready'
  const pct = Math.round(update.percent)

  return (
    <aside className="update-card" data-shown={shown} data-ready={ready} aria-live="polite">
      <div className="update-head">
        <span className="update-mark" aria-hidden="true">
          {ready ? <Check size={14} /> : <Download size={14} />}
        </span>

        <div className="update-titles">
          <div className="update-title">
            {ready ? (
              <>
                Version <b>{update.version}</b> is ready
              </>
            ) : (
              <>
                Downloading <b>{update.version}</b>
              </>
            )}
          </div>
          <div className="update-sub">
            {ready
              ? 'Installs when you restart.'
              : [
                  `${pct}%`,
                  formatRate(update.bytesPerSecond),
                  update.total ? `of ${formatSize(update.total)}` : ''
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </div>
        </div>

        <button
          className="icon-btn"
          onClick={() => dismiss(update.version)}
          aria-label="Dismiss"
          title="Dismiss — the update stays ready"
        >
          <X size={14} />
        </button>
      </div>

      {/* One continuous bar: it fills while downloading and completes on ready,
          so the card never jumps between two different layouts. */}
      <div className="update-track" role="progressbar" aria-valuenow={ready ? 100 : pct}>
        <span className="update-fill" style={{ width: `${ready ? 100 : pct}%` }} />
      </div>

      {update.notes && (
        <div className="update-notes" data-expanded={expanded}>
          <p>{update.notes}</p>
        </div>
      )}

      <div className="update-actions">
        {update.notes && (
          <button className="update-link" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide notes' : "What's new"}
            <ArrowUpRight size={11} />
          </button>
        )}
        <span className="spacer" />
        {ready && (
          <>
            <button className="btn btn-ghost" onClick={() => dismiss(update.version)}>
              Later
            </button>
            <button
              className="btn btn-primary"
              disabled={installing}
              onClick={() => {
                setInstalling(true)
                window.eaon.update.install()
              }}
            >
              {installing ? 'Restarting…' : 'Restart now'}
            </button>
          </>
        )}
      </div>

      <span className="update-glow" aria-hidden="true" />
    </aside>
  )
}
