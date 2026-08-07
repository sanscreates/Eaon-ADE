import { Maximize2, Minimize2, X } from 'lucide-react'
import type { PaneSpec, Workspace } from '@shared/types'
import { useStore } from '../store/useStore'
import { PANE_DRAG } from './TerminalPane'

/**
 * The header and drag-to-swap mechanics a preview or diff pane needs, shared
 * with `TerminalPane` rather than duplicated by it.
 *
 * A terminal pane's header carries things only a shell has — a branch chip,
 * context-used, restart/clear/find — so it stays its own component. What
 * this shares is everything about being *a cell in the grid*: the same drag
 * payload, so a preview pane trades places with a terminal one exactly the
 * way two terminals do; the same close/zoom affordances; the same position
 * prop from `PaneGrid`. Duplicating roughly sixty lines of that per new pane
 * kind was the alternative, which is the point past which "just copy it" stops
 * being simpler than sharing it.
 */
export function SurfacePaneChrome({
  workspace,
  pane,
  index,
  style,
  carrying,
  over,
  onCarry,
  onOver,
  onSwap,
  icon,
  subtitle,
  actions,
  children
}: {
  workspace: Workspace
  pane: PaneSpec
  index: number
  style?: React.CSSProperties
  carrying?: boolean
  over?: boolean
  onCarry?: (id: string | null) => void
  onOver?: (id: string | null) => void
  onSwap?: (dragId: string) => void
  /** Shown before the name, in place of a terminal's status dot. */
  icon: React.ReactNode
  /** A short line after the name — a file's own name for a preview pane. */
  subtitle?: string
  /** Extra header buttons between the name and the close button. */
  actions?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const focusPane = useStore((s) => s.focusPane)
  const closePane = useStore((s) => s.closePane)
  const zoomPane = useStore((s) => s.zoomPane)

  const active = workspace.activePaneId === pane.id
  const zoomed = workspace.zoomedPaneId === pane.id

  return (
    <section
      className="pane"
      style={style}
      data-active={active}
      data-status="idle"
      data-pane-id={pane.id}
      data-carrying={carrying}
      data-over={over}
      onMouseDown={() => focusPane(workspace.id, pane.id)}
      aria-label={`Pane ${pane.name}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PANE_DRAG)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onOver?.(pane.id)
      }}
      onDragLeave={() => onOver?.(null)}
      onDrop={(e) => {
        const carried = e.dataTransfer.getData(PANE_DRAG)
        if (!carried) return
        e.preventDefault()
        e.stopPropagation()
        if (carried !== pane.id) onSwap?.(carried)
        onCarry?.(null)
        onOver?.(null)
      }}
    >
      <header
        className="pane-head"
        draggable={Boolean(onCarry)}
        onDragStart={(e) => {
          e.dataTransfer.setData(PANE_DRAG, pane.id)
          e.dataTransfer.effectAllowed = 'move'
          onCarry?.(pane.id)
        }}
        onDragEnd={() => {
          onCarry?.(null)
          onOver?.(null)
        }}
        title="Drag to swap this pane with another"
      >
        <span className="pane-surface-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="pane-index">{index + 1}</span>
        <span className="pane-label">
          <span className="pane-name">{pane.name}</span>
          {subtitle && <span className="pane-title">{subtitle}</span>}
        </span>

        <span className="pane-tools">
          {actions}
          <button
            className="icon-btn"
            onClick={() => zoomPane(workspace.id, zoomed ? null : pane.id)}
            title={zoomed ? 'Back to grid' : 'Fill the grid'}
            aria-label={zoomed ? 'Back to grid' : 'Fill the grid'}
          >
            {zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            className="icon-btn pane-kill"
            onClick={() => closePane(workspace.id, pane.id)}
            title="Close pane"
            aria-label="Close pane"
          >
            <X size={13} />
          </button>
        </span>
      </header>

      <div className="pane-surface-body">{children}</div>
    </section>
  )
}
