import { create } from 'zustand';
import {
  LayoutNode,
  assignSession,
  balanced,
  findLeaf,
  leafBySession,
  leafCount,
  leaves,
  makeLeaf,
  pruneSessions,
  removeLeaf,
  setSizes,
  splitLeaf,
  MAX_PANES,
} from '../lib/layoutTree';

interface LayoutState {
  root: LayoutNode | null;
  activeLeafId: string | null;
  loadFor: (projectId: string) => void;
  persist: (projectId: string) => void;
  setRoot: (root: LayoutNode | null) => void;
  setActive: (leafId: string | null) => void;
  assign: (leafId: string, sessionId: string | null) => void;
  split: (leafId: string, dir: 'row' | 'column', sessionId: string | null) => string | null;
  close: (leafId: string) => void;
  closeBySession: (sessionId: string) => void;
  updateSizes: (splitId: string, sizes: number[]) => void;
  applyTemplate: (sessionIds: (string | null)[]) => void;
  reconcile: (sessionIds: string[]) => void;
  canSplit: () => boolean;
}

let currentProject: string | null = null;

function storageKey(projectId: string): string {
  return `eaon.layout.${projectId}`;
}

export const useLayout = create<LayoutState>((set, get) => ({
  root: null,
  activeLeafId: null,

  loadFor: (projectId) => {
    currentProject = projectId;
    let root: LayoutNode | null = null;
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      if (raw) root = JSON.parse(raw) as LayoutNode;
    } catch {
      root = null;
    }
    const firstLeaf = leaves(root)[0];
    set({ root, activeLeafId: firstLeaf?.id ?? null });
  },

  persist: (projectId) => {
    const { root } = get();
    try {
      if (root) localStorage.setItem(storageKey(projectId), JSON.stringify(root));
      else localStorage.removeItem(storageKey(projectId));
    } catch {
      // storage full or unavailable; non-fatal
    }
  },

  setRoot: (root) => {
    set({ root });
    if (currentProject) get().persist(currentProject);
  },

  setActive: (leafId) => set({ activeLeafId: leafId }),

  assign: (leafId, sessionId) => {
    const { root } = get();
    if (!root) return;
    const next = assignSession(root, leafId, sessionId);
    get().setRoot(next);
  },

  split: (leafId, dir, sessionId) => {
    const { root } = get();
    if (!root || leafCount(root) >= MAX_PANES) return null;
    const newLeaf = makeLeaf(sessionId);
    const next = splitLeaf(root, leafId, dir, newLeaf);
    get().setRoot(next);
    set({ activeLeafId: newLeaf.id });
    return newLeaf.id;
  },

  close: (leafId) => {
    const { root, activeLeafId } = get();
    if (!root) return;
    const next = removeLeaf(root, leafId);
    const nextActive =
      activeLeafId === leafId ? leaves(next)[0]?.id ?? null : activeLeafId;
    set({ root: next, activeLeafId: nextActive });
    if (currentProject) get().persist(currentProject);
  },

  closeBySession: (sessionId) => {
    const { root } = get();
    const leaf = leafBySession(root, sessionId);
    if (leaf) get().close(leaf.id);
  },

  updateSizes: (splitId, sizes) => {
    const { root } = get();
    if (!root) return;
    set({ root: setSizes(root, splitId, sizes) });
    if (currentProject) get().persist(currentProject);
  },

  applyTemplate: (sessionIds) => {
    const n = Math.min(MAX_PANES, Math.max(1, sessionIds.length));
    const padded: (string | null)[] = [...sessionIds.slice(0, n)];
    while (padded.length < n) padded.push(null);
    const root = balanced(padded);
    set({ root, activeLeafId: leaves(root)[0]?.id ?? null });
    if (currentProject) get().persist(currentProject);
  },

  reconcile: (sessionIds) => {
    const { root, activeLeafId } = get();
    const alive = new Set(sessionIds);
    const pruned = pruneSessions(root, alive);

    // Follow the focused *session* rather than the focused leaf id, because a
    // rebalance mints new leaf ids. Reconcile runs on every session change,
    // and it used to hand focus back to pane one each time.
    const activeSession = activeLeafId
      ? findLeaf(root, activeLeafId)?.sessionId ?? null
      : null;

    const commit = (next: LayoutNode | null) => {
      if (next === root) return;
      const stillThere = activeLeafId && findLeaf(next, activeLeafId) ? activeLeafId : null;
      const keep =
        (activeSession ? leafBySession(next, activeSession)?.id : null) ??
        stillThere ??
        leaves(next)[0]?.id ??
        null;
      set({ root: next, activeLeafId: keep });
      if (currentProject) get().persist(currentProject);
    };

    if (!pruned) {
      if (sessionIds.length > 0) get().applyTemplate(sessionIds);
      else commit(null);
      return;
    }

    const placed = new Set(
      leaves(pruned)
        .map((l) => l.sessionId)
        .filter((x): x is string => x !== null),
    );
    const orphans = sessionIds.filter((id) => !placed.has(id));
    if (orphans.length === 0) {
      commit(pruned);
      return;
    }

    // Empty panes exist because the user asked for them, so fill those first.
    let next = pruned;
    const empty = leaves(next).filter((l) => l.sessionId === null);
    const remaining = [...orphans];
    while (remaining.length > 0 && empty.length > 0) {
      next = assignSession(next, empty.shift()!.id, remaining.shift()!);
    }

    // Whatever is left arrived without a home — another window's sessions, or
    // a reload. Rebuild a balanced grid instead of halving the first pane once
    // per orphan, which is how four sessions became four unusable slivers
    // rather than a 2x2.
    if (remaining.length > 0) {
      const slots = [...leaves(next).map((l) => l.sessionId), ...remaining].slice(0, MAX_PANES);
      next = balanced(slots);
    }
    commit(next);
  },

  canSplit: () => leafCount(get().root) < MAX_PANES,
}));
