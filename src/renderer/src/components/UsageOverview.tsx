import { CalendarDays, Coins, Database, Sparkles } from 'lucide-react'
import type { TokenStats } from '@shared/stats'

/**
 * What the agents spent, above the rest of the Stats surface.
 *
 * Every figure here is read from the transcripts on disk — the same files the
 * agents wrote as they worked — so it is counted rather than sampled, and it
 * covers every agent this machine has run rather than one plan's window.
 */

/** 13,115,000,000 reads as 13.1B. Tokens only ever arrive in these sizes. */
function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`
  return `${(n / 1e9).toFixed(1)}B`
}

function money(n: number): string {
  if (n >= 10_000) return `$${Math.round(n).toLocaleString()}`
  return `$${n.toFixed(2)}`
}

/** "Jul 24" — the same shape the heatmap's own labels use. */
function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Five steps, by share of the busiest day rather than by an absolute count.
 *
 * A quiet week and a heavy one are both worth reading, and a fixed scale would
 * render one of them as a single flat colour.
 */
function level(total: number, best: number): number {
  if (total <= 0) return 0
  if (best <= 0) return 1
  const share = total / best
  if (share > 0.66) return 4
  if (share > 0.4) return 3
  if (share > 0.15) return 2
  return 1
}

export function UsageOverview({ tokenStats }: { tokenStats: TokenStats }): React.JSX.Element {
  const t = tokenStats
  const best = t.best?.total ?? 0

  // The strip shows six weeks. The grid above it already covers the year; what
  // is useful here is recent intensity, at a size you can take in at once.
  const strip = t.days.slice(-42)

  /*
   * What went in and what came out.
   *
   * Cache reads are kept as their own share rather than folded into input,
   * because they are an order of magnitude cheaper and they dominate: without
   * separating them the bar would say "input" and mean "mostly a discount".
   */
  const mix = [
    { key: 'input', label: 'New input', value: t.input, tone: 'input' },
    { key: 'output', label: 'Output', value: t.output, tone: 'output' },
    { key: 'cache', label: 'Cache', value: t.cacheRead + t.cacheWrite, tone: 'cache' }
  ].filter((part) => part.value > 0)
  const mixTotal = mix.reduce((a, p) => a + p.value, 0) || 1

  if (t.total === 0) {
    return (
      <section className="stats-card">
        <div className="stats-card-head">
          <span className="eyebrow">Usage overview</span>
        </div>
        <p className="stats-none">
          No agent transcripts here yet. Run an agent and this fills in on its own.
        </p>
      </section>
    )
  }

  return (
    <section className="usage-overview">
      <div className="stats-tiles">
        <div className="stats-tile">
          <Sparkles size={13} />
          <div className="tile-n">{tokens(t.total)}</div>
          <div className="tile-label">total tokens</div>
        </div>
        <div
          className="stats-tile"
          title="What this would have cost at API list prices. A Pro or Max subscription does not bill per token, so this is not a bill."
        >
          <Coins size={13} />
          <div className="tile-n">{money(t.cost)}</div>
          <div className="tile-label">est. API cost</div>
        </div>
        <div className="stats-tile">
          <CalendarDays size={13} />
          <div className="tile-n">{t.activeDays}</div>
          <div className="tile-label">active days</div>
        </div>
        <div
          className="stats-tile"
          title="Share of everything sent to the model that came from the prompt cache rather than being charged as fresh input."
        >
          <Database size={13} />
          <div className="tile-n">{Math.round(t.cacheShare)}%</div>
          <div className="tile-label">served from cache</div>
        </div>
      </div>

      <div className="usage-split">
        <section className="stats-card">
          <div className="stats-card-head">
            <span className="eyebrow">Daily intensity</span>
            {t.best && <span className="chip usage-best">Best {shortDate(t.best.date)}</span>}
          </div>
          <p className="stats-note usage-lede">Tokens through every agent, day by day.</p>

          <div className="usage-strip" role="img" aria-label="Token activity over the last six weeks">
            {strip.map((d) => (
              <i
                key={d.date}
                className="heatmap-cell"
                data-level={level(d.total, best)}
                title={`${shortDate(d.date)} — ${d.total ? `${tokens(d.total)} tokens` : 'nothing'}`}
              />
            ))}
          </div>

          <div className="usage-scale">
            <span>{strip.length ? shortDate(strip[0].date) : ''}</span>
            <span className="usage-legend">
              Less
              {[0, 1, 2, 3, 4].map((l) => (
                <i key={l} className="heatmap-cell" data-level={l} />
              ))}
              More
            </span>
            <span>{strip.length ? shortDate(strip[strip.length - 1].date) : ''}</span>
          </div>
        </section>

        <section className="stats-card">
          <div className="stats-card-head">
            <span className="eyebrow">Token mix</span>
          </div>
          <p className="stats-note usage-lede">
            Cache reads counted apart from fresh input — they cost a fraction as much.
          </p>

          <div className="usage-bar" role="img" aria-label="How the tokens divide">
            {mix.map((part) => (
              <span
                key={part.key}
                data-tone={part.tone}
                style={{ width: `${(part.value / mixTotal) * 100}%` }}
                title={`${part.label}: ${tokens(part.value)}`}
              />
            ))}
          </div>

          <ul className="usage-keys">
            {mix.map((part) => (
              <li key={part.key}>
                <i data-tone={part.tone} />
                <span className="usage-key-label">{part.label}</span>
                <span className="usage-key-n">{tokens(part.value)}</span>
                <span className="usage-key-pct">
                  {Math.round((part.value / mixTotal) * 100)}%
                </span>
              </li>
            ))}
          </ul>

          {t.models.length > 0 && (
            <ul className="usage-models">
              {t.models.slice(0, 4).map((m) => (
                <li key={m.model}>
                  <span className="usage-key-label">{m.label}</span>
                  <span className="usage-key-n">{tokens(m.total)}</span>
                  <span className="usage-key-pct">{money(m.cost)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}
