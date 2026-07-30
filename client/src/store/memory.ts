import { create } from 'zustand';
import { api } from '../lib/api';
import { useUi } from './ui';
import type {
  MemoryDetail,
  MemoryGraph,
  MemoryNoteSummary,
  MemorySearchHit,
  MemoryStats,
  MemorySuggestion,
  MemoryTagCount,
  McpWiringStatus,
  McpTargetId,
} from '../lib/types';

/* ═══════════════════════════════════════════════════════════════════════════
   Memory store.

   The server owns the graph — it is files on disk, and this is not the only
   process writing to them. So nothing here is authoritative and nothing is
   optimistically mutated: every write is followed by a reload, and a change
   broadcast from the server (an agent wrote a note through MCP) reloads too.
   Trying to keep a local mirror in step with several external writers is the
   kind of bug that only shows up in front of somebody.
   ═══════════════════════════════════════════════════════════════════════════ */

export type MemoryView = 'graph' | 'list';

interface MemoryState {
  projectPath: string | null;
  notes: MemoryNoteSummary[];
  tags: MemoryTagCount[];
  stats: MemoryStats | null;
  graph: MemoryGraph;
  loading: boolean;
  /** Non-null when the last load failed — the panel offers a retry. */
  error: string | null;

  view: MemoryView;
  selectedId: string | null;
  detail: MemoryDetail | null;
  detailLoading: boolean;
  editing: boolean;

  query: string;
  /** Null when no tag filter is on. */
  activeTag: string | null;
  /** Null when not searching; otherwise the ranked hits. */
  hits: MemorySearchHit[] | null;
  searching: boolean;

  /** Suggestions across the whole graph, for the "connect these" panel. */
  globalSuggestions: MemorySuggestion[];

  mcp: McpWiringStatus | null;
  mcpBusy: boolean;

  load: (projectPath: string) => Promise<void>;
  reload: () => Promise<void>;
  /** Called when the server says the folder changed under us. */
  noteExternalChange: (projectPath: string) => void;

  setView: (view: MemoryView) => void;
  select: (id: string | null) => Promise<void>;
  setEditing: (editing: boolean) => void;

  setQuery: (query: string) => void;
  setTag: (tag: string | null) => void;

  create: (input: { title: string; content?: string; tags?: string[] }) => Promise<string | null>;
  update: (id: string, patch: { title?: string; content?: string; tags?: string[] }) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  link: (from: string, to: string) => Promise<void>;
  loadSuggestions: () => Promise<void>;

  loadMcp: () => Promise<void>;
  setMcpTarget: (target: McpTargetId, enable: boolean) => Promise<void>;
}

const EMPTY_GRAPH: MemoryGraph = { nodes: [], edges: [] };

function qs(projectPath: string, extra: Record<string, string | number> = {}): string {
  const params = new URLSearchParams({ project: projectPath });
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return params.toString();
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

export const useMemory = create<MemoryState>((set, get) => ({
  projectPath: null,
  notes: [],
  tags: [],
  stats: null,
  graph: EMPTY_GRAPH,
  loading: false,
  error: null,

  view: 'graph',
  selectedId: null,
  detail: null,
  detailLoading: false,
  editing: false,

  query: '',
  activeTag: null,
  hits: null,
  searching: false,

  globalSuggestions: [],

  mcp: null,
  mcpBusy: false,

  load: async (projectPath) => {
    const switching = get().projectPath !== projectPath;
    set({
      projectPath,
      loading: true,
      error: null,
      ...(switching
        ? {
            notes: [],
            graph: EMPTY_GRAPH,
            tags: [],
            stats: null,
            selectedId: null,
            detail: null,
            hits: null,
            query: '',
            activeTag: null,
            editing: false,
            globalSuggestions: [],
            mcp: null,
          }
        : {}),
    });
    await get().reload();
  },

  reload: async () => {
    const { projectPath, selectedId } = get();
    if (!projectPath) return;
    try {
      const [listing, graph] = await Promise.all([
        api.get<{ notes: MemoryNoteSummary[]; tags: MemoryTagCount[]; stats: MemoryStats }>(
          `/api/memory?${qs(projectPath)}`,
        ),
        api.get<MemoryGraph>(`/api/memory/graph?${qs(projectPath)}`),
      ]);
      // A late response for a project the user already left must not land.
      if (get().projectPath !== projectPath) return;
      set({
        notes: listing.notes,
        tags: listing.tags,
        stats: listing.stats,
        graph: { nodes: graph.nodes, edges: graph.edges },
        loading: false,
        error: null,
      });
      // The selected note may have been edited or deleted by someone else.
      if (selectedId) {
        if (listing.notes.some((n) => n.id === selectedId)) await get().select(selectedId);
        else set({ selectedId: null, detail: null, editing: false });
      }
    } catch (err) {
      if (get().projectPath !== projectPath) return;
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  noteExternalChange: (projectPath) => {
    if (get().projectPath !== projectPath) return;
    // Several writes usually arrive together — an agent creating a note and
    // immediately linking it. One reload for the burst.
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void get().reload();
      if (get().query.trim() || get().activeTag) get().setQuery(get().query);
    }, 250);
  },

  setView: (view) => set({ view }),

  select: async (id) => {
    const { projectPath } = get();
    if (!id || !projectPath) {
      set({ selectedId: null, detail: null, editing: false });
      return;
    }
    set({ selectedId: id, detailLoading: true });
    try {
      const detail = await api.get<MemoryDetail>(`/api/memory/note?${qs(projectPath, { id })}`);
      if (get().selectedId !== id) return;
      set({ detail, detailLoading: false });
    } catch {
      if (get().selectedId !== id) return;
      set({ detail: null, detailLoading: false });
    }
  },

  setEditing: (editing) => set({ editing }),

  setQuery: (query) => {
    set({ query });
    const { projectPath, activeTag } = get();
    if (searchTimer) clearTimeout(searchTimer);
    if (!projectPath) return;
    if (!query.trim() && !activeTag) {
      set({ hits: null, searching: false });
      return;
    }
    set({ searching: true });
    searchTimer = setTimeout(async () => {
      try {
        const res = await api.get<{ hits: MemorySearchHit[] }>(
          `/api/memory/search?${qs(projectPath, { q: query, tag: activeTag ?? '', limit: 60 })}`,
        );
        if (get().projectPath !== projectPath) return;
        set({ hits: res.hits, searching: false });
      } catch {
        set({ hits: [], searching: false });
      }
    }, 160);
  },

  setTag: (tag) => {
    set({ activeTag: tag });
    get().setQuery(get().query);
  },

  create: async ({ title, content, tags }) => {
    const { projectPath } = get();
    if (!projectPath) return null;
    try {
      const res = await api.post<{ note: MemoryNoteSummary }>(`/api/memory?${qs(projectPath)}`, {
        title,
        content: content ?? '',
        tags: tags ?? [],
        source: 'you',
      });
      await get().reload();
      await get().select(res.note.id);
      useUi.getState().toast(`Saved “${res.note.title}”`, 'success');
      return res.note.id;
    } catch (err) {
      useUi.getState().toast(String(err instanceof Error ? err.message : err), 'error');
      return null;
    }
  },

  update: async (id, patch) => {
    const { projectPath } = get();
    if (!projectPath) return false;
    try {
      await api.put(`/api/memory/note?${qs(projectPath, { id })}`, { ...patch, source: 'you' });
      await get().reload();
      await get().select(id);
      return true;
    } catch (err) {
      useUi.getState().toast(String(err instanceof Error ? err.message : err), 'error');
      return false;
    }
  },

  remove: async (id) => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      await api.del(`/api/memory/note?${qs(projectPath, { id })}`);
      set({ selectedId: null, detail: null, editing: false });
      await get().reload();
      useUi.getState().toast('Memory deleted', 'info');
    } catch (err) {
      useUi.getState().toast(String(err instanceof Error ? err.message : err), 'error');
    }
  },

  link: async (from, to) => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      const res = await api.post<{ alreadyLinked: boolean }>(`/api/memory/link?${qs(projectPath)}`, {
        from,
        to,
      });
      await get().reload();
      if (get().selectedId) await get().select(get().selectedId!);
      useUi.getState().toast(res.alreadyLinked ? 'Already linked' : 'Linked', 'success');
    } catch (err) {
      useUi.getState().toast(String(err instanceof Error ? err.message : err), 'error');
    }
  },

  loadSuggestions: async () => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      const res = await api.get<{ suggestions: MemorySuggestion[] }>(
        `/api/memory/suggest?${qs(projectPath, { limit: 12 })}`,
      );
      if (get().projectPath !== projectPath) return;
      set({ globalSuggestions: res.suggestions });
    } catch {
      set({ globalSuggestions: [] });
    }
  },

  // Deliberately does not raise mcpBusy. That flag disables the connect
  // buttons, and a background refresh of already-loaded status would then
  // make the dialog inert for as long as the refetch took — a click landing
  // on nothing, with no visible reason why.
  loadMcp: async () => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      const status = await api.get<McpWiringStatus>(`/api/memory/mcp?${qs(projectPath)}`);
      if (get().projectPath !== projectPath) return;
      set({ mcp: status });
    } catch (err) {
      useUi.getState().toast(String(err instanceof Error ? err.message : err), 'error');
    }
  },

  setMcpTarget: async (target, enable) => {
    const { projectPath } = get();
    if (!projectPath) return;
    set({ mcpBusy: true });
    try {
      const res = await api.post<{
        changed: string[];
        errors: { id: string; error: string }[];
        status: McpWiringStatus;
      }>(`/api/memory/mcp?${qs(projectPath)}`, { targets: [target], enable });
      set({ mcp: res.status, mcpBusy: false });
      if (res.errors.length) {
        useUi.getState().toast(res.errors[0].error, 'error');
      } else {
        const label = res.status.targets.find((t) => t.id === target)?.label ?? target;
        useUi.getState().toast(
          enable ? `${label} can now read this project's memory` : `Disconnected ${label}`,
          'success',
        );
      }
    } catch (err) {
      set({ mcpBusy: false });
      useUi.getState().toast(String(err instanceof Error ? err.message : err), 'error');
    }
  },
}));
