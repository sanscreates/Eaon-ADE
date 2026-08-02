import { Command, History, Plus, Terminal, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { MOD } from '../lib/util'

export function WorkspaceRail(): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeId = useStore((s) => s.activeWorkspaceId)
  const notices = useStore((s) => s.notices)
  const setActive = useStore((s) => s.setActiveWorkspace)
  const closeWorkspace = useStore((s) => s.closeWorkspace)
  const openWizard = useStore((s) => s.openWizard)
  const setPalette = useStore((s) => s.setPalette)
  const setResumeOpen = useStore((s) => s.setResumeOpen)
  const confirmClose = useStore((s) => s.settings.confirmClose)

  const onClose = (id: string, name: string, panes: number): void => {
    if (confirmClose && panes > 0) {
      const ok = window.confirm(`Close ${name}? ${panes} session${panes === 1 ? '' : 's'} will end.`)
      if (!ok) return
    }
    closeWorkspace(id)
  }

  return (
    <nav className="rail" aria-label="Workspaces">
      <div className="rail-head">
        <span className="eyebrow">Workspaces</span>
        <span className="rail-count">{workspaces.length}</span>
        <button
          className="icon-btn"
          onClick={() => openWizard('grid')}
          title={`New workspace (${MOD}T)`}
          aria-label="New workspace"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="rail-list">
        {workspaces.length === 0 && (
          <p style={{ padding: '10px 10px 0', fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
            Nothing open yet. Start one with {MOD}T.
          </p>
        )}
        {workspaces.map((w) => {
          const attention = notices.filter((n) => n.workspaceId === w.id && n.kind === 'attention')
          return (
            <button
              key={w.id}
              className={`ws-item hue-${w.hue}`}
              data-active={w.id === activeId}
              onClick={() => setActive(w.id)}
              title={w.cwd}
            >
              <span className="ws-glyph">
                <Terminal size={15} />
              </span>
              <span className="ws-name">{w.name}</span>
              {attention.length > 0 && <span className="ws-attention">{attention.length}</span>}
              <span className="ws-count">{w.panes.length}</span>
              <span
                className="icon-btn ws-close"
                role="button"
                tabIndex={0}
                aria-label={`Close ${w.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(w.id, w.name, w.panes.length)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onClose(w.id, w.name, w.panes.length)
                  }
                }}
              >
                <X size={12} />
              </span>
            </button>
          )
        })}
      </div>

      <div className="rail-foot">
        <button className="rail-action" onClick={() => setResumeOpen(true)}>
          <History size={14} />
          Resume a session
        </button>
        <button className="rail-action" onClick={() => setPalette(true)}>
          <Command size={14} />
          Commands
          <span className="kbd" style={{ marginLeft: 'auto' }}>
            {MOD}K
          </span>
        </button>
      </div>
    </nav>
  )
}
