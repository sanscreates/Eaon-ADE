import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentsConfig, AgentOverride, CustomAgentDef, PromptMode } from './types.js';

/* Custom agents and per-agent tweaks live next to projects.json, not in the
   repo: which CLIs you have installed and where they live is a property of
   this machine, not of the code you are working on. (Swarm rosters are the
   opposite — those are per-project and committed.) */
const CONFIG_DIR = join(homedir(), '.eaon');
const AGENTS_FILE = join(CONFIG_DIR, 'agents.json');

const EMPTY: AgentsConfig = { custom: [], overrides: {} };

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function envRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && k.trim()) out[k] = v;
  }
  return out;
}

function promptMode(value: unknown): PromptMode {
  return value === 'arg' ? 'arg' : 'type';
}

/**
 * Everything that comes back from the client is sanitised on the way in. This
 * file is read at every spawn to build a command line, so a malformed write
 * would otherwise turn into a broken launch much later and far from the cause.
 */
function cleanCustom(raw: unknown): CustomAgentDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id).trim();
  const command = str(o.command).trim();
  if (!id || !command) return null;
  return {
    id,
    name: str(o.name).trim() || id,
    command,
    args: strArray(o.args),
    description: str(o.description),
    color: str(o.color),
    promptMode: promptMode(o.promptMode),
    systemPrompt: str(o.systemPrompt),
    systemPromptFlag: str(o.systemPromptFlag).trim(),
    env: envRecord(o.env),
  };
}

function cleanOverride(raw: unknown): AgentOverride | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: AgentOverride = {};
  if (typeof o.name === 'string') out.name = o.name;
  if (typeof o.command === 'string') out.command = o.command;
  if (Array.isArray(o.args)) out.args = strArray(o.args);
  if (typeof o.color === 'string') out.color = o.color;
  if (o.promptMode === 'arg' || o.promptMode === 'type') out.promptMode = o.promptMode;
  if (typeof o.systemPrompt === 'string') out.systemPrompt = o.systemPrompt;
  if (typeof o.systemPromptFlag === 'string') out.systemPromptFlag = o.systemPromptFlag;
  if (o.env && typeof o.env === 'object') out.env = envRecord(o.env);
  if (typeof o.hidden === 'boolean') out.hidden = o.hidden;
  return Object.keys(out).length > 0 ? out : null;
}

export function sanitizeAgentsConfig(raw: unknown): AgentsConfig {
  if (!raw || typeof raw !== 'object') return { custom: [], overrides: {} };
  const o = raw as Record<string, unknown>;

  const custom: CustomAgentDef[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(o.custom) ? o.custom : []) {
    const clean = cleanCustom(entry);
    // A duplicate id would shadow the earlier one at merge time; drop it here
    // where we can, rather than letting the list disagree with itself.
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      custom.push(clean);
    }
  }

  const overrides: Record<string, AgentOverride> = {};
  if (o.overrides && typeof o.overrides === 'object') {
    for (const [id, value] of Object.entries(o.overrides as Record<string, unknown>)) {
      const clean = cleanOverride(value);
      if (clean) overrides[id] = clean;
    }
  }

  return { custom, overrides };
}

export function readAgentsConfig(): AgentsConfig {
  try {
    return sanitizeAgentsConfig(JSON.parse(readFileSync(AGENTS_FILE, 'utf8')));
  } catch {
    return { ...EMPTY, custom: [], overrides: {} };
  }
}

export function writeAgentsConfig(raw: unknown): AgentsConfig {
  const config = sanitizeAgentsConfig(raw);
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(AGENTS_FILE, JSON.stringify(config, null, 2));
  return config;
}
