import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  RotateCw,
  Server,
  X
} from 'lucide-react'
import { useStore } from '../store/useStore'

/**
 * The preview browser.
 *
 * This is not a general web browser and does not pretend to be one — it is the
 * window onto whatever the agents in the next pane are building. That shapes
 * every decision here: it opens on a running dev server rather than a home
 * page, the address bar takes a bare port, and there is no search box, because
 * typing into one would quietly send your keystrokes to a search engine in an
 * app that otherwise talks to nobody.
 */

/** The bits of Electron's <webview> this panel drives. */
interface WebviewEl extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  getURL(): string
  loadURL(url: string): Promise<void>
}

interface FailEvent extends Event {
  errorCode: number
  errorDescription: string
  validatedURL: string
  isMainFrame: boolean
}

interface NavEvent extends Event {
  url: string
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$|\?|#)/i

/**
 * Turn what someone typed into an address, or nothing.
 *
 * Deliberately never falls back to a web search: a preview panel that silently
 * posted every mistyped word to a search engine would break the promise the
 * rest of the app makes about the network.
 */
export function toUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (/^(https?|file):\/\//i.test(raw)) return raw
  // A bare port is the common case here: "5173" means the dev server.
  if (/^\d{2,5}$/.test(raw)) return `http://localhost:${raw}`
  if (LOOPBACK.test(raw)) return `http://${raw}`
  // host:port, or anything with a dot that could be a domain.
  if (/^[\w-]+:\d+(\/|$|\?|#)/.test(raw)) return `http://${raw}`
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$|\?|#)/.test(raw)) return `https://${raw}`
  return null
}

export function BrowserPanel(): React.JSX.Element {
  const home = useStore((s) => s.settings.browserHome)
  const update = useStore((s) => s.updateSettings)

  const viewRef = useRef<WebviewEl | null>(null)
  const [address, setAddress] = useState(home)
  const [current, setCurrent] = useState(home)
  const [loading, setLoading] = useState(false)
  const [back, setBack] = useState(false)
  const [forward, setForward] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ports, setPorts] = useState<number[]>([])
  /**
   * True while the address bar holds something you typed rather than the page's
   * own URL. A ref, not state: it changes on every keystroke and nothing on
   * screen depends on it, so re-rendering for it would be wasted work.
   */
  const editing = useRef(false)

  const scanPorts = useCallback(() => {
    void window.eaon.browser.devPorts().then(setPorts)
  }, [])

  useEffect(() => {
    scanPorts()
    // Dev servers come and go while you work; a slow poll keeps the chips true
    // without the panel feeling like it is doing something.
    const id = window.setInterval(scanPorts, 8000)
    return () => window.clearInterval(id)
  }, [scanPorts])

  const go = useCallback(
    (raw: string) => {
      const url = toUrl(raw)
      if (!url) {
        setError('That is not an address. Try localhost:5173, a port, or a full URL.')
        return
      }
      setError(null)
      editing.current = false
      setAddress(url)
      setCurrent(url)
      update({ browserHome: url })
      void viewRef.current?.loadURL(url).catch(() => undefined)
    },
    [update]
  )

  // The webview is a custom element, so its events are plain DOM events rather
  // than React props and have to be wired by hand.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const sync = (): void => {
      try {
        setBack(view.canGoBack())
        setForward(view.canGoForward())
      } catch {
        /* the guest may not be attached yet */
      }
    }

    const onStart = (): void => {
      setLoading(true)
      setError(null)
    }
    const onStop = (): void => {
      setLoading(false)
      sync()
    }
    const onNavigate = (e: Event): void => {
      const url = (e as NavEvent).url
      setCurrent(url)
      // Never overwrite half-typed text: a page that redirects while you are
      // mid-address would otherwise yank the field out from under you.
      if (!editing.current) setAddress(url)
      sync()
    }
    const onFail = (e: Event): void => {
      const fail = e as FailEvent
      // Sub-resources fail all the time on a half-built page; only a failed
      // main frame means the address did not load.
      if (!fail.isMainFrame) return
      // -3 is an aborted load, which is what a redirect or a fast retype looks
      // like. Reporting it would flash an error on perfectly normal navigation.
      if (fail.errorCode === -3) return
      setLoading(false)
      setError(
        fail.errorCode === -102 || fail.errorCode === -105
          ? `Nothing is answering at ${fail.validatedURL}. Is the dev server running?`
          : `${fail.errorDescription || 'Could not load that page'} (${fail.errorCode})`
      )
    }

    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-navigate', onNavigate)
    view.addEventListener('did-navigate-in-page', onNavigate)
    view.addEventListener('did-fail-load', onFail)
    return () => {
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-navigate', onNavigate)
      view.removeEventListener('did-navigate-in-page', onNavigate)
      view.removeEventListener('did-fail-load', onFail)
    }
  }, [])

  return (
    <div className="browser">
      <div className="browser-bar">
        <button
          className="icon-btn"
          disabled={!back}
          onClick={() => viewRef.current?.goBack()}
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          className="icon-btn"
          disabled={!forward}
          onClick={() => viewRef.current?.goForward()}
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => (loading ? viewRef.current?.stop() : viewRef.current?.reload())}
          title={loading ? 'Stop' : 'Reload'}
          aria-label={loading ? 'Stop' : 'Reload'}
        >
          {loading ? <X size={14} /> : <RotateCw size={14} />}
        </button>

        <input
          className="browser-address mono"
          value={address}
          spellCheck={false}
          placeholder="localhost:5173"
          aria-label="Address"
          onChange={(e) => {
            editing.current = true
            setAddress(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(address)
            if (e.key === 'Escape') {
              editing.current = false
              setAddress(current)
              setError(null)
              e.currentTarget.blur()
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => {
            // Abandoned edits revert, so the bar always agrees with the page.
            if (!editing.current) return
            editing.current = false
            setAddress(current)
          }}
        />

        <button
          className="icon-btn"
          onClick={() => window.eaon.sys.openExternal(current)}
          disabled={!/^https?:\/\//i.test(current)}
          title="Open in your browser"
          aria-label="Open in your browser"
        >
          <ExternalLink size={14} />
        </button>
      </div>

      {ports.length > 0 && (
        <div className="browser-ports">
          <Server size={11} aria-hidden="true" />
          <span className="browser-ports-label">running</span>
          {ports.map((port) => {
            const url = `http://localhost:${port}`
            return (
              <button
                className="chip browser-port"
                key={port}
                data-on={current.startsWith(url)}
                onClick={() => go(url)}
                title={url}
              >
                :{port}
              </button>
            )
          })}
        </div>
      )}

      <div className="browser-view">
        {/* Attributes the custom element reads at attach time, so they are set
            here rather than through React state. */}
        <webview
          ref={viewRef as never}
          src={home}
          partition="persist:preview"
          allowpopups={undefined}
          style={{ width: '100%', height: '100%', display: 'flex' }}
        />
        {loading && <span className="browser-loading" aria-hidden="true" />}
        {error && (
          <div className="browser-error" role="alert">
            <strong>{error}</strong>
            <div className="browser-error-actions">
              <button className="btn" onClick={() => go(address)}>
                Try again
              </button>
              {ports.length > 0 && (
                <button className="btn" onClick={() => go(`http://localhost:${ports[0]}`)}>
                  Open :{ports[0]}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
