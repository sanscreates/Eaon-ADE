import { create } from 'zustand';
import { api } from '../lib/api';
import { uid } from '../lib/utils';
import { killSession, spawnAgent } from '../lib/spawn';
import { isAlive, sendToSession } from '../lib/dispatch';
import { useAgents } from './agents';
import { useProjects } from './projects';
import { useWorkspaces } from './workspaces';
import { useUi } from './ui';
import type { SwarmConfig, SwarmMember, SwarmRole } from '../lib/types';

/* ═══════════════════════════════════════════════════════════════════════════
   The swarm: a roster of briefed agents, and one console that drives them.

   A *member* is a seat — a role plus the agent CLI filling it. The roster is
   per-project and committed (`.eaon/swarm.json`); which session is currently
   running in each seat is per-machine and is not, because session ids mean
   nothing to anyone else's checkout.
   ═══════════════════════════════════════════════════════════════════════════ */

const EMPTY: SwarmConfig = { roles: [], members: [] };

export interface DispatchEntry {
  id: string;
  at: number;
  /** Role names the task actually reached. */
  targets: string[];
  task: string;
  /** Members that had to be started to receive it. */
  started: number;
}

function bindingKey(projectId: string): string {
  return `eaon.swarm.bindings.${projectId}`;
}

function loadBindings(projectId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(bindingKey(projectId));
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

interface SwarmState {
  config: SwarmConfig;
  projectPath: string | null;
  projectId: string | null;
  loaded: boolean;
  /** memberId → sessionId, for seats that are currently running. */
  bindings: Record<string, string>;
  /** Members already told who they are, so the brief is sent once, not every task. */
  briefed: string[];
  log: DispatchEntry[];

  load: (projectPath: string, projectId: string) => Promise<void>;
  persist: () => void;

  role: (roleId: string) => SwarmRole | null;
  member: (memberId: string) => SwarmMember | null;
  /** The live session for a seat, or null when it is not running. */
  sessionFor: (memberId: string) => string | null;

  setMemberAgent: (memberId: string, agentId: string) => void;
  setMemberNotes: (memberId: string, notes: string) => void;
  setMemberEnabled: (memberId: string, enabled: boolean) => void;
  addMember: (roleId: string) => void;
  removeMember: (memberId: string) => void;
  setRoleCharter: (roleId: string, charter: string) => void;
  resetRoles: () => Promise<void>;

  /** Launch the seat's agent. Returns the session id, or null if it couldn't. */
  start: (memberId: string, task?: string) => string | null;
  stop: (memberId: string) => void;
  startAll: () => number;
  stopAll: () => number;
  /** Send a task to seats, starting any that aren't running. Returns targets reached. */
  dispatch: (task: string, memberIds: string[]) => number;
  clearLog: () => void;
}

/** The agent a seat should use — its own choice, or a sensible installed one. */
export function resolveAgentId(member: SwarmMember): string {
  if (member.agentId) return member.agentId;
  return useAgents.getState().defaultAgent()?.id ?? '';
}

export const useSwarm = create<SwarmState>((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function persistBindings(): void {
    const { projectId, bindings } = get();
    if (!projectId) return;
    try {
      localStorage.setItem(bindingKey(projectId), JSON.stringify(bindings));
    } catch {
      // Losing the seat↔session map costs a reconnect, nothing more.
    }
  }

  /**
   * Compose what a member is told about itself: the agent's own standing
   * instruction, then the role charter, then anything specific to this seat.
   */
  function briefFor(memberId: string): string {
    const state = get();
    const member = state.member(memberId);
    if (!member) return '';
    const role = state.role(member.roleId);
    const preset = useAgents.getState().byId(resolveAgentId(member));
    return [preset?.systemPrompt, role?.charter, member.notes]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  return {
    config: EMPTY,
    projectPath: null,
    projectId: null,
    loaded: false,
    bindings: {},
    briefed: [],
    log: [],

    load: async (projectPath, projectId) => {
      // Bindings are per-project and survive a reload, so a console reopened
      // after a refresh still knows which pane is the reviewer.
      const bindings = loadBindings(projectId);
      try {
        const config = await api.get<SwarmConfig>(
          `/api/swarm?project=${encodeURIComponent(projectPath)}`,
        );
        set({ config, projectPath, projectId, bindings, loaded: true, briefed: [] });
      } catch {
        set({ config: EMPTY, projectPath, projectId, bindings, loaded: true, briefed: [] });
      }
    },

    persist: () => {
      const { config, projectPath } = get();
      if (!projectPath) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        api
          .put(`/api/swarm?project=${encodeURIComponent(projectPath)}`, config)
          .catch(() => undefined);
      }, 350);
    },

    role: (roleId) => get().config.roles.find((r) => r.id === roleId) ?? null,
    member: (memberId) => get().config.members.find((m) => m.id === memberId) ?? null,

    sessionFor: (memberId) => {
      const sessionId = get().bindings[memberId];
      if (!sessionId) return null;
      // A seat whose pane was closed is simply not running — the binding is a
      // hint, never a promise.
      return isAlive(sessionId) ? sessionId : null;
    },

    setMemberAgent: (memberId, agentId) => {
      set((s) => ({
        config: {
          ...s.config,
          members: s.config.members.map((m) => (m.id === memberId ? { ...m, agentId } : m)),
        },
        // A different agent means a different brief; say it again next task.
        briefed: s.briefed.filter((id) => id !== memberId),
      }));
      get().persist();
    },

    setMemberNotes: (memberId, notes) => {
      set((s) => ({
        config: {
          ...s.config,
          members: s.config.members.map((m) => (m.id === memberId ? { ...m, notes } : m)),
        },
        briefed: s.briefed.filter((id) => id !== memberId),
      }));
      get().persist();
    },

    setMemberEnabled: (memberId, enabled) => {
      set((s) => ({
        config: {
          ...s.config,
          members: s.config.members.map((m) => (m.id === memberId ? { ...m, enabled } : m)),
        },
      }));
      get().persist();
    },

    addMember: (roleId) => {
      const member: SwarmMember = { id: uid(), roleId, agentId: '', enabled: true, notes: '' };
      set((s) => ({ config: { ...s.config, members: [...s.config.members, member] } }));
      get().persist();
    },

    removeMember: (memberId) => {
      get().stop(memberId);
      set((s) => ({
        config: { ...s.config, members: s.config.members.filter((m) => m.id !== memberId) },
      }));
      get().persist();
    },

    setRoleCharter: (roleId, charter) => {
      set((s) => ({
        config: {
          ...s.config,
          roles: s.config.roles.map((r) => (r.id === roleId ? { ...r, charter } : r)),
        },
        // Everyone in that role needs re-briefing on their next task.
        briefed: s.briefed.filter((id) => get().member(id)?.roleId !== roleId),
      }));
      get().persist();
    },

    resetRoles: async () => {
      // The server owns the shipped charters, so ask it rather than keeping a
      // second copy here that could silently drift out of step.
      try {
        const { roles } = await api.get<{ roles: SwarmRole[] }>('/api/swarm/defaults');
        set((s) => ({ config: { ...s.config, roles }, briefed: [] }));
        get().persist();
        useUi.getState().toast('Role charters reset to defaults', 'success');
      } catch {
        useUi.getState().toast('Could not load the default charters', 'error');
      }
    },

    start: (memberId, task) => {
      const state = get();
      const member = state.member(memberId);
      const project = useProjects.getState().projects.find((p) => p.id === state.projectId);
      if (!member || !project) return null;

      const existing = state.sessionFor(memberId);
      if (existing) return existing;

      const agentId = resolveAgentId(member);
      const preset = useAgents.getState().byId(agentId);
      if (!preset) {
        useUi.getState().toast('Pick an agent for this role first', 'error');
        return null;
      }
      if (!preset.installed) {
        useUi.getState().toast(`${preset.name} is not installed`, 'error');
        return null;
      }

      const role = state.role(member.roleId);
      const brief = briefFor(memberId);
      // Panes land in a grid tab, but dispatching from the console should not
      // throw you out of the console — so the switch is made and undone here.
      const sessionId = useWorkspaces.getState().runInGridTab(() =>
        spawnAgent(preset, {
          cwd: project.path,
          projectId: project.id,
          title: role ? `${role.name} · ${preset.name}` : preset.name,
          task,
          systemText: brief,
          placement: 'split',
        }),
      );

      // The brief lands at spawn only if the CLI took it as a flag, or if it
      // rode along with a task. Otherwise it still has to be said.
      const delivered = !brief || !!preset.systemPromptFlag || !!task;
      set((s) => ({
        bindings: { ...s.bindings, [memberId]: sessionId },
        briefed: delivered ? [...new Set([...s.briefed, memberId])] : s.briefed.filter((id) => id !== memberId),
      }));
      persistBindings();
      return sessionId;
    },

    /** Stop means stop: the process is killed and its pane closes with it. */
    stop: (memberId) => {
      const sessionId = get().bindings[memberId];
      set((s) => {
        const bindings = { ...s.bindings };
        delete bindings[memberId];
        return { bindings, briefed: s.briefed.filter((id) => id !== memberId) };
      });
      persistBindings();
      if (sessionId && isAlive(sessionId)) killSession(sessionId);
    },

    startAll: () =>
      useWorkspaces.getState().runInGridTab(() => {
        let started = 0;
        for (const member of get().config.members) {
          if (!member.enabled) continue;
          if (get().sessionFor(member.id)) continue;
          if (get().start(member.id)) started++;
        }
        return started;
      }),

    stopAll: () => {
      const ids = Object.keys(get().bindings);
      for (const id of ids) get().stop(id);
      return ids.length;
    },

    dispatch: (task, memberIds) => {
      const trimmed = task.trim();
      if (!trimmed) return 0;
      const state = get();
      const reached: string[] = [];
      let started = 0;

      // One grid switch for the whole batch; start() nested inside collapses.
      useWorkspaces.getState().runInGridTab(() => {
      for (const memberId of memberIds) {
        const member = state.member(memberId);
        if (!member) continue;
        const role = state.role(member.roleId);
        const running = get().sessionFor(memberId);

        if (!running) {
          // Not up yet: launch it *with* the task, which also delivers the
          // brief in the same breath. Nothing else to send.
          if (get().start(memberId, trimmed)) {
            started++;
            reached.push(role?.name ?? 'member');
          }
          continue;
        }

        const needsBrief = !get().briefed.includes(memberId);
        const brief = needsBrief ? briefFor(memberId) : '';
        const text = brief ? `${brief}\n\nTask: ${trimmed}` : trimmed;
        if (sendToSession(running, text)) {
          if (needsBrief) set((s) => ({ briefed: [...new Set([...s.briefed, memberId])] }));
          reached.push(role?.name ?? 'member');
        }
      }
      });

      if (reached.length > 0) {
        const entry: DispatchEntry = {
          id: uid(),
          at: Date.now(),
          targets: reached,
          task: trimmed,
          started,
        };
        set((s) => ({ log: [entry, ...s.log].slice(0, 40) }));
      }
      return reached.length;
    },

    clearLog: () => set({ log: [] }),
  };
});
