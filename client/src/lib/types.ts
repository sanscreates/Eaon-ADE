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

export type PromptMode = 'arg' | 'type';

export interface AgentPreset {
  id: string;
  name: string;
  command: string;
  args: string[];
  description: string;
  color: string;
  promptMode: PromptMode;
  /** Standing instruction folded into every task this agent is handed. */
  systemPrompt: string;
  /** CLI flag taking a system prompt, when the agent documents one. */
  systemPromptFlag: string;
  env: Record<string, string>;
  builtin: boolean;
  hidden: boolean;
  installed?: boolean;
  resolvedPath?: string | null;
}

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

/* ── swarm ──────────────────────────────────────────────────────────────── */

export interface SwarmRole {
  id: string;
  name: string;
  charter: string;
}

export interface SwarmMember {
  id: string;
  roleId: string;
  agentId: string;
  enabled: boolean;
  notes: string;
}

export interface SwarmConfig {
  roles: SwarmRole[];
  members: SwarmMember[];
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

/* ── memory knowledge graph ─────────────────────────────────────────────── */

export interface MemoryLink {
  raw: string;
  target: string;
  alias: string;
  resolved: boolean;
}

export interface MemoryNoteSummary {
  id: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
  /** Who wrote it: "you", or the agent's client name. */
  source: string;
  file: string;
  excerpt: string;
  links: MemoryLink[];
  linkCount: number;
}

export interface MemoryNote extends MemoryNoteSummary {
  body: string;
}

export interface MemoryBacklink {
  id: string;
  title: string;
  context: string;
}

export interface MemorySuggestion {
  from: string;
  fromTitle: string;
  id: string;
  title: string;
  score: number;
  reasons: string[];
}

export interface MemoryDetail {
  note: MemoryNote;
  backlinks: MemoryBacklink[];
  suggestions: MemorySuggestion[];
}

export interface MemorySearchHit {
  id: string;
  title: string;
  tags: string[];
  updated: string;
  source: string;
  score: number;
  snippet: string;
}

export interface MemoryGraphNode {
  id: string;
  title: string;
  tags: string[];
  source: string;
  updated: string;
  degree: number;
  /** A link target nobody has written yet. */
  missing: boolean;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  weight: number;
  mutual: boolean;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

export interface MemoryStats {
  notes: number;
  links: number;
  dangling: number;
  orphans: number;
  tags: number;
  dir: string;
}

export interface MemoryTagCount {
  tag: string;
  count: number;
}

export type McpTargetId = 'claude' | 'cursor' | 'gemini' | 'vscode' | 'opencode';

export interface McpWiringTarget {
  id: McpTargetId;
  label: string;
  file: string;
  note: string;
  wired: boolean;
  stale: boolean;
  exists: boolean;
}

export interface McpWiringStatus {
  script: string;
  node: string;
  memoryDir: string;
  snippet: string;
  targets: McpWiringTarget[];
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: FileNode[];
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  files?: { path: string; index: string; worktree: string }[];
  ahead?: number;
  behind?: number;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export type SessionStatus = 'spawning' | 'working' | 'waiting' | 'idle' | 'exited';
