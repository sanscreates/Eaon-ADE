import { useCallback, useEffect, useRef, useState } from 'react'
import { Compass, FileCode2, GitBranch, Wrench } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { useStore, type DockTab } from '../store/useStore'
import { terminals } from '../lib/terminals'
import { BrowserPanel } from './BrowserPanel'
import { EditorPanel } from './EditorPanel'
import { GitPanel } from './GitPanel'
import { ToolsPanel } from './ToolsPanel'

const TABS: { id: DockTab; label: string; icon: typeof Compass }[] = [
  { id: 'browser', label: 'Browser', icon: Compass },
  { id: 'editor', label: 'Editor', icon: FileCode2 },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'tools', label: 'Tools', icon: Wrench }
]

export function SideDock({ workspace }: { workspace: Workspace | null }): React.JSX.Element {
  const tab = useStore((s) => s.dockTab)
  const width = useStore((s) => s.dockWidth)
  const setWidth = useStore((s) => s.setDockWidth)
  const setDockTab = useStore((s) => s.setDockTab)
  const home = useStore((s) => s.home)

  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onMove = useCallback(
    (e: MouseEvent) => {
      setWidth(startW.current + (startX.current - e.clientX))
    },
    [setWidth]
  )

  useEffect(() => {
    if (!dragging) return
    const onUp = (): void => {
      setDragging(false)
      terminals.fitAll()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, onMove])

  const cwd = workspace?.cwd ?? home

  return (
    <>
      <div
        className="dock-resizer"
        data-dragging={dragging}
        role="separator"
        aria-label="Resize side panel"
        onMouseDown={(e) => {
          startX.current = e.clientX
          startW.current = width
          setDragging(true)
        }}
      />
      <aside className="dock" style={{ width, flexBasis: width }}>
        <div className="dock-tabs">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button
                className="dock-tab"
                key={t.id}
                data-on={tab === t.id}
                title={t.label}
                onClick={() => setDockTab(t.id)}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="dock-body">
          {tab === 'editor' && <EditorPanel cwd={cwd} key={cwd} />}
          {tab === 'git' && <GitPanel cwd={cwd} key={cwd} />}
          {tab === 'tools' && <ToolsPanel workspace={workspace} />}
          {/*
            The browser stays mounted and is hidden instead of unmounted. A
            <webview> reloads its page from scratch when it re-attaches, so
            switching to Git and back would otherwise cost you your scroll
            position, your form, and whatever route a single-page app was on.
          */}
          <div className="dock-slot" hidden={tab !== 'browser'}>
            <BrowserPanel />
          </div>
        </div>
      </aside>
    </>
  )
}
