import { useEffect, useRef, useState } from 'react'
import { Bell, LayoutGrid, PanelLeft, PanelRight, Settings2 } from 'lucide-react'
import { useActiveWorkspace, useStore } from '../store/useStore'
import { shortPath } from '../lib/util'
import { Logo } from './Logo'
import { UsagePill } from './UsagePill'
import type { PanelKind } from '../store/useStore'

const PANELS: { id: PanelKind; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'vault', label: 'Vault' },
  { id: 'brain', label: 'Brain' },
  { id: 'stats', label: 'Stats' }
]

export function TitleBar(): React.JSX.Element {
  const railOpen = useStore((s) => s.railOpen)
  const dockOpen = useStore((s) => s.dockOpen)
  const toggleRail = useStore((s) => s.toggleRail)
  const toggleDock = useStore((s) => s.toggleDock)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const update = useStore((s) => s.update)
  const openPanel = useStore((s) => s.openPanel)
  const notices = useStore((s) => s.notices)
  const clearNotices = useStore((s) => s.clearNotices)
  const version = useStore((s) => s.appVersion)
  const home = useStore((s) => s.home)
  const workspace = useActiveWorkspace()

  const [fullscreen, setFullscreen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => window.eaon.win.onFullscreen(setFullscreen), [])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const padLeft = fullscreen || navigator.platform.toLowerCase().indexOf('mac') === -1 ? 12 : 88

  return (
    <header className="titlebar" style={{ ['--titlebar-pad-left' as string]: `${padLeft}px` }}>
      <button
        className="icon-btn"
        onClick={toggleRail}
        data-on={railOpen}
        title="Workspaces sidebar"
        aria-label="Toggle workspaces sidebar"
      >
        <PanelLeft size={15} />
      </button>

      <div className="titlebar-brand">
        <Logo size={16} />
        <span className="wordmark">eaon ade</span>
        <span className="titlebar-version">v{version}</span>
      </div>

      <div className="titlebar-center">
        {settingsOpen ? (
          <span className="crumb-active">Settings</span>
        ) : workspace ? (
          <>
            <span className="crumb-active">{workspace.name}</span>
            <span aria-hidden="true">›</span>
            <span className="crumb-path">{shortPath(workspace.cwd, home)}</span>
          </>
        ) : (
          <span className="crumb-path">No workspace open</span>
        )}
      </div>

      <div className="titlebar-actions">
        <UsagePill />
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            className="icon-btn"
            data-on={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            title="Board, Vault and Brain"
            aria-label="Open a panel"
          >
            <LayoutGrid size={15} />
          </button>
          {menuOpen && (
            <div className="pane-menu" style={{ top: 30, right: 0, minWidth: 150 }}>
              {PANELS.map((p) => (
                <button
                  key={p.id}
                  className="menu-item"
                  onClick={() => {
                    openPanel(p.id)
                    setMenuOpen(false)
                  }}
                >
                  {p.label}
                  {workspace?.kind === p.id && <span className="kbd">open</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="icon-btn has-badge"
          onClick={clearNotices}
          title={notices.length ? `${notices.length} unread — click to clear` : 'No new activity'}
          aria-label="Activity"
        >
          <Bell size={15} />
          {notices.length > 0 && <span className="badge-dot">{Math.min(notices.length, 99)}</span>}
        </button>

        {/*
          Settings, always — the dot is a notice, not a second button.

          This used to re-show the update card while one was waiting, on the
          reasoning that the card was the more useful thing to hand back. But
          the condition it tested is not changed by pressing it, so the second
          press did the same as the first and Settings could not be reached
          from here at all until the update was installed. The update is not
          lost by leaving: the dot says it is there, About says which version,
          and Show brings the card back.
        */}
        <button
          className="icon-btn has-badge"
          data-on={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
          title={
            update.phase === 'ready'
              ? `Settings — version ${update.version} is ready to install`
              : 'Settings'
          }
          aria-label="Settings"
        >
          <Settings2 size={15} />
          {update.phase === 'ready' && <span className="update-dot" />}
        </button>

        <button
          className="icon-btn"
          data-on={dockOpen}
          onClick={() => toggleDock()}
          title="Side panel"
          aria-label="Toggle side panel"
        >
          <PanelRight size={15} />
        </button>
      </div>
    </header>
  )
}
