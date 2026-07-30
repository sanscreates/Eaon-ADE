import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useProjects } from '../store/projects';
import { useSessions } from '../store/sessions';
import { useAgents } from '../store/agents';
import { useLayout } from '../store/layout';
import { useUi } from '../store/ui';
import { useWorkspaces, kindOf } from '../store/workspaces';
import { useSettings } from '../store/settings';
import { useConnection } from '../lib/bootstrap';
import { leafBySession } from '../lib/layoutTree';
import { placeSession, killSession, restartSession } from '../lib/spawn';
import { api } from '../lib/api';
import { wsClient } from '../lib/ws';
import { baseName, cls, projectColor, shortPath, timeAgo } from '../lib/utils';
import type { SessionMeta, WorktreeInfo } from '../lib/types';
import { AgentLogo, hasAgentLogo } from './AgentLogos';
import { ContextMenu, MenuHeader, MenuItem, MenuSep, useContextMenu } from './ContextMenu';
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconEdit,
  IconFolder,
  IconFolderPlus,
  IconGitBranch,
  IconGitPullRequest,
  IconHelp,
  IconListTask,
  IconMemory,
  IconPin,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSliders,
  IconTerminal,
  IconTrash,
  IconX,
} from './Icons';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <SidebarNav />
      <div className="side-scroll">
        <ProjectTree />
      </div>
      <SidebarFooter />
    </aside>
  );
}

/* ── top nav + search ──────────────────────────────────────────────────── */

function SidebarNav() {
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const openPanelKind = useWorkspaces((s) => s.openPanelKind);
  // Each item opens (or focuses) that kind's tab, same as the "+" menu.
  const activeKind = useWorkspaces((s) => kindOf(s.tabs.find((t) => t.id === s.activeId)));
  // Each shortcut can be hidden from Settings › Appearance; the tabs stay
  // reachable from the "+" menu and the command palette either way.
  const nav = useSettings((s) => s.sidebarNav);

  return (
    <div className="side-nav">
      {nav.tasks && (
        <button
          className={cls('nav-item', activeKind === 'board' && 'nav-item-active')}
          onClick={() => openPanelKind('board')}
        >
          <IconListTask size={14} /> Tasks
        </button>
      )}
      {nav.pulls && (
        <button
          className={cls('nav-item', activeKind === 'pulls' && 'nav-item-active')}
          onClick={() => openPanelKind('pulls')}
        >
          <IconGitPullRequest size={14} /> Pull requests
        </button>
      )}
      {nav.files && (
        <button
          className={cls('nav-item', activeKind === 'files' && 'nav-item-active')}
          onClick={() => openPanelKind('files')}
        >
          <IconFolder size={14} /> Files
        </button>
      )}
      {nav.memory && (
        <button
          className={cls('nav-item', activeKind === 'memory' && 'nav-item-active')}
          onClick={() => openPanelKind('memory')}
        >
          <IconMemory size={14} /> Memory
        </button>
      )}
      <button className="nav-search" onClick={() => setPaletteOpen(true)}>
        <IconSearch size={13} /> Search
      </button>
    </div>
  );
}

/* ── projects → worktrees → agents ─────────────────────────────────────── */

function ProjectTree() {
  const projects = useProjects((s) => s.projects);
  const setAddProjectOpen = useUi((s) => s.setAddProjectOpen);
  const setNewWorktreeOpen = useUi((s) => s.setNewWorktreeOpen);

  return (
    <div className="side-section side-section-grow">
      <div className="side-head">
        <span>Projects</span>
        <div className="side-head-actions">
          <button className="icon-btn" title="Filter" onClick={() => setNewWorktreeOpen(false)}>
            <IconSliders size={13} />
          </button>
          <button className="icon-btn" title="New worktree" onClick={() => setNewWorktreeOpen(true)}>
            <IconFolderPlus size={13} />
          </button>
          <button className="icon-btn" title="Add project" onClick={() => setAddProjectOpen(true)}>
            <IconPlus size={13} />
          </button>
        </div>
      </div>

      {projects.length === 0 && <div className="side-empty">No projects yet</div>}
      {projects.map((p) => (
        <ProjectGroup key={p.id} id={p.id} name={p.name} path={p.path} />
      ))}
    </div>
  );
}

function ProjectGroup({ id, name, path }: { id: string; name: string; path: string }) {
  const activeId = useProjects((s) => s.activeId);
  const setActive = useProjects((s) => s.setActive);
  const remove = useProjects((s) => s.remove);
  const worktreesVersion = useUi((s) => s.worktreesVersion);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[] | null>(null);
  const [hiddenDismissed, setHiddenDismissed] = useState(false);

  const isActive = id === activeId;
  const color = projectColor(id);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    api
      .get<{ worktrees: WorktreeInfo[] }>(`/api/git/worktrees?path=${encodeURIComponent(path)}`)
      .then((r) => !cancelled && setWorktrees(r.worktrees))
      .catch(() => !cancelled && setWorktrees([]));
    return () => {
      cancelled = true;
    };
  }, [isActive, path, worktreesVersion]);

  // The primary checkout is the one the project points at; the rest are
  // linked worktrees, and past a handful they are noise until asked for.
  const primary = worktrees?.[0] ?? null;
  const extras = worktrees ? worktrees.slice(1) : [];

  const menu = useContextMenu();

  const removeProject = () => {
    menu.close();
    useUi.getState().askConfirm({
      title: 'Remove project?',
      body: `“${name}” will be removed from Eaon. The folder on disk is left exactly as it is — only the entry here goes away.`,
      confirmLabel: 'Remove project',
      danger: true,
      onConfirm: () => void remove(id),
    });
  };

  return (
    <div className={cls('proj', isActive && 'proj-active')}>
      <button
        className="proj-head"
        onClick={() => setActive(id)}
        onContextMenu={menu.onContextMenu}
        title={path}
      >
        <span className="proj-mark" style={{ background: color }}>
          <IconFolder size={10} />
        </span>
        <span className="proj-name">{name}</span>
      </button>

      <ContextMenu point={menu.point} onClose={menu.close}>
        <MenuHeader>Project</MenuHeader>
        <MenuItem
          icon={<IconFolder size={12} />}
          onClick={() => {
            menu.close();
            setActive(id);
          }}
        >
          Open project
        </MenuItem>
        <MenuItem
          icon={<IconCopy size={12} />}
          onClick={() => {
            menu.close();
            void navigator.clipboard.writeText(path);
            useUi.getState().toast('Path copied', 'success');
          }}
        >
          Copy path
        </MenuItem>
        <MenuItem
          icon={<IconFolderPlus size={12} />}
          onClick={() => {
            menu.close();
            useUi.getState().setNewWorktreeOpen(true);
          }}
        >
          New worktree…
        </MenuItem>
        <MenuSep />
        <MenuItem danger icon={<IconTrash size={12} />} onClick={removeProject}>
          Remove project
        </MenuItem>
      </ContextMenu>

      {isActive && (
        <>
          {primary && <WorktreeCard projectId={id} worktree={primary} isPrimary accent={color} />}

          {extras.length > 0 && !hiddenDismissed && (
            <div className="wt-hidden">
              <IconChevronRight size={11} />
              <span>
                Hiding {extras.length} discovered worktree{extras.length === 1 ? '' : 's'}
              </span>
              <button className="icon-btn" title="Show them" onClick={() => setHiddenDismissed(true)}>
                <IconX size={11} />
              </button>
            </div>
          )}
          {extras.length > 0 &&
            hiddenDismissed &&
            extras.map((wt) => (
              <WorktreeCard key={wt.path} projectId={id} worktree={wt} accent={color} />
            ))}

          {worktrees !== null && worktrees.length === 0 && (
            <LooseSessions projectId={id} accent={color} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * One checkout, with the agents running inside it nested underneath — the
 * grouping that answers "what is happening on this branch" in one glance.
 */
function WorktreeCard({
  projectId,
  worktree,
  isPrimary = false,
  accent,
}: {
  projectId: string;
  worktree: WorktreeInfo;
  isPrimary?: boolean;
  accent: string;
}) {
  const sessions = useSessions((s) => s.sessions);
  const status = useSessions((s) => s.status);
  const openNewSession = useUi((s) => s.openNewSession);
  // Compact drops the path subline and the "run an agent" affordance, for
  // people running many worktrees who want more of them on screen.
  const compact = useSettings((s) => s.cardLayout) === 'compact';
  const [expanded, setExpanded] = useState(true);

  const mine = useMemo(
    () =>
      Object.values(sessions).filter(
        (m) => m.projectId === projectId && m.cwd === worktree.path,
      ),
    [sessions, projectId, worktree.path],
  );

  const attention = mine.filter((m) => status[m.id] === 'waiting').length;
  const live = mine.some((m) => status[m.id] === 'working');

  return (
    <div className={cls('wt', mine.length > 0 && 'wt-busy')}>
      <div className="wt-head">
        <span
          className={cls('wt-dot', live && 'wt-dot-live', attention > 0 && 'wt-dot-attention')}
          style={{ background: attention > 0 ? undefined : accent }}
        />
        <span className="wt-branch">{worktree.branch || baseName(worktree.path)}</span>
        {isPrimary && <span className="wt-pill">primary</span>}
      </div>

      {!compact && (
        <div className="wt-sub">
          <span className="wt-sub-path" title={worktree.path}>
            {worktree.branch || shortPath(worktree.path)}
          </span>
          {isPrimary ? (
            <IconPin size={11} className="wt-sub-icon" />
          ) : (
            <IconGitBranch size={11} className="wt-sub-icon" />
          )}
        </div>
      )}

      <button className="wt-agents" onClick={() => setExpanded((v) => !v)}>
        <span>
          {mine.length} agent{mine.length === 1 ? '' : 's'}
        </span>
        {attention > 0 && <span className="row-badge row-badge-alert">{attention}</span>}
        {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
      </button>

      {expanded && !compact && mine.length === 0 && (
        <button className="wt-spawn" onClick={() => openNewSession({ cwd: worktree.path })}>
          <IconPlus size={11} /> Run an agent here
        </button>
      )}
      {expanded &&
        mine.map((meta) => <AgentRow key={meta.id} meta={meta} />)}
    </div>
  );
}

/** Sessions in a project that has no worktree list (not a git repo). */
function LooseSessions({ projectId, accent }: { projectId: string; accent: string }) {
  const sessions = useSessions((s) => s.sessions);
  const openNewSession = useUi((s) => s.openNewSession);
  const mine = useMemo(
    () => Object.values(sessions).filter((m) => m.projectId === projectId),
    [sessions, projectId],
  );

  return (
    <div className="wt">
      <div className="wt-head">
        <span className="wt-dot" style={{ background: accent }} />
        <span className="wt-branch">no worktree</span>
      </div>
      <button className="wt-agents" disabled>
        <span>
          {mine.length} agent{mine.length === 1 ? '' : 's'}
        </span>
      </button>
      {mine.length === 0 ? (
        <button className="wt-spawn" onClick={() => openNewSession()}>
          <IconPlus size={11} /> Run an agent here
        </button>
      ) : (
        mine.map((meta) => <AgentRow key={meta.id} meta={meta} />)
      )}
    </div>
  );
}

/**
 * A running agent: its status, its brand mark, what it is doing, and how long
 * ago it started. Clicking focuses its pane, or places it if it has none.
 */
function AgentRow({ meta }: { meta: SessionMeta }) {
  const status = useSessions((s) => s.status[meta.id] ?? 'idle');
  const agent = useAgents((s) => s.byId(meta.agentId));
  const root = useLayout((s) => s.root);
  const activeLeafId = useLayout((s) => s.activeLeafId);
  const setActiveLeaf = useLayout((s) => s.setActive);
  // Renaming used to live on the pane header. With the panes bare, this row is
  // the only place the title is shown, so it is where you edit it.
  const [renaming, setRenaming] = useState(false);

  const leaf = leafBySession(root, meta.id);
  const onScreen = leaf?.id === activeLeafId;
  const color = agent?.color ?? '#8b949e';

  const commitRename = (value: string) => {
    setRenaming(false);
    const next = value.trim();
    if (next && next !== meta.title) {
      wsClient.send({ t: 'rename', id: meta.id, title: next });
    }
  };

  const menu = useContextMenu();
  const alive = status !== 'exited';

  const kill = () => {
    menu.close();
    useUi.getState().askConfirm({
      title: 'Kill session?',
      body: alive
        ? `“${meta.title}” is still running. Killing it stops the process and closes its pane.`
        : `“${meta.title}” has already exited. This removes it and closes its pane.`,
      confirmLabel: 'Kill session',
      danger: true,
      onConfirm: () => killSession(meta.id),
    });
  };

  return (
    <div
      className={cls('agent-row', onScreen && 'agent-row-active')}
      style={onScreen ? ({ '--row-accent': color } as CSSProperties) : undefined}
      onClick={() => (leaf ? setActiveLeaf(leaf.id) : placeSession(meta.id))}
      onContextMenu={menu.onContextMenu}
      title={`${meta.command} ${meta.args.join(' ')}\n${meta.cwd}`}
    >
      <span className={cls('status-dot', `st-${status}`)} title={status} />
      <span className="agent-mark" style={{ color }}>
        {agent && hasAgentLogo(agent.id) ? (
          <AgentLogo agentId={agent.id} size={13} />
        ) : agent ? (
          <span className="agent-mark-letter" style={{ background: color }}>
            {agent.name[0]}
          </span>
        ) : (
          <IconTerminal size={12} />
        )}
      </span>
      {renaming ? (
        <input
          className="agent-row-input"
          defaultValue={meta.title}
          autoFocus
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => commitRename(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span
          className="agent-row-title"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenaming(true);
          }}
          title="Double-click to rename"
        >
          {meta.title}
        </span>
      )}
      {!renaming && (
        <span className="agent-row-age">{timeAgo(meta.createdAt).replace(' ago', '')}</span>
      )}

      <ContextMenu point={menu.point} onClose={menu.close}>
        <MenuHeader>Session</MenuHeader>
        <MenuItem
          icon={<IconTerminal size={12} />}
          onClick={() => {
            menu.close();
            if (leaf) setActiveLeaf(leaf.id);
            else placeSession(meta.id);
          }}
        >
          {leaf ? 'Show pane' : 'Place in grid'}
        </MenuItem>
        <MenuItem
          icon={<IconEdit size={12} />}
          onClick={() => {
            menu.close();
            setRenaming(true);
          }}
        >
          Rename…
        </MenuItem>
        <MenuItem
          icon={<IconRefresh size={12} />}
          onClick={() => {
            menu.close();
            restartSession(meta.id);
          }}
        >
          Restart
        </MenuItem>
        <MenuItem
          icon={<IconCopy size={12} />}
          onClick={() => {
            menu.close();
            void navigator.clipboard.writeText(meta.cwd);
            useUi.getState().toast('Path copied', 'success');
          }}
        >
          Copy path
        </MenuItem>
        <MenuSep />
        <MenuItem danger icon={<IconTrash size={12} />} onClick={kill}>
          Kill session
        </MenuItem>
      </ContextMenu>
    </div>
  );
}

/* ── footer ────────────────────────────────────────────────────────────── */

function SidebarFooter() {
  const connected = useConnection((s) => s.connected);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

  return (
    <div className="side-footer">
      <button className="icon-btn" title="Settings (⌘,)" onClick={() => openSettingsSafely()}>
        <IconSettings size={14} />
      </button>
      <button className="icon-btn" title="Keyboard shortcuts" onClick={() => openSettingsSafely()}>
        <IconHelp size={14} />
      </button>
      <span className="side-footer-right">
        <span className={cls('conn-dot', connected ? 'conn-on' : 'conn-off')} title={connected ? 'Server connected' : 'Reconnecting…'} />
        <button className="icon-btn" title="Hide sidebar (⌘B)" onClick={toggleSidebar}>
          <IconChevronRight size={13} className="flip" />
        </button>
      </span>
    </div>
  );
}

/**
 * The settings store is owned by a separate feature that may not be present
 * yet, so reach for it lazily rather than importing it and coupling the
 * sidebar's build to it.
 */
function openSettingsSafely(): void {
  import('../store/settings')
    .then((m) => m.useSettings.getState().openSettings())
    .catch(() => undefined);
}
