import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Command,
  Eraser,
  FileCode2,
  GitBranch,
  History,
  LayoutList,
  Maximize2,
  NotebookPen,
  PanelLeft,
  PanelRight,
  Plus,
  Radio,
  RotateCw,
  Search,
  Settings2,
  Terminal,
  Wrench,
  X
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { terminals } from '../lib/terminals'
import { MOD, fuzzy } from '../lib/util'

interface Action {
  id: string
  label: string
  hint?: string
  icon: typeof Command
  run: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPalette)
  const store = useStore()

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const workspace = store.workspaces.find((w) => w.id === store.activeWorkspaceId) ?? null
  const activePaneId = workspace?.activePaneId ?? null

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [
      {
        id: 'new-workspace',
        label: 'New workspace',
        hint: `${MOD}T`,
        icon: Plus,
        run: () => store.openWizard('grid')
      },
      {
        id: 'swarm',
        label: 'New swarm — one prompt, many agents',
        icon: Radio,
        run: () => store.openWizard('swarm')
      },
      {
        id: 'resume',
        label: 'Resume a session',
        icon: History,
        run: () => store.setResumeOpen(true)
      },
      {
        id: 'board',
        label: 'Go to Board',
        icon: LayoutList,
        run: () => store.setSurface('board')
      },
      {
        id: 'vault',
        label: 'Go to Vault',
        icon: NotebookPen,
        run: () => store.setSurface('vault')
      },
      {
        id: 'grid',
        label: 'Go to Grid',
        icon: Terminal,
        run: () => store.setSurface('grid')
      },
      {
        id: 'conductor',
        label: store.conductorOpen ? 'Hide the conductor' : 'Send a message to panes',
        hint: `${MOD}J`,
        icon: Radio,
        run: () => store.toggleConductor()
      },
      {
        id: 'editor',
        label: 'Open the file editor',
        icon: FileCode2,
        run: () => store.toggleDock('editor')
      },
      {
        id: 'git',
        label: 'Open git changes',
        icon: GitBranch,
        run: () => store.toggleDock('git')
      },
      {
        id: 'tools',
        label: 'Open tools',
        icon: Wrench,
        run: () => store.toggleDock('tools')
      },
      {
        id: 'rail',
        label: store.railOpen ? 'Hide the workspace sidebar' : 'Show the workspace sidebar',
        hint: `${MOD}B`,
        icon: PanelLeft,
        run: () => store.toggleRail()
      },
      {
        id: 'dock',
        label: store.dockOpen ? 'Hide the side panel' : 'Show the side panel',
        icon: PanelRight,
        run: () => store.toggleDock()
      },
      {
        id: 'settings',
        label: 'Settings',
        hint: `${MOD},`,
        icon: Settings2,
        run: () => store.setSettingsOpen(true)
      }
    ]

    if (workspace) {
      list.splice(1, 0, {
        id: 'add-pane',
        label: 'Add a pane to this workspace',
        hint: `${MOD}D`,
        icon: Plus,
        run: () => store.addPane(workspace.id)
      })
      if (activePaneId) {
        list.push(
          {
            id: 'restart',
            label: 'Restart the focused session',
            icon: RotateCw,
            run: () => store.restartPane(activePaneId)
          },
          {
            id: 'clear',
            label: 'Clear the focused screen',
            icon: Eraser,
            run: () => terminals.clear(activePaneId)
          },
          {
            id: 'zoom',
            label: workspace.zoomedPaneId ? 'Back to the grid' : 'Fill the grid with this pane',
            hint: `${MOD}E`,
            icon: Maximize2,
            run: () =>
              store.zoomPane(workspace.id, workspace.zoomedPaneId ? null : activePaneId)
          },
          {
            id: 'close-pane',
            label: 'Close the focused pane',
            hint: `${MOD}W`,
            icon: X,
            run: () => store.closePane(workspace.id, activePaneId)
          }
        )
      }
      for (const pane of workspace.panes) {
        list.push({
          id: `focus-${pane.id}`,
          label: `Go to pane ${pane.name}`,
          hint: pane.title ?? undefined,
          icon: Terminal,
          run: () => store.focusPane(workspace.id, pane.id)
        })
      }
    }

    for (const w of store.workspaces) {
      if (w.id === store.activeWorkspaceId) continue
      list.push({
        id: `ws-${w.id}`,
        label: `Switch to ${w.name}`,
        hint: `${w.panes.length} panes`,
        icon: Terminal,
        run: () => store.setActiveWorkspace(w.id)
      })
    }

    return list
  }, [store, workspace, activePaneId])

  const results = useMemo(
    () => actions.filter((a) => fuzzy(query, a.label)).slice(0, 40),
    [actions, query]
  )

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  useEffect(() => {
    setCursor(0)
  }, [query])

  useEffect(() => {
    listRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results.length])

  if (!open) return null

  const commit = (index: number): void => {
    const action = results[index]
    if (!action) return
    setOpen(false)
    action.run()
  }

  return (
    <div className="scrim" data-align="top" onMouseDown={() => setOpen(false)}>
      <div
        className="palette"
        role="dialog"
        aria-label="Commands"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          <Search size={16} color="var(--text-dim)" />
          <input
            autoFocus
            value={query}
            placeholder="What do you want to do?"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(results.length - 1, c + 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(cursor)
              }
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <span className="kbd">esc</span>
        </div>

        <div className="palette-list" ref={listRef}>
          {results.length === 0 && (
            <div className="empty" style={{ padding: '28px 20px' }}>
              <strong>Nothing matches “{query}”.</strong>
            </div>
          )}
          {results.map((a, i) => {
            const Icon = a.icon
            return (
              <button
                className="palette-item"
                key={a.id}
                data-on={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => commit(i)}
              >
                <Icon size={15} />
                <span className="palette-item-label">{a.label}</span>
                {a.hint && <span className="palette-item-hint">{a.hint}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
