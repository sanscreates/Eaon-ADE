import { Brain, Command, Flame, History, LayoutList, NotebookPen, Plus, Terminal, X } from 'lucide-react'
import { PANEL_KINDS, PANEL_LABEL, type Workspace, type WorkspaceKind } from '@shared/types'
import { useStore } from '../store/useStore'
import { MOD, basename } from '../lib/util'

/** The glyph that says what a workspace is, at a glance, in the rail. */
const GLYPH: Record<WorkspaceKind, typeof Terminal> = {
  terminals: Terminal,
  board: LayoutList,
  vault: NotebookPen,
  brain: Brain,
  stats: Flame
}

export function WorkspaceRail(): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeId = useStore((s) => s.activeWorkspaceId)
  const notices = useStore((s) => s.notices)
  const setActive = useStore((s) => s.setActiveWorkspace)
  const closeWorkspace = useStore((s) => s.closeWorkspace)
  const openWizard = useStore((s) => s.openWizard)
  const openPanel = useStore((s) => s.openPanel)
  const setPalette = useStore((s) => s.setPalette)
  const setResumeOpen = useStore((s) => s.setResumeOpen)
  const confirmClose = useStore((s) => s.settings.confirmClose)

  const shells = workspaces.filter((w) => w.kind === 'terminals')
  const panels = workspaces.filter((w) => w.kind !== 'terminals')
  const unopened = PANEL_KINDS.filter((kind) => !panels.some((w) => w.kind === kind))

  const onClose = (w: Workspace): void => {
    // Only a workspace with running shells is worth asking about; closing the
    // Board loses nothing, because its contents do not live in the workspace.
    if (confirmClose && w.panes.length > 0) {
      const ok = window.confirm(
        `Close ${w.name}? ${w.panes.length} session${w.panes.length === 1 ? '' : 's'} will end.`
      )
      if (!ok) return
    }
    closeWorkspace(w.id)
  }

  const item = (w: Workspace): React.JSX.Element => {
    const Icon = GLYPH[w.kind] ?? Terminal
    const attention = notices.filter((n) => n.workspaceId === w.id && n.kind === 'attention')
    const panel = w.kind !== 'terminals'
    return (
      <button
        key={w.id}
        className={`ws-item hue-${w.hue}`}
        data-active={w.id === activeId}
        data-panel={panel}
        onClick={() => setActive(w.id)}
        title={w.cwd}
      >
        <span className="ws-glyph">
          <Icon size={15} />
        </span>
        <span className="ws-label">
          <span className="ws-name">{w.name}</span>
          {/* A panel says which project it is pointed at; a folder workspace is
              already named after its folder and would just repeat itself. */}
          {panel && <span className="ws-where">{basename(w.cwd) || w.cwd}</span>}
        </span>
        {attention.length > 0 && <span className="ws-attention">{attention.length}</span>}
        {!panel && <span className="ws-count">{w.panes.length}</span>}
        <span
          className="icon-btn ws-close"
          role="button"
          tabIndex={0}
          aria-label={`Close ${w.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onClose(w)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              onClose(w)
            }
          }}
        >
          <X size={12} />
        </span>
      </button>
    )
  }

  return (
    <nav className="rail" aria-label="Workspaces">
      <div className="rail-head">
        <span className="eyebrow">Workspaces</span>
        <span className="rail-count">{shells.length}</span>
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
        {shells.length === 0 && (
          <p className="rail-empty">Nothing open yet. Start one with {MOD}T.</p>
        )}
        {shells.map(item)}

        {panels.length > 0 && (
          <>
            <div className="rail-group">
              <span className="eyebrow">Open panels</span>
            </div>
            {panels.map(item)}
          </>
        )}
      </div>

      <div className="rail-foot">
        {/*
          Only what is not already open. Opening a panel is the same act as
          opening a workspace — it joins the list above — so a chip that stayed
          behind would be the same thing named twice on one screen. When all
          three are open this row is gone and the list is the whole story.
        */}
        {unopened.length > 0 && (
          <div className="rail-panels">
            {unopened.map((kind) => {
              const Icon = GLYPH[kind]
              return (
                <button
                  className="rail-chip"
                  key={kind}
                  onClick={() => openPanel(kind)}
                  title={`Open the ${PANEL_LABEL[kind]}`}
                >
                  <Icon size={13} />
                  {PANEL_LABEL[kind]}
                </button>
              )
            })}
          </div>
        )}

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
