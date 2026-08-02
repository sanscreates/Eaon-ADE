import { useEffect } from 'react'
import { AlertTriangle, CircleAlert, Info, X } from 'lucide-react'
import { useStore } from '../store/useStore'

const ICON = {
  info: Info,
  attention: AlertTriangle,
  error: CircleAlert
}

/**
 * Transient activity, top-right of the stage. Informational notices clear
 * themselves; anything asking for a decision stays until you deal with it.
 */
export function Notices(): React.JSX.Element | null {
  const notices = useStore((s) => s.notices)
  const dismiss = useStore((s) => s.dismissNotice)

  useEffect(() => {
    const timers = notices
      .filter((n) => n.kind === 'info')
      .map((n) => window.setTimeout(() => dismiss(n.id), 6000))
    return () => timers.forEach(window.clearTimeout)
  }, [notices, dismiss])

  const shown = notices.slice(0, 4)
  if (!shown.length) return null

  return (
    <div className="notices" role="status" aria-live="polite">
      {shown.map((n) => {
        const Icon = ICON[n.kind]
        return (
          <div className="notice" data-kind={n.kind} key={n.id}>
            <Icon size={14} className="notice-icon" />
            <div className="notice-body">
              <div className="notice-title">{n.title}</div>
              <div className="notice-text">{n.text}</div>
            </div>
            <button className="icon-btn" onClick={() => dismiss(n.id)} aria-label="Dismiss">
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
