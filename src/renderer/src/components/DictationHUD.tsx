import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { dictation, type DictationState } from '../lib/dictation'
import { stopDictation, targetLabel } from '../lib/voice'
import { Logo } from './Logo'

/**
 * The dictation readout: a pill that says ADE is listening, and a caption above
 * it carrying the words as they land.
 *
 * Two ideas drive the design, both taken from what ADE actually is rather than
 * from what a dictation widget usually looks like:
 *
 * 1. The meter is drawn on a monospace rhythm — fixed-width, square-capped
 *    columns on an even pitch. This is a terminal; its own voice should be
 *    rendered in cells, not in the soft rounded blobs every other app uses.
 * 2. The caption's eyebrow names the *destination*, not the activity. "Speaking"
 *    is something you already know — you are the one speaking. Which of a dozen
 *    panes is about to receive the words is the thing you cannot see while your
 *    eyes are off the screen, so that is what the label spends itself on.
 */

/** Columns in the meter. Odd, so there is a true centre when it is at rest. */
const COLUMNS = 13

export function DictationHUD(): React.JSX.Element | null {
  const [state, setState] = useState<DictationState>(dictation.snapshot())
  const conductorOpen = useStore((s) => s.conductorOpen)

  // A rolling window of recent levels: the meter is a waveform scrolling right
  // to left, not a symmetrical bar chart. Held in a ref so the audio callback
  // does not allocate a new array fifteen times a second.
  const history = useRef<number[]>(new Array(COLUMNS).fill(0))

  useEffect(
    () =>
      dictation.subscribe((next) => {
        history.current = [...history.current.slice(1), next.speaking ? next.level : 0]
        setState(next)
      }),
    []
  )

  if (state.phase === 'off' || state.phase === 'error') return null

  const listening = state.phase === 'listening'
  const thinking = state.phase === 'thinking' || state.pending > 0
  const levels = history.current

  return (
    <div className="dictation-stage" data-lifted={conductorOpen}>
      {(state.text || thinking) && (
        <div className="dictation-caption" role="status" aria-live="polite">
          <div className="dictation-eyebrow">
            You <span className="dictation-arrow">→</span> {targetLabel()}
          </div>
          <p className="dictation-said">
            {state.text ? (
              <>
                <span className="dictation-quote">“</span>
                {state.text}
                {!thinking && <span className="dictation-quote">”</span>}
              </>
            ) : null}
            {thinking && <span className="dictation-pending" aria-label="transcribing" />}
          </p>
        </div>
      )}

      <button
        className="dictation-pill"
        data-live={listening}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void stopDictation()}
        title="Finish dictating"
        aria-label="Finish dictating"
      >
        <span className="dictation-tile" data-live={listening}>
          <Logo size={16} ink="var(--brand-coral)" />
        </span>

        <span className="dictation-rule" aria-hidden="true" />

        <span className="dictation-meter" aria-hidden="true">
          {levels.map((level, i) => (
            <i
              key={i}
              style={{
                // 3px is the resting cell — a dot on the baseline. Anything
                // above that is voice.
                height: `${3 + Math.min(1, level * 1.35) * 17}px`,
                opacity: 0.45 + Math.min(1, level * 1.35) * 0.55
              }}
            />
          ))}
        </span>
      </button>
    </div>
  )
}
