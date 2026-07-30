import { create } from 'zustand';
import { api } from '../lib/api';
import { uid } from '../lib/utils';
import type { AgentOverride, AgentPreset, AgentsConfig, CustomAgentDef } from '../lib/types';

const EMPTY_CONFIG: AgentsConfig = { custom: [], overrides: {} };

interface AgentsState {
  agents: AgentPreset[];
  loaded: boolean;
  config: AgentsConfig;
  configLoaded: boolean;
  saving: boolean;

  fetch: () => Promise<void>;
  loadConfig: () => Promise<void>;
  /** Persist a whole config and adopt the freshly detected list it returns. */
  saveConfig: (config: AgentsConfig) => Promise<void>;

  setOverride: (agentId: string, patch: AgentOverride) => Promise<void>;
  clearOverride: (agentId: string) => Promise<void>;
  addCustom: (def: Partial<CustomAgentDef> & { name: string; command: string }) => Promise<string>;
  updateCustom: (id: string, patch: Partial<CustomAgentDef>) => Promise<void>;
  removeCustom: (id: string) => Promise<void>;

  byId: (id?: string) => AgentPreset | null;
  /** Installed and not hidden — what a launcher should actually offer. */
  installed: () => AgentPreset[];
  /** Everything the user hasn't hidden, installed or not. */
  visible: () => AgentPreset[];
  defaultAgent: () => AgentPreset | null;
}

export const useAgents = create<AgentsState>((set, get) => ({
  agents: [],
  loaded: false,
  config: EMPTY_CONFIG,
  configLoaded: false,
  saving: false,

  fetch: async () => {
    try {
      const { agents } = await api.get<{ agents: AgentPreset[] }>('/api/agents');
      set({ agents, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  loadConfig: async () => {
    try {
      const config = await api.get<AgentsConfig>('/api/agents/config');
      set({ config, configLoaded: true });
    } catch {
      set({ config: EMPTY_CONFIG, configLoaded: true });
    }
  },

  saveConfig: async (config) => {
    // Optimistic: the editor should feel like a form, not a round trip. The
    // server's sanitised copy replaces this the moment it answers, so anything
    // it rejected or normalised shows up a beat later rather than never.
    set({ config, saving: true });
    try {
      const res = await api.put<{ config: AgentsConfig; agents: AgentPreset[] }>(
        '/api/agents/config',
        config,
      );
      set({ config: res.config, agents: res.agents, saving: false });
    } catch {
      set({ saving: false });
      await get().loadConfig();
      await get().fetch();
    }
  },

  setOverride: async (agentId, patch) => {
    const { config } = get();
    await get().saveConfig({
      ...config,
      overrides: { ...config.overrides, [agentId]: { ...config.overrides[agentId], ...patch } },
    });
  },

  clearOverride: async (agentId) => {
    const { config } = get();
    const overrides = { ...config.overrides };
    delete overrides[agentId];
    await get().saveConfig({ ...config, overrides });
  },

  addCustom: async (def) => {
    const id = def.id?.trim() || `custom-${uid().slice(0, 8)}`;
    const { config } = get();
    const entry: CustomAgentDef = {
      args: [],
      env: {},
      systemPrompt: '',
      systemPromptFlag: '',
      description: 'Custom agent',
      color: '#8b949e',
      promptMode: 'type',
      ...def,
      id,
    };
    await get().saveConfig({ ...config, custom: [...config.custom, entry] });
    return id;
  },

  updateCustom: async (id, patch) => {
    const { config } = get();
    await get().saveConfig({
      ...config,
      // id is pinned: renaming it would orphan every swarm seat pointing at it.
      custom: config.custom.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
    });
  },

  removeCustom: async (id) => {
    const { config } = get();
    await get().saveConfig({ ...config, custom: config.custom.filter((c) => c.id !== id) });
  },

  byId: (id) => get().agents.find((a) => a.id === id) ?? null,

  installed: () => get().agents.filter((a) => a.installed && !a.hidden),

  visible: () => get().agents.filter((a) => !a.hidden),

  defaultAgent: () => {
    const installed = get().installed().filter((a) => a.id !== 'shell');
    return installed.find((a) => a.id === 'claude') ?? installed[0] ?? get().byId('shell');
  },
}));
