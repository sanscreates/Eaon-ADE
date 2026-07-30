export interface SessionMeta {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  projectId?: string;
  agentId?: string;
  pid?: number;
  cols: number;
  rows: number;
  createdAt: number;
  exitCode?: number;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

export interface BoardCard {
  id: string;
  columnId: string;
  title: string;
  description: string;
  agentId?: string;
  sessionId?: string;
  createdAt: number;
}

export interface BoardColumn {
  id: string;
  title: string;
}

export interface Board {
  columns: BoardColumn[];
  cards: BoardCard[];
}

/* ── agents & swarm ─────────────────────────────────────────────────────── */

export type PromptMode = 'arg' | 'type';

/**
 * One agent CLI as the app knows it: how to launch it, how it takes a first
 * prompt, and what standing instruction it carries. Built-ins ship in code;
 * custom ones and per-agent tweaks live in ~/.eaon/agents.json.
 */
export interface AgentPreset {
  id: string;
  name: string;
  command: string;
  args: string[];
  description: string;
  color: string;
  promptMode: PromptMode;
  /** Standing instruction prepended to every task this agent is handed. */
  systemPrompt: string;
  /**
   * CLI flag that accepts a system prompt, when the agent has one (Claude
   * Code's `--append-system-prompt`). Empty means the agent has no such flag,
   * and the instruction is folded into the first message instead — which
   * works for every CLI, which is why it is the fallback rather than an error.
   */
  systemPromptFlag: string;
  env: Record<string, string>;
  builtin: boolean;
  hidden: boolean;
  installed?: boolean;
  resolvedPath?: string | null;
}

/** A user-defined agent. Same shape as a preset minus the detected fields. */
export interface CustomAgentDef {
  id: string;
  name: string;
  command: string;
  args?: string[];
  description?: string;
  color?: string;
  promptMode?: PromptMode;
  systemPrompt?: string;
  systemPromptFlag?: string;
  env?: Record<string, string>;
}

/** Per-agent tweaks layered over a built-in. Every field is optional. */
export interface AgentOverride {
  name?: string;
  command?: string;
  args?: string[];
  color?: string;
  promptMode?: PromptMode;
  systemPrompt?: string;
  systemPromptFlag?: string;
  env?: Record<string, string>;
  hidden?: boolean;
}

export interface AgentsConfig {
  custom: CustomAgentDef[];
  overrides: Record<string, AgentOverride>;
}

/** A standing brief that shapes how one member of the swarm behaves. */
export interface SwarmRole {
  id: string;
  name: string;
  charter: string;
}

export interface SwarmMember {
  id: string;
  roleId: string;
  /** Empty until the user picks one; the client fills in a sane default. */
  agentId: string;
  enabled: boolean;
  /** Extra instruction for this member alone, on top of the role charter. */
  notes: string;
}

export interface SwarmConfig {
  roles: SwarmRole[];
  members: SwarmMember[];
}
