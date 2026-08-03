import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  stack: string | null
}

/**
 * The last thing standing between a bug and a black window.
 *
 * React unmounts the entire tree when a render or lifecycle throws and nothing
 * catches it. With the root gone the page is just `body`, which the theme
 * paints in its darkest ink — so a single bad render reads as "the app
 * crashed and something black covered it", with no way back and nothing said
 * about why. Catching it keeps the window alive, shows what happened, and
 * offers the one action that actually helps.
 *
 * Terminals survive a reload: the shells belong to the main process, and the
 * panes reconnect to them by id.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Goes to the terminal that launched the app, and to the DevTools console.
    console.error('[eaon] interface error:', error, info.componentStack)
    this.setState({ stack: info.componentStack ?? null })
  }

  private details(): string {
    const { error, stack } = this.state
    return [`${error?.name ?? 'Error'}: ${error?.message ?? ''}`, error?.stack, stack]
      .filter(Boolean)
      .join('\n\n')
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 32,
          // The title bar is draggable everywhere else; this screen replaces it.
          WebkitAppRegion: 'drag',
          background: 'var(--ink-000, #0b0b0d)',
          color: 'var(--text-hi, #e8e8ea)',
          fontFamily: 'var(--font-ui, system-ui, sans-serif)',
          textAlign: 'center'
        } as React.CSSProperties}
      >
        <div style={{ maxWidth: 560, display: 'grid', gap: 10 }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-dim, #8a8a92)'
            }}
          >
            Eaon ADE
          </p>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>The interface stopped.</h1>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-mid, #b4b4bc)' }}>
            Something went wrong drawing the window. Your shells are still running in the
            background — reloading reconnects the panes to them.
          </p>
          <pre
            style={{
              margin: '4px 0 0',
              padding: 12,
              maxHeight: 200,
              overflow: 'auto',
              textAlign: 'left',
              fontSize: 11,
              lineHeight: 1.5,
              borderRadius: 8,
              border: '1px solid var(--ink-400, #2a2a30)',
              background: 'var(--ink-100, #131317)',
              color: 'var(--text-dim, #8a8a92)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              WebkitAppRegion: 'no-drag'
            } as React.CSSProperties}
          >
            {`${error.name}: ${error.message}`}
          </pre>
        </div>

        <div style={{ display: 'flex', gap: 8, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: 'var(--accent, #6a7cff)',
              color: 'var(--accent-ink, #fff)'
            }}
          >
            Reload the window
          </button>
          <button
            onClick={() => void navigator.clipboard.writeText(this.details())}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              borderRadius: 8,
              cursor: 'pointer',
              border: '1px solid var(--ink-400, #2a2a30)',
              background: 'transparent',
              color: 'var(--text-mid, #b4b4bc)'
            }}
          >
            Copy details
          </button>
        </div>
      </div>
    )
  }
}
