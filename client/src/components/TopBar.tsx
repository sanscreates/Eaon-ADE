import { useEffect, useRef, useState } from 'react';
import { useProjects } from '../store/projects';
import { useAgents } from '../store/agents';
import { useUi } from '../store/ui';
import { useConnection } from '../lib/bootstrap';
import { useLayout } from '../store/layout';
import { leafCount } from '../lib/layoutTree';
import { applyPaneTemplate } from '../lib/spawn';
import { cls } from '../lib/utils';
import { useGit } from '../store/git';
import { useSettings } from '../store/settings';
import { ClaudeUsagePill } from './ClaudeUsage';
import { IconLayout, IconPanelLeft, IconPlus, IconSearch, IconSettings, Logo } from './Icons';

const TEMPLATES = [1, 2, 4, 6, 8, 9, 12, 16];

export function TopBar() {
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const openNewSession = useUi((s) => s.openNewSession);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const branch = useGit((s) => (s.status?.isRepo ? s.status.branch : undefined));
  const connected = useConnection((s) => s.connected);
  const panes = useLayout((s) => leafCount(s.root));
  const shellCommand = useAgents((s) => s.byId('shell')?.command ?? '/bin/zsh');
  const openSettings = useSettings((s) => s.openSettings);
  const [templateOpen, setTemplateOpen] = useState(false);
  const templateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!templateOpen) return;
    const close = (e: MouseEvent) => {
      if (!templateRef.current?.contains(e.target as Node)) setTemplateOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [templateOpen]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className={cls('icon-btn', sidebarOpen && 'icon-btn-on')}
          title="Toggle sidebar (⌘B)"
          onClick={toggleSidebar}
        >
          <IconPanelLeft size={15} />
        </button>
        <span className="logo">
          <Logo size={19} />
        </span>
        <span className="topbar-app">Eaon ADE</span>
      </div>

      {/* Centred breadcrumb: which project, which branch. The window title in
          a desktop app should say where you are, not just what app this is. */}
      {active && (
        <div className="topbar-crumbs">
          <span className="crumb crumb-strong" title={active.path}>{active.name}</span>
          {branch && (
            <>
              <span className="crumb-sep">›</span>
              <span className="crumb">{branch}</span>
            </>
          )}
        </div>
      )}

      <div className="topbar-right">
        <span className={cls('conn-dot', connected ? 'conn-on' : 'conn-off')} title={connected ? 'Connected to Eaon server' : 'Disconnected — retrying'} />
        <div className="template-menu" ref={templateRef}>
          <button className="btn btn-sm" onClick={() => setTemplateOpen((v) => !v)}>
            <IconLayout size={13} /> Layout · {panes}
          </button>
          {templateOpen && (
            <div className="dropdown">
              <div className="dropdown-label">Pane templates</div>
              {TEMPLATES.map((n) => (
                <button
                  key={n}
                  className="dropdown-item"
                  onClick={() => {
                    setTemplateOpen(false);
                    if (active) {
                      applyPaneTemplate(n, { cwd: active.path, projectId: active.id, shellCommand });
                    }
                  }}
                  disabled={!active}
                >
                  <TemplateGlyph n={n} /> {n} {n === 1 ? 'pane' : 'panes'}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* A command glyph next to a ⌘K chip read as "⌘ ⌘K". The magnifier
            says what the button does; the chip says how to skip it. */}
        <button className="btn btn-sm" onClick={() => setPaletteOpen(true)} title="Command palette (⌘K)">
          <IconSearch size={13} /> <kbd>⌘K</kbd>
        </button>
        <ClaudeUsagePill />
        <button className="icon-btn" onClick={() => openSettings()} title="Settings (⌘,)">
          <IconSettings size={15} />
        </button>
        <button className="btn btn-accent btn-sm" onClick={() => openNewSession()} title="New agent session (⌥T)">
          <IconPlus size={13} /> New Agent
        </button>
      </div>
    </header>
  );
}

function TemplateGlyph({ n }: { n: number }) {
  const cells = n === 1 ? 1 : n <= 4 ? 4 : n <= 9 ? 9 : 16;
  return (
    <span className={cls('template-glyph', `tg-${cells}`)}>
      {Array.from({ length: cells }).map((_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}
