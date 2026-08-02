import { Check, Moon, Sun } from 'lucide-react'
import type { Theme } from '@shared/themes'

/**
 * A miniature of the app window painted in the theme's own colours — chrome,
 * a pane, a couple of lines of output and the accent. It is the fastest honest
 * way to show what picking it will do.
 */
export function ThemeCard({
  theme,
  active,
  onPick
}: {
  theme: Theme
  active: boolean
  onPick: () => void
}): React.JSX.Element {
  const t = theme.tokens
  const ModeIcon = theme.mode === 'dark' ? Moon : Sun

  return (
    <button
      className="theme-card"
      data-on={active}
      onClick={onPick}
      aria-pressed={active}
      aria-label={`${theme.name} theme`}
    >
      <span className="theme-preview" style={{ background: t.ink000, borderColor: t.line200 }}>
        <span className="tp-bar" style={{ background: t.ink100, borderColor: t.line100 }}>
          <i style={{ background: t.textDim }} />
          <i style={{ background: t.textDim }} />
          <i style={{ background: t.textDim }} />
        </span>
        <span className="tp-body" style={{ background: t.ink200 }}>
          <i className="tp-line" style={{ background: t.line300, width: '76%' }} />
          <i className="tp-line" style={{ background: t.line200, width: '54%' }} />
          <span className="tp-row">
            <i className="tp-line" style={{ background: t.line300, flex: 1 }} />
            <i className="tp-pill" style={{ background: t.accent }} />
          </span>
          <span className="tp-status">
            <i style={{ background: t.live }} />
            <i style={{ background: t.attention }} />
          </span>
        </span>
      </span>

      <span className="theme-meta">
        <span className="theme-name">
          {theme.name}
          <ModeIcon size={11} />
        </span>
        <span className="theme-blurb">{theme.blurb}</span>
      </span>

      {active && (
        <span className="theme-check" aria-hidden="true">
          <Check size={12} />
        </span>
      )}
    </button>
  )
}
