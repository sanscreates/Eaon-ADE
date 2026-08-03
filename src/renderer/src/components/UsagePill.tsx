import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react'
import {
  BILLED_NOTE,
  EMPTY_REPORT,
  formatTokens,
  formatUntil,
  type UsageReport
} from '@shared/usage'
import { useStore } from '../store/useStore'

/**
 * What the plan has left, in the title bar.
 *
 * The pill shows the two numbers worth glancing at — how full each window is
 * and when it next eases — and opens onto the detail. Reading it costs nothing
 * once warm: the scan is incremental, so a refresh re-parses only what has been
 * written since the last look.
 */

/** How often the readout refreshes itself while the panel is closed. */
const IDLE_REFRESH_MS = 90_000

/**
 * One bar, two meanings, kept apart.
 *
 * A window meter warms as it fills, because a full window is something to know
 * about. A share meter never does: "Opus was 95% of this week's spend" is a
 * proportion, not a problem, and colouring it like one would spend the app's
 * warning colour on a fact. That colour means one thing here and this is not it.
 */
function Meter({ pct, share = false }: { pct: number; share?: boolean }): React.JSX.Element {
  const level = share ? 'share' : pct >= 90 ? 'high' : pct >= 70 ? 'mid' : 'low'
  return (
    <span className="usage-meter" data-level={level}>
      <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </span>
  )
}

export function UsagePill(): React.JSX.Element | null {
  const settings = useStore((s) => s.settings)
  const [report, setReport] = useState<UsageReport>(EMPTY_REPORT)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [detailed, setDetailed] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setReport(
        await window.eaon.usage.read({
          fromAnthropic: settings.usageFromAnthropic,
          session: settings.usageSessionLimit,
          week: settings.usageWeekLimit
        })
      )
    } catch {
      /* a failed read keeps the last good numbers rather than blanking them */
    } finally {
      setBusy(false)
    }
  }, [settings.usageFromAnthropic, settings.usageSessionLimit, settings.usageWeekLimit])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => {
      // Nothing to update behind another window, and the scan is not free.
      if (!document.hidden) void refresh()
    }, IDLE_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const [session, week] = report.windows
  const live = report.at > 0
  const asPct = report.source === 'anthropic'

  return (
    <div className="usage-root" ref={rootRef}>
      <button
        className="usage-pill"
        data-on={open}
        onClick={() => setOpen((v) => !v)}
        title="How much of your plan is left"
        aria-label="Plan usage"
        aria-expanded={open}
      >
        <Meter pct={session?.pct ?? 0} />
        <span className="usage-pill-figure">
          {live ? `${Math.round(session?.pct ?? 0)}%` : '—'}
        </span>
        <span className="usage-pill-sep">·</span>
        <span className="usage-pill-figure">{live ? `${Math.round(week?.pct ?? 0)}%` : '—'}</span>
        <span className="usage-pill-unit">wk</span>
      </button>

      {open && (
        <div className="usage-panel" role="dialog" aria-label="Plan usage">
          <div className="usage-head">
            <span className="usage-title">Usage</span>
            <span className="usage-source">
              {asPct ? 'from Anthropic' : 'from your transcripts'}
            </span>
            <button
              className="icon-btn"
              onClick={() => void refresh()}
              disabled={busy}
              title="Refresh"
              aria-label="Refresh usage"
            >
              <RefreshCw size={13} className={busy ? 'spin' : undefined} />
            </button>
          </div>

          <div className="usage-tabs" role="tablist">
            <button role="tab" aria-selected={detailed} data-on={detailed} onClick={() => setDetailed(true)}>
              Detailed
            </button>
            <button role="tab" aria-selected={!detailed} data-on={!detailed} onClick={() => setDetailed(false)}>
              Compact
            </button>
          </div>

          <div className="usage-body">
            {report.windows.map((w) => (
              <div className="usage-window" key={w.id}>
                <div className="usage-window-head">
                  <span className="usage-window-name">{w.label}</span>
                  <span className="usage-window-reset">
                    {!live
                      ? 'reading…'
                      : w.kind === 'block'
                        ? w.resetsAt
                          ? `resets in ${formatUntil(w.resetsAt)}`
                          : 'no block open'
                        : /* Nothing resets at once, so it does not claim to. */
                          'rolling 7 days'}
                  </span>
                  <span className="usage-window-pct">{Math.round(w.pct)}%</span>
                </div>
                <Meter pct={w.pct} />
                {detailed && (
                  <div className="usage-window-detail">
                    {asPct
                      ? `${Math.round(w.pct)}% of your ${w.label.toLowerCase()} limit`
                      : `${formatTokens(w.used)} of ${formatTokens(w.limit)} tokens`}
                  </div>
                )}
              </div>
            ))}

            {detailed && (week?.models.length ?? 0) > 0 && (
              <div className="usage-models">
                <span className="eyebrow">By model, this week</span>
                {week.models
                  // A model that did nothing is noise, and Claude Code records a
                  // synthetic one that never costs anything.
                  .filter((m) => m.billed > 0 && m.model !== '<synthetic>')
                  .map((m) => (
                    <div className="usage-model" key={m.model}>
                      <span className="usage-model-name">{m.label}</span>
                      <Meter share pct={week.used > 0 ? (m.billed / week.used) * 100 : 0} />
                      <span className="usage-model-figure">
                        {asPct ? `${Math.round(m.billed)}%` : formatTokens(m.billed)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="usage-foot">
            {report.error ? (
              <span className="usage-warn">
                <TriangleAlert size={12} />
                {report.error}
              </span>
            ) : (
              <span className="usage-note">
                {asPct
                  ? "Anthropic's own figures."
                  : `${BILLED_NOTE} The limit is an estimate you can set.`}
              </span>
            )}
            <button
              className="usage-more"
              onClick={() => {
                setOpen(false)
                useStore.getState().setSettingsOpen(true)
              }}
            >
              Usage settings
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
