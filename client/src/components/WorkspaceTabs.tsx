import { useEffect, useRef, useState } from 'react';
import { useWorkspaces, kindOf, KIND_LABEL, type WorkspaceTab, type WorkspaceTabKind } from '../store/workspaces';
import { useLayout } from '../store/layout';
import { useAgents } from '../store/agents';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { useBrowser, prettyUrl } from '../store/browser';
import { useUi } from '../store/ui';
import { leaves } from '../lib/layoutTree';
import { spawnAgent } from '../lib/spawn';
import { cls } from '../lib/utils';
import { AgentLogo, hasAgentLogo } from './AgentLogos';
import { ContextMenu, MenuHeader, MenuItem, MenuSep, useContextMenu } from './ContextMenu';
import {
  IconBoard,
  IconEdit,
  IconFolder,
  IconGitBranch,
  IconGitPullRequest,
  IconGlobe,
  IconMemory,
  IconPlus,
  IconSettings,
  IconSwarm,
  IconTerminal,
  IconTrash,
} from './Icons';

/* ═══════════════════════════════════════════════════════════════════════════
   Workspace tab strip — browser tabs for everything, not just terminals.
   Click to switch, double-click to rename, right-click for the rest, drag to
   reorder. The "+" opens any kind of content: a terminal, an agent, a browser
   page, or one of the project panels — this is the app's one way in, now that
   there is no side dock duplicating it.
   ═══════════════════════════════════════════════════════════════════════════ */

const KIND_ICON: Record<Exclude<WorkspaceTabKind, 'grid' | 'browser'>, (p: { size?: number }) => JSX.Element> = {
  files: IconFolder,
  editor: IconEdit,
  git: IconGitBranch,
  board: IconBoard,
  pulls: IconGitPullRequest,
  swarm: IconSwarm,
  memory: IconMemory,
};

export function WorkspaceTabs() {
  const tabs = useWorkspaces((s) => s.tabs);
  if (tabs.length === 0) return null;
  return (
    <div className="wt-strip">
      {/* Scrolling is scoped to the tab list, not the whole strip — the "+"
          menu needs an ancestor without overflow clipping to open into, and
          mixing overflow-x: auto with overflow-y: visible on one element
          isn't possible (the latter gets coerced to auto too). */}
      <div className="wt-tabs-scroll" role="tablist">
        {tabs.map((t, i) => (
          <Tab key={t.id} tab={t} index={i} />
        ))}
      </div>
      <NewTabMenu />
    </div>
  );
}

function TabIcon({ tab }: { tab: WorkspaceTab }) {
  const kind = kindOf(tab);
  const browserTab = useBrowser((s) => (tab.browserTabId ? s.tab(tab.browserTabId) : null));

  if (kind === 'browser') {
    if (browserTab?.loading) return <span className="wt-spinner" />;
    if (browserTab?.favicon) {
      return (
        <img
          className="wt-favicon"
          src={browserTab.favicon}
          alt=""
          referrerPolicy="no-referrer"
          onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
        />
      );
    }
    return <IconGlobe size={12} />;
  }
  if (kind === 'grid') return <IconTerminal size={12} />;
  const Icon = KIND_ICON[kind];
  return <Icon size={12} />;
}

function Tab({ tab, index }: { tab: WorkspaceTab; index: number }) {
  const activeId = useWorkspaces((s) => s.activeId);
  const switchTo = useWorkspaces((s) => s.switchTo);
  const closeTab = useWorkspaces((s) => s.closeTab);
  const renameTab = useWorkspaces((s) => s.renameTab);
  const moveTab = useWorkspaces((s) => s.moveTab);
  const kind = kindOf(tab);
  const isGrid = kind === 'grid';
  const isBrowser = kind === 'browser';

  // The active tab's tree changes live; background tabs report from storage.
  const liveCount = useLayout((s) =>
    isGrid && tab.id === activeId ? leaves(s.root).filter((l) => l.sessionId).length : -1,
  );
  const count = liveCount >= 0 ? liveCount : isGrid ? leaves(tab.root).filter((l) => l.sessionId).length : 0;

  // Browser tabs borrow their label from the page, the way a real browser
  // tab does; other kinds get a fixed name; grid tabs keep the user's own.
  const browserTab = useBrowser((s) => (tab.browserTabId ? s.tab(tab.browserTabId) : null));
  const displayName = isBrowser
    ? browserTab?.title || (browserTab?.url ? prettyUrl(browserTab.url) : null) || 'New Tab'
    : isGrid
      ? tab.name
      : KIND_LABEL[kind];

  const isActive = tab.id === activeId;
  const [renaming, setRenaming] = useState(false);
  const [dropSide, setDropSide] = useState<'before' | 'after' | null>(null);
  const menu = useContextMenu();

  const commitRename = (value: string) => {
    setRenaming(false);
    renameTab(tab.id, value);
  };

  /**
   * Closing a tab kills whatever is running in it, so it asks first — and says
   * how many sessions it is about to stop, because that is the part you cannot
   * undo. A tab with nothing running still asks, so "close" means one thing.
   */
  const confirmClose = (scope: 'this' | 'others') => {
    menu.close();
    const others = useWorkspaces.getState().tabs.filter((t) => t.id !== tab.id);
    const otherSessions = others.reduce(
      (n, t) => n + leaves(t.root).filter((l) => l.sessionId).length,
      0,
    );
    const doomed = scope === 'this' ? count : otherSessions;
    const what = scope === 'this' ? `“${displayName}”` : `${others.length} other tab${others.length === 1 ? '' : 's'}`;
    useUi.getState().askConfirm({
      title: scope === 'this' ? 'Close tab?' : 'Close other tabs?',
      body: doomed
        ? `${what} will close and ${doomed} running session${doomed === 1 ? '' : 's'} will be stopped.`
        : `${what} will close. Nothing is running in ${scope === 'this' ? 'it' : 'them'}.`,
      confirmLabel: scope === 'this' ? 'Close tab' : 'Close others',
      danger: true,
      onConfirm: () => {
        if (scope === 'this') closeTab(tab.id);
        else useWorkspaces.getState().closeOtherTabs(tab.id);
      },
    });
  };

  return (
    <div
      className={cls('wt-tab', isActive && 'wt-active', dropSide && `wt-drop-${dropSide}`)}
      role="tab"
      aria-selected={isActive}
      draggable={!renaming}
      onClick={() => switchTo(tab.id)}
      onDoubleClick={() => isGrid && setRenaming(true)}
      onContextMenu={menu.onContextMenu}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/eaon-tab', tab.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/eaon-tab')) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        setDropSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
      }}
      onDragLeave={() => setDropSide(null)}
      onDrop={(e) => {
        e.preventDefault();
        setDropSide(null);
        const id = e.dataTransfer.getData('text/eaon-tab');
        if (id && id !== tab.id) moveTab(id, dropSide === 'after' ? index + 1 : index);
      }}
      title={
        isGrid
          ? `${tab.name} — ${count} session${count === 1 ? '' : 's'}. Double-click to rename, right-click for more.`
          : displayName
      }
    >
      <span className="wt-icon">
        <TabIcon tab={tab} />
      </span>
      {renaming ? (
        <input
          className="wt-rename"
          defaultValue={tab.name}
          autoFocus
          onFocus={(e) => e.target.select()}
          onBlur={(e) => commitRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setRenaming(false);
          }}
          onClick={(e) => e.stopPropagation()}
          maxLength={40}
          spellCheck={false}
        />
      ) : (
        <span className="wt-name">{displayName}</span>
      )}
      {isGrid && count > 0 && <span className="wt-count">{count}</span>}

      <ContextMenu point={menu.point} onClose={menu.close}>
        <MenuHeader>{isGrid ? 'Workspace' : KIND_LABEL[kind]}</MenuHeader>
        {isGrid && (
          <MenuItem
            icon={<IconEdit size={12} />}
            onClick={() => {
              menu.close();
              setRenaming(true);
            }}
          >
            Rename…
          </MenuItem>
        )}
        <MenuItem
          icon={<IconPlus size={12} />}
          hint="⌘T"
          onClick={() => {
            menu.close();
            useWorkspaces.getState().addTab();
          }}
        >
          New tab
        </MenuItem>
        <MenuSep />
        <MenuItem danger icon={<IconTrash size={12} />} onClick={() => confirmClose('this')}>
          Close tab{isGrid && count > 0 ? ` (${count} session${count === 1 ? '' : 's'})` : ''}
        </MenuItem>
        <MenuItem
          danger
          icon={<IconTrash size={12} />}
          disabled={useWorkspaces.getState().tabs.length < 2}
          onClick={() => confirmClose('others')}
        >
          Close other tabs
        </MenuItem>
      </ContextMenu>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   "+" — open anything. Every content kind the app has, in one place, so
   there is exactly one way to open a thing instead of a side dock plus a
   command palette plus this.
   ───────────────────────────────────────────────────────────────────────── */

function NewTabMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const agents = useAgents((s) => s.agents);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const openSettings = useSettings((s) => s.openSettings);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const installed = agents.filter((a) => a.installed && a.id !== 'shell');
  const shell = agents.find((a) => a.id === 'shell');

  const spawnInNewTab = (agentId: string) => {
    const preset = agents.find((a) => a.id === agentId);
    if (!preset || !active) return;
    useWorkspaces.getState().addTab(preset.name);
    spawnAgent(preset, {
      cwd: active.path,
      projectId: active.id,
      systemText: preset.systemPrompt,
    });
  };

  return (
    <div className="wt-new" ref={ref}>
      <button className="icon-btn wt-add" title="Open anything (⌘T)" onClick={() => setOpen((v) => !v)}>
        <IconPlus size={14} />
      </button>
      {open && (
        <div className="dropdown wt-new-menu">
          <div className="dropdown-label">Open any file, URL, agent, …</div>

          <button
            className="dropdown-item"
            onClick={() => {
              setOpen(false);
              useWorkspaces.getState().addTab();
            }}
          >
            <span className="wt-new-icon"><IconTerminal size={13} /></span>
            New Terminal
          </button>
          <button
            className="dropdown-item"
            onClick={() => {
              setOpen(false);
              useWorkspaces.getState().openBrowserTab();
            }}
          >
            <span className="wt-new-icon"><IconGlobe size={13} /></span>
            New Browser Tab
          </button>

          {installed.length > 0 && <div className="dropdown-label" />}
          {installed.map((a) => (
            <button
              key={a.id}
              className="dropdown-item"
              disabled={!active}
              onClick={() => {
                setOpen(false);
                spawnInNewTab(a.id);
              }}
            >
              <span className="wt-new-icon">
                {hasAgentLogo(a.id) ? <AgentLogo agentId={a.id} size={13} /> : <span className="wt-new-dot" style={{ background: a.color }} />}
              </span>
              {a.name}
            </button>
          ))}
          {shell?.installed && (
            <button
              className="dropdown-item"
              disabled={!active}
              onClick={() => {
                setOpen(false);
                spawnInNewTab('shell');
              }}
            >
              <span className="wt-new-icon"><IconTerminal size={13} /></span>
              Shell
            </button>
          )}

          <div className="dropdown-label" />
          {(['memory', 'swarm', 'board', 'pulls', 'files', 'git', 'editor'] as const).map((kind) => {
            const Icon = KIND_ICON[kind];
            return (
              <button
                key={kind}
                className="dropdown-item"
                onClick={() => {
                  setOpen(false);
                  useWorkspaces.getState().openKindTab(kind);
                }}
              >
                <span className="wt-new-icon"><Icon size={13} /></span>
                {KIND_LABEL[kind]}
              </button>
            );
          })}

          <div className="dropdown-label" />
          <button
            className="dropdown-item"
            onClick={() => {
              setOpen(false);
              openSettings('agents');
            }}
          >
            <span className="wt-new-icon"><IconSettings size={13} /></span>
            Agent settings…
          </button>
        </div>
      )}
    </div>
  );
}
