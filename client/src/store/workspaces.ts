import { create } from 'zustand';
import { useLayout } from './layout';
import { useSessions } from './sessions';
import { useUi } from './ui';
import { useProjects } from './projects';
import { useBrowser } from './browser';
import { wsClient } from '../lib/ws';
import { leaves } from '../lib/layoutTree';
import type { LayoutNode } from '../lib/layoutTree';

/* ═══════════════════════════════════════════════════════════════════════════
   Workspace tabs

   Each tab owns a pane tree plus the sessions placed in it. The layout store
   stays single-tree: switching tabs snapshots the active tree into its tab
   record and restores the target's. Ownership (sessionId → tabId) is what
   stops the grid reconciler from dragging a hidden tab's sessions into the
   visible grid — without it every live session would teleport into whichever
   tab you opened last.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * What a tab actually shows. 'grid' is the original, and only kind still
 * backed by a pane tree of terminal sessions — everything else is a single
 * full-bleed panel with no splits, since none of these need more than one of
 * themselves visible at a time (there's exactly one Files tree, one Git
 * status, one Board). 'browser' is the odd one out: it's inherently
 * multi-instance like a real browser, so each browser-kind tab owns exactly
 * one entry in the browser store rather than sharing a singleton.
 */
export type WorkspaceTabKind =
  | 'grid'
  | 'browser'
  | 'files'
  | 'editor'
  | 'git'
  | 'board'
  | 'pulls'
  | 'swarm'
  | 'memory';

/** Tabs of these kinds are singletons — opening one twice just focuses it. */
const SINGLETON_KINDS: WorkspaceTabKind[] = ['files', 'editor', 'git', 'board', 'pulls', 'swarm', 'memory'];

export const KIND_LABEL: Record<WorkspaceTabKind, string> = {
  grid: 'Workspace',
  browser: 'New Tab',
  files: 'Files',
  editor: 'Editor',
  git: 'Git',
  board: 'Board',
  pulls: 'Pull requests',
  swarm: 'Swarm',
  memory: 'Memory',
};

export interface WorkspaceTab {
  id: string;
  name: string;
  /** Missing on tabs persisted before this field existed — treat as 'grid'. */
  kind?: WorkspaceTabKind;
  root: LayoutNode | null;
  activeLeafId: string | null;
  /** Only set when kind === 'browser': which browser-store tab this hosts. */
  browserTabId?: string;
  createdAt: number;
}

/** `tab.kind` defaults to 'grid' for anything persisted before this existed. */
export function kindOf(tab: WorkspaceTab | undefined | null): WorkspaceTabKind {
  return tab?.kind ?? 'grid';
}

interface PersistedWorkspaces {
  tabs: WorkspaceTab[];
  activeId: string | null;
  owners: Record<string, string>;
}

interface WorkspacesState {
  projectId: string | null;
  tabs: WorkspaceTab[];
  activeId: string | null;
  /** sessionId → tabId. Unowned sessions join whichever tab is active. */
  owners: Record<string, string>;

  loadFor: (projectId: string) => void;
  reconcileActive: (sessionIds: string[]) => void;
  claim: (sessionId: string) => void;

  addTab: (name?: string) => void;
  /** Open (or focus, for singleton kinds) a tab of a non-grid content kind. */
  openKindTab: (kind: Exclude<WorkspaceTabKind, 'grid' | 'browser'>) => void;
  /** Always creates a new tab — browser tabs are multi-instance like a real browser. */
  openBrowserTab: (url?: string) => void;
  /** Switch to the most-recently-used tab of this kind, opening one only if
   *  none exists yet. The one dispatch every "show me X" entry point outside
   *  the "+" menu (shortcuts, the command palette, sidebar nav) goes through,
   *  so pressing the same shortcut twice reveals the existing tab instead of
   *  piling up duplicates — unlike the "+" menu's browser entry, which is
   *  meant to always add a new one. */
  openPanelKind: (kind: Exclude<WorkspaceTabKind, 'grid'>) => void;
  /** Switch to the most-recently-used grid tab, creating one if none exists.
   *  Spawning a session only makes sense once one of these is on screen. */
  ensureGridTabActive: () => void;
  /** Run `fn` with a grid tab active, then return to the tab you were on.
   *  Spawning needs a grid to land in, but a control surface that dispatches
   *  work — the swarm console — should not disappear the moment it does. */
  runInGridTab: <T>(fn: () => T) => T;
  /** Bring the tab holding this session forward and focus its pane. */
  revealSession: (sessionId: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  switchTo: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  cycleTab: (dir: 1 | -1) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function storageKey(projectId: string): string {
  return `eaon.tabs.${projectId}`;
}

function sessionIdsIn(root: LayoutNode | null): string[] {
  return leaves(root)
    .map((l) => l.sessionId)
    .filter((x): x is string => x !== null);
}

function nextName(tabs: WorkspaceTab[]): string {
  const used = new Set(tabs.map((t) => t.name));
  let n = tabs.length + 1;
  while (used.has(`Workspace ${n}`)) n++;
  return `Workspace ${n}`;
}

/** Sessions the grid effect should consider, same filter App has always used. */
function liveIdsForActiveProject(): string[] {
  const { sessions, order } = useSessions.getState();
  const activeId = useProjects.getState().activeId;
  if (!activeId) return [];
  return order.filter((id) => {
    const meta = sessions[id];
    return meta && (!meta.projectId || meta.projectId === activeId);
  });
}

export const useWorkspaces = create<WorkspacesState>((set, get) => {
  function persist(): void {
    const { projectId, tabs, activeId, owners } = get();
    if (!projectId) return;
    try {
      const data: PersistedWorkspaces = { tabs, activeId, owners };
      localStorage.setItem(storageKey(projectId), JSON.stringify(data));
    } catch {
      // storage full or unavailable; non-fatal
    }
  }

  /**
   * Write the visible tree back into its tab record before it changes hands.
   * Only grid tabs have one: useLayout still holds the last grid's tree while
   * a panel tab is on screen, and copying that into the panel's record would
   * give a Board or Swarm tab a phantom pane tree that outlives the real one.
   */
  function snapshot(): void {
    const { activeId, tabs } = get();
    if (!activeId) return;
    if (kindOf(tabs.find((t) => t.id === activeId)) !== 'grid') return;
    const { root, activeLeafId } = useLayout.getState();
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === activeId ? { ...t, root, activeLeafId } : t)),
    }));
  }

  function killTabSessions(tab: WorkspaceTab): number {
    const ids = sessionIdsIn(tab.root);
    for (const id of ids) wsClient.send({ t: 'remove', id });
    return ids.length;
  }

  return {
    projectId: null,
    tabs: [],
    activeId: null,
    owners: {},

    loadFor: (projectId) => {
      let data: PersistedWorkspaces | null = null;
      try {
        const raw = localStorage.getItem(storageKey(projectId));
        if (raw) data = JSON.parse(raw) as PersistedWorkspaces;
      } catch {
        data = null;
      }

      if (!data || data.tabs.length === 0) {
        // Migration: the project's existing layout becomes tab one, so a
        // first run after the upgrade looks exactly like it did before.
        const { root, activeLeafId } = useLayout.getState();
        const tab: WorkspaceTab = { id: uid(), name: 'Workspace 1', kind: 'grid', root, activeLeafId, createdAt: Date.now() };
        const owners: Record<string, string> = {};
        for (const id of sessionIdsIn(root)) owners[id] = tab.id;
        set({ projectId, tabs: [tab], activeId: tab.id, owners });
        persist();
        return;
      }

      const activeId = data.activeId && data.tabs.some((t) => t.id === data.activeId) ? data.activeId : data.tabs[0].id;
      const active = data.tabs.find((t) => t.id === activeId)!;
      set({ projectId, tabs: data.tabs, activeId, owners: data.owners ?? {} });
      if (kindOf(active) === 'grid') {
        useLayout.setState({ root: active.root, activeLeafId: active.activeLeafId });
      }
      // Sessions may have died or been spawned while the app was away.
      get().reconcileActive(liveIdsForActiveProject());
    },

    reconcileActive: (sessionIds) => {
      const { activeId, tabs, owners } = get();
      if (!activeId) {
        useLayout.getState().reconcile(sessionIds);
        return;
      }
      const activeIsGrid = kindOf(tabs.find((t) => t.id === activeId)) === 'grid';

      const live = new Set(sessionIds);
      const nextOwners: Record<string, string> = {};
      for (const [sid, tabId] of Object.entries(owners)) {
        if (live.has(sid)) nextOwners[sid] = tabId;
      }

      // Unowned sessions (fresh spawns, server restart, another window) land
      // in the active tab — the pre-tabs behaviour everyone already expects.
      // But only a *grid* tab can show one: handing a session to a Board or
      // Swarm tab would hide it with no way back, so those leave it unowned
      // for whichever grid comes forward next.
      const mine: string[] = [];
      for (const id of sessionIds) {
        const owner = nextOwners[id];
        if (!owner) {
          if (!activeIsGrid) continue;
          nextOwners[id] = activeId;
          mine.push(id);
        } else if (owner === activeId) {
          mine.push(id);
        }
      }

      set({ owners: nextOwners });
      // While a panel tab is up there is no visible grid to reconcile, and
      // rewriting useLayout would throw away the tree the next grid restores.
      if (activeIsGrid) {
        useLayout.getState().reconcile(mine);
        snapshot();
      }
      persist();
    },

    claim: (sessionId) => {
      const { activeId } = get();
      if (!activeId) return;
      set((s) => ({ owners: { ...s.owners, [sessionId]: activeId } }));
    },

    addTab: (name) => {
      snapshot();
      const tab: WorkspaceTab = {
        id: uid(),
        name: name?.trim() || nextName(get().tabs),
        kind: 'grid',
        root: null,
        activeLeafId: null,
        createdAt: Date.now(),
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      useLayout.setState({ root: null, activeLeafId: null });
      persist();
    },

    openKindTab: (kind) => {
      if (SINGLETON_KINDS.includes(kind)) {
        const existing = get().tabs.find((t) => kindOf(t) === kind);
        if (existing) {
          get().switchTo(existing.id);
          return;
        }
      }
      snapshot();
      const tab: WorkspaceTab = {
        id: uid(),
        name: KIND_LABEL[kind],
        kind,
        root: null,
        activeLeafId: null,
        createdAt: Date.now(),
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      persist();
    },

    openBrowserTab: (url) => {
      snapshot();
      const browserTabId = useBrowser.getState().openTab(url);
      const tab: WorkspaceTab = {
        id: uid(),
        name: KIND_LABEL.browser,
        kind: 'browser',
        root: null,
        activeLeafId: null,
        browserTabId,
        createdAt: Date.now(),
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      persist();
    },

    openPanelKind: (kind) => {
      if (kind !== 'browser') {
        get().openKindTab(kind);
        return;
      }
      const { activeId, tabs } = get();
      const active = tabs.find((t) => t.id === activeId);
      if (active && kindOf(active) === 'browser') return;
      const browserTabs = tabs.filter((t) => kindOf(t) === 'browser');
      if (browserTabs.length > 0) {
        get().switchTo(browserTabs[browserTabs.length - 1].id);
        return;
      }
      get().openBrowserTab();
    },

    ensureGridTabActive: () => {
      const { activeId, tabs } = get();
      const active = tabs.find((t) => t.id === activeId);
      if (active && kindOf(active) === 'grid') return;
      // Most-recently-created grid tab is the best guess for "the one they
      // were just using" — good enough, and cheap.
      const gridTabs = tabs.filter((t) => kindOf(t) === 'grid');
      if (gridTabs.length > 0) {
        get().switchTo(gridTabs[gridTabs.length - 1].id);
        return;
      }
      get().addTab();
    },

    runInGridTab: (fn) => {
      const { activeId, tabs } = get();
      const active = tabs.find((t) => t.id === activeId);
      // Already on a grid: nothing to restore, and nested calls collapse here.
      if (active && kindOf(active) === 'grid') return fn();
      get().ensureGridTabActive();
      try {
        return fn();
      } finally {
        if (activeId && get().tabs.some((t) => t.id === activeId)) get().switchTo(activeId);
      }
    },

    revealSession: (sessionId) => {
      const { owners, tabs } = get();
      // Go to the tab that actually holds it. Falling back to "some grid tab"
      // would show an empty launcher and look like the session had vanished.
      const owner = owners[sessionId];
      if (owner && tabs.some((t) => t.id === owner && kindOf(t) === 'grid')) {
        get().switchTo(owner);
      } else {
        get().ensureGridTabActive();
        get().claim(sessionId);
        get().reconcileActive(liveIdsForActiveProject());
      }
      const leaf = leaves(useLayout.getState().root).find((l) => l.sessionId === sessionId);
      if (leaf) useLayout.getState().setActive(leaf.id);
    },

    closeTab: (id) => {
      const { tabs, activeId } = get();
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      const killed = killTabSessions(tab);
      if (kindOf(tab) === 'browser' && tab.browserTabId) {
        useBrowser.getState().closeTab(tab.browserTabId);
      }
      const remaining = tabs.filter((t) => t.id !== id);

      if (remaining.length === 0) {
        const fresh: WorkspaceTab = { id: uid(), name: 'Workspace 1', kind: 'grid', root: null, activeLeafId: null, createdAt: Date.now() };
        set({ tabs: [fresh], activeId: fresh.id });
        useLayout.setState({ root: null, activeLeafId: null });
      } else if (id === activeId) {
        const idx = tabs.findIndex((t) => t.id === id);
        const neighbour = remaining[Math.min(idx, remaining.length - 1)];
        set({ tabs: remaining, activeId: neighbour.id });
        if (kindOf(neighbour) === 'grid') {
          useLayout.setState({ root: neighbour.root, activeLeafId: neighbour.activeLeafId });
        }
      } else {
        set({ tabs: remaining });
      }
      persist();
      if (killed > 0) useUi.getState().toast(`Closed "${tab.name}" — ${killed} session${killed === 1 ? '' : 's'} stopped`, 'info');
    },

    closeOtherTabs: (id) => {
      const { tabs, activeId } = get();
      if (activeId !== id) get().switchTo(id);
      let killed = 0;
      for (const tab of get().tabs) {
        if (tab.id === id) continue;
        killed += killTabSessions(tab);
        if (kindOf(tab) === 'browser' && tab.browserTabId) useBrowser.getState().closeTab(tab.browserTabId);
      }
      set((s) => ({ tabs: s.tabs.filter((t) => t.id === id) }));
      persist();
      if (killed > 0) useUi.getState().toast(`Closed other tabs — ${killed} session${killed === 1 ? '' : 's'} stopped`, 'info');
    },

    renameTab: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name: trimmed } : t)) }));
      persist();
    },

    switchTo: (id) => {
      const { activeId, tabs } = get();
      if (id === activeId) return;
      const target = tabs.find((t) => t.id === id);
      if (!target) return;
      snapshot();
      set({ activeId: id });
      // Non-grid tabs don't have a pane tree, so there's nothing to restore —
      // useLayout is simply not on screen while one of them is active.
      if (kindOf(target) === 'grid') {
        useLayout.setState({ root: target.root, activeLeafId: target.activeLeafId });
      }
      persist();
      // Prune anything that died while this tab was in the background and put
      // back anything the reconciler would otherwise treat as an orphan.
      get().reconcileActive(liveIdsForActiveProject());
    },

    moveTab: (id, toIndex) => {
      const { tabs } = get();
      const from = tabs.findIndex((t) => t.id === id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(tabs.length - 1, toIndex));
      if (from === to) return;
      const next = [...tabs];
      const [tab] = next.splice(from, 1);
      next.splice(to, 0, tab);
      set({ tabs: next });
      persist();
    },

    cycleTab: (dir) => {
      const { tabs, activeId } = get();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      const next = tabs[(idx + dir + tabs.length) % tabs.length];
      get().switchTo(next.id);
    },
  };
});
