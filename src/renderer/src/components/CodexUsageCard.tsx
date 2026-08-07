import { useCallback, useEffect, useState } from 'react'
import { Loader, RefreshCw } from 'lucide-react'
import { EMPTY_REPORT, formatTokens, formatUntil, type UsageReport } from '@shared/usage'

/**
 * What Codex has spent, beside the Claude figures.
 *
 * Measured the same way and shown the same way, with one difference worth
 * being straight about on screen as well as in the source: this reader has
 * never been run against a real Codex install. When it finds no rollouts it
 * says so plainly rather than showing a confident zero, because "nothing
 * spent" and "I could not find your transcripts" are very different answers
 * and only one of them means the number below is right.
 */
export function CodexUsageCard(): React.JSX.Element {
  const [report, setReport] = useState<UsageReport>(EMPTY_REPORT)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setReport(await window.eaon.usage.codex({}))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const found = report.messages > 0

  return (
    <div className="cu-codex">
      <div className="section-head">
        <span className="eyebrow">Codex</span>
        <span className="section-note">
          {loading ? 'reading…' : found ? `${report.messages} turns` : 'no rollouts found'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={() => void load()} aria-label="Re-read" title="Re-read">
          {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {found ? (
        <div className="cu-windows">
          {report.windows.map((w) => (
            <div className="cu-window" key={w.id}>
              <div className="cu-window-head">
                <span className="cu-window-name">{w.label}</span>
                <span className="cu-window-num mono">
                  {formatTokens(w.used)} / {formatTokens(w.limit)}
                </span>
              </div>
              <div className="cu-bar">
                <span className="cu-fill" style={{ transform: `scaleX(${w.pct / 100})` }} />
              </div>
              <div className="cu-window-foot">
                <span>{w.pct}%</span>
                <span className="mono">
                  {w.kind === 'block' ? `resets in ${formatUntil(w.resetsAt)}` : 'rolling'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="settings-lede" style={{ marginTop: 8 }}>
          Nothing found under the active Codex account&rsquo;s <code className="mono">sessions</code>{' '}
          folder. That is expected if Codex is not installed — and if it is, this reader has not
          been checked against a real install yet, so treat a zero here as &ldquo;not measured&rdquo;
          rather than &ldquo;nothing spent&rdquo;.
        </p>
      )}
    </div>
  )
}
