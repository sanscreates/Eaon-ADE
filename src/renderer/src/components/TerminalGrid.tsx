import { useEffect } from 'react'
import { Plus } from 'lucide-react'
import { gridColumns, paneKind, type Workspace } from '@shared/types'
import { pendingPrompts, useStore } from '../store/useStore'
import { TrialBar } from './TrialBar'
import { terminals } from '../lib/terminals'
import { TerminalPane } from './TerminalPane'
import { PreviewGridPane } from './PreviewGridPane'
import { DiffGridPane } from './DiffGridPane'
import { PaneGrid } from './PaneGrid'
import { Conductor } from './Conductor'
import { Notices } from './Notices'

/** Agents need a moment to boot before they can read a typed prompt. */
const PROMPT_DELAY_MS = 3200

export function TerminalGrid({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const addPane = useStore((s) => s.addPane)
  const notify = useStore((s) => s.notify)
  const conductorOpen = useStore((s) => s.conductorOpen)

  const zoomed = workspace.zoomedPaneId
  const visible = zoomed ? workspace.panes.filter((p) => p.id === zoomed) : workspace.panes
  const cols = zoomed ? 1 : gridColumns(workspace.panes.length)

  // Re-fit after any layout change; xterm needs a nudge once the DOM settles.
  useEffect(() => {
    const id = window.setTimeout(() => terminals.fitAll(), 60)
    return () => window.clearTimeout(id)
  }, [workspace.panes.length, zoomed])

  // Deliver the workspace's opening prompt once the agents have started.
  useEffect(() => {
    const prompt = pendingPrompts.get(workspace.id)
    if (!prompt) return
    pendingPrompts.delete(workspace.id)
    const paneIds = workspace.panes.map((p) => p.id)
    notify({
      kind: 'info',
      title: 'Opening prompt queued',
      text: `Sending to ${paneIds.length} pane${paneIds.length === 1 ? '' : 's'} once the agents are up.`,
      workspaceId: workspace.id
    })
    const id = window.setTimeout(() => {
      for (const paneId of paneIds) terminals.send(paneId, `${prompt}\r`)
    }, PROMPT_DELAY_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id])

  if (workspace.panes.length === 0) {
    return (
      <div className="grid-stage">
        <div className="empty" style={{ height: '100%' }}>
          <strong>No panes left in this workspace.</strong>
          <span>Add one to get a shell back.</span>
          <button className="btn btn-primary" onClick={() => addPane(workspace.id)}>
            <Plus size={14} />
            Add a pane
          </button>
        </div>
      </div>
    )
  }

  return (
    /*
     * Wrapped rather than nested: the grid inside is `height: 100%`, so a bar
     * placed alongside it would push it straight into overflow. The wrapper is
     * the flex column that lets the bar take its own height and the grid have
     * the rest. TrialBar renders nothing at all when this is not a trial.
     */
    <div className="grid-wrap">
      <TrialBar workspaceId={workspace.id} />
      <div className="grid-stage" data-conductor={conductorOpen}>
        {zoomed ? (
          <div className="grid" data-zoomed="true">
            {visible.map((pane) => {
              const props = {
                key: pane.id,
                workspace,
                pane,
                index: workspace.panes.findIndex((p) => p.id === pane.id)
              }
              const kind = paneKind(pane)
              if (kind === 'preview') return <PreviewGridPane {...props} />
              if (kind === 'diff') return <DiffGridPane {...props} />
              return <TerminalPane {...props} />
            })}
          </div>
        ) : (
          <PaneGrid workspace={workspace} cols={cols} />
        )}
        <Notices />
        <Conductor workspace={workspace} />
      </div>
    </div>
  )
}
