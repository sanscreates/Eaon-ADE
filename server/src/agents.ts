import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readAgentsConfig } from './agentConfig.js';
import type { AgentOverride, AgentPreset, CustomAgentDef } from './types.js';

/** A preset before detection has run — everything except installed/resolvedPath. */
type BasePreset = Omit<AgentPreset, 'installed' | 'resolvedPath'>;

const shell = process.env.SHELL || '/bin/zsh';

/**
 * The agents the app ships knowing about. `systemPromptFlag` is filled in only
 * where the CLI genuinely documents one — guessing a flag would turn "give
 * this agent a role" into an unparseable command line. Everything else folds
 * its standing instruction into the first message instead, which needs no
 * cooperation from the CLI at all and so always works.
 */
const BUILTIN: BasePreset[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', args: [], description: "Anthropic's agentic coding CLI", color: '#d97757', promptMode: 'arg', systemPrompt: '', systemPromptFlag: '--append-system-prompt', env: {}, builtin: true, hidden: false },
  { id: 'codex', name: 'Codex', command: 'codex', args: [], description: "OpenAI's Codex coding agent", color: '#10a37f', promptMode: 'arg', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'antigravity', name: 'Antigravity', command: 'antigravity', args: [], description: 'Google Antigravity agent CLI', color: '#7c6cf0', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'minimax', name: 'MiniMax', command: 'minimax', args: [], description: 'MiniMax coding agent CLI', color: '#e25563', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: [], description: "Google's Gemini coding CLI", color: '#4b8bf5', promptMode: 'arg', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: [], description: 'Open-source terminal coding agent', color: '#fab283', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'cursor-agent', name: 'Cursor Agent', command: 'cursor-agent', args: [], description: 'Cursor CLI agent', color: '#9aa0a6', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'aider', name: 'Aider', command: 'aider', args: [], description: 'AI pair programming in the terminal', color: '#3fb950', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'auggie', name: 'Auggie', command: 'auggie', args: [], description: 'Augment Code agent CLI', color: '#b083f0', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'kimi', name: 'Kimi', command: 'kimi', args: [], description: 'Moonshot Kimi CLI agent', color: '#58a6ff', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'goose', name: 'Goose', command: 'goose', args: [], description: 'Block Goose agent', color: '#e3b341', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
  { id: 'shell', name: 'Shell', command: shell, args: [], description: 'Plain interactive shell', color: '#8b949e', promptMode: 'type', systemPrompt: '', systemPromptFlag: '', env: {}, builtin: true, hidden: false },
];

function applyOverride(preset: BasePreset, override: AgentOverride | undefined): BasePreset {
  if (!override) return preset;
  return {
    ...preset,
    name: override.name?.trim() || preset.name,
    command: override.command?.trim() || preset.command,
    args: override.args ?? preset.args,
    color: override.color?.trim() || preset.color,
    promptMode: override.promptMode ?? preset.promptMode,
    // Empty string is a meaningful value here — it means "this agent has no
    // system-prompt flag, fold the instruction into the message" — so these
    // two use ?? and never ||.
    systemPrompt: override.systemPrompt ?? preset.systemPrompt,
    systemPromptFlag: override.systemPromptFlag ?? preset.systemPromptFlag,
    env: override.env ?? preset.env,
    hidden: override.hidden ?? preset.hidden,
  };
}

function fromCustom(def: CustomAgentDef): BasePreset {
  return {
    id: def.id,
    name: def.name,
    command: def.command,
    args: def.args ?? [],
    description: def.description || 'Custom agent',
    color: def.color || '#8b949e',
    promptMode: def.promptMode ?? 'type',
    systemPrompt: def.systemPrompt ?? '',
    systemPromptFlag: def.systemPromptFlag ?? '',
    env: def.env ?? {},
    builtin: false,
    hidden: false,
  };
}

function isExecutableFile(path: string): boolean {
  try {
    return statSync(path).isFile() && (accessSync(path, constants.X_OK), true);
  } catch {
    return false;
  }
}

/**
 * Index PATH by listing each directory once, instead of probing each directory
 * for each command.
 *
 * The difference is not academic. A PATH carrying a Linux-flavoured entry — a
 * `/home/linuxbrew/...` line in shared dotfiles is the usual way — costs a
 * fortune on macOS, because `/home` is an autofs mount and every miss under it
 * blocks on the automounter. Probing twelve commands across that one directory
 * measured 3.4 seconds; listing it once measured 23ms. Across the whole PATH
 * that is 4300ms of dead time on every launch versus 64ms, and it was dead
 * time the launcher, the swarm roster and every dispatch menu spent empty.
 */
function indexPath(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // missing or unreadable — exactly what PATH is full of
    }
    // First hit wins, which is what PATH order means.
    for (const name of entries) if (!found.has(name)) found.set(name, join(dir, name));
  }
  return found;
}

function resolveCommand(command: string, index?: Map<string, string>): string | null {
  const value = command.trim();
  if (!value) return null;
  // An explicit path is taken at its word rather than looked up.
  if (value.includes('/')) return isExecutableFile(value) ? value : null;
  const candidate = (index ?? indexPath()).get(value);
  // readdir says the name exists; only this one candidate needs the stat that
  // proves it is actually a runnable file.
  return candidate && isExecutableFile(candidate) ? candidate : null;
}

/* Detection is hit on every page load and again by the agent editor, and the
   answer only changes when someone installs something. A short TTL keeps the
   repeat calls free without going stale long enough to notice. */
let cache: { at: number; agents: AgentPreset[] } | null = null;
const CACHE_MS = 4000;

/** Drop the cache — called after a config write, which changes what resolves. */
export function invalidateAgentCache(): void {
  cache = null;
}

/**
 * Built-ins with the user's tweaks applied, then their own custom agents. A
 * custom agent that reuses a built-in's id replaces it outright — which is how
 * you point "claude" at a wrapper script without inventing a new entry.
 */
export function mergedPresets(): BasePreset[] {
  const config = readAgentsConfig();
  const byId = new Map<string, BasePreset>();
  for (const preset of BUILTIN) {
    byId.set(preset.id, applyOverride(preset, config.overrides[preset.id]));
  }
  for (const def of config.custom) byId.set(def.id, fromCustom(def));
  return [...byId.values()];
}

export async function detectAgents(): Promise<AgentPreset[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.agents;
  // One PATH index shared by every agent in this pass.
  const index = indexPath();
  const agents = mergedPresets().map((preset) => {
    const resolvedPath = resolveCommand(preset.command, index);
    return { ...preset, installed: resolvedPath !== null, resolvedPath };
  });
  cache = { at: Date.now(), agents };
  return agents;
}

export function getPreset(id: string): BasePreset | undefined {
  return mergedPresets().find((p) => p.id === id);
}

/** Live "does this exist on PATH?" check for the agent editor. */
export function probeCommand(command: string): string | null {
  return resolveCommand(command.trim());
}
