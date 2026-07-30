/* ═══════════════════════════════════════════════════════════════════════════
   Connecting agents to the memory server.

   Two problems, both about paths.

   First: the agent CLI spawns the MCP server itself, with plain `node` — so
   the script must be a real file that node can read. Inside a packaged app it
   would live in app.asar, which only Electron's patched fs can see. So the
   bundle is copied out to ~/.eaon/mcp/ and every config points there. That
   path also survives app updates and reinstalls, which a path into
   /Applications does not.

   Second: every agent stores its MCP config somewhere different, in a shape of
   its own. They are small files, so we write them rather than making the user
   hand-copy JSON into five places — merging into whatever is already there,
   and touching only our own key.
   ═══════════════════════════════════════════════════════════════════════════ */

import { execFile } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expandHome, memoryDir } from './store.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** The key every config file uses for this server. */
export const SERVER_KEY = 'eaon-memory';

const MCP_HOME = join(homedir(), '.eaon', 'mcp');
const SCRIPT_PATH = join(MCP_HOME, 'eaon-memory-mcp.mjs');

/* ── the runnable script ────────────────────────────────────────────────── */

/** Where the esbuild bundle lands, from wherever this module is running. */
function bundleCandidates(): string[] {
  return [
    // Packaged / built: index.js and memory-mcp.js are siblings in server/dist.
    join(__dirname, 'memory-mcp.js'),
    // tsx dev: server/src/memory → server/dist.
    resolve(__dirname, '../../dist/memory-mcp.js'),
    resolve(__dirname, '../dist/memory-mcp.js'),
  ];
}

function newestBundle(): string | null {
  let best: { path: string; mtime: number } | null = null;
  for (const candidate of bundleCandidates()) {
    try {
      const st = statSync(candidate);
      if (!st.isFile()) continue;
      if (!best || st.mtimeMs > best.mtime) best = { path: candidate, mtime: st.mtimeMs };
    } catch {
      // not there
    }
  }
  return best?.path ?? null;
}

/**
 * Dev has no bundle until someone runs a build, and "install the memory
 * server" failing because of that would be a baffling error. esbuild is
 * already a dependency of this repo in dev, so build it on the spot.
 */
async function buildFromSource(): Promise<boolean> {
  const source = join(__dirname, 'mcp.ts');
  if (!existsSync(source)) return false;
  try {
    const esbuild = (await import('esbuild')) as typeof import('esbuild');
    await esbuild.build({
      entryPoints: [source],
      outfile: SCRIPT_PATH,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      packages: 'external',
      logLevel: 'silent',
    });
    return existsSync(SCRIPT_PATH);
  } catch {
    return false;
  }
}

/**
 * Make sure ~/.eaon/mcp/eaon-memory-mcp.mjs exists and is current, and hand
 * back its path. Refreshed whenever the shipped bundle is newer, so upgrading
 * the app upgrades the server the agents are already pointed at.
 */
export async function ensureMcpScript(): Promise<string> {
  mkdirSync(MCP_HOME, { recursive: true });
  const bundle = newestBundle();

  if (bundle) {
    let needsCopy = true;
    try {
      needsCopy = statSync(bundle).mtimeMs > statSync(SCRIPT_PATH).mtimeMs;
    } catch {
      needsCopy = true;
    }
    if (needsCopy) {
      // Copy then rename: an agent may be spawning against this exact path
      // right now, and a half-written script is a very confusing failure.
      const tmp = `${SCRIPT_PATH}.tmp`;
      copyFileSync(bundle, tmp);
      renameSync(tmp, SCRIPT_PATH);
    }
    return SCRIPT_PATH;
  }

  if (existsSync(SCRIPT_PATH)) return SCRIPT_PATH;
  if (await buildFromSource()) return SCRIPT_PATH;
  throw new Error(
    'Could not find or build the memory MCP server bundle. Run "npm run build:server" and try again.',
  );
}

/* ── the node binary ────────────────────────────────────────────────────── */

const COMMON_NODE_PATHS = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/node',
  '/opt/local/bin/node',
];

let cachedNode: string | null = null;

/**
 * An absolute node, when we can find one. In the packaged app the server runs
 * inside Electron, so process.execPath is Electron and PATH is whatever
 * launchd handed the app — often not the one with the user's node in it.
 * Falling back to the bare name is still right: the agent CLI is itself
 * started from a shell that does have node on PATH.
 */
export async function nodeBinary(): Promise<string> {
  if (cachedNode) return cachedNode;
  try {
    const { stdout } = await execFileAsync('which', ['node']);
    const found = stdout.trim();
    if (found && existsSync(found)) return (cachedNode = found);
  } catch {
    // not on this PATH
  }
  for (const candidate of COMMON_NODE_PATHS) {
    if (existsSync(candidate)) return (cachedNode = candidate);
  }
  const own = process.execPath;
  if (own && /(^|\/)node(\.exe)?$/.test(own)) return (cachedNode = own);
  return (cachedNode = 'node');
}

/* ── config targets ─────────────────────────────────────────────────────── */

export type TargetId = 'claude' | 'cursor' | 'gemini' | 'vscode' | 'opencode';

interface TargetDef {
  id: TargetId;
  label: string;
  /** Path relative to the project root. */
  file: string;
  /** Which shape of MCP block the file wants. */
  shape: 'mcpServers' | 'servers' | 'opencode';
  note: string;
}

export const TARGETS: TargetDef[] = [
  { id: 'claude', label: 'Claude Code', file: '.mcp.json', shape: 'mcpServers', note: 'Project-scoped MCP config. Claude Code asks once to trust it.' },
  { id: 'cursor', label: 'Cursor', file: '.cursor/mcp.json', shape: 'mcpServers', note: 'Cursor and Cursor Agent read this.' },
  { id: 'gemini', label: 'Gemini CLI', file: '.gemini/settings.json', shape: 'mcpServers', note: 'Merged into the project settings file.' },
  { id: 'vscode', label: 'VS Code / Copilot', file: '.vscode/mcp.json', shape: 'servers', note: 'Uses the "servers" key rather than "mcpServers".' },
  { id: 'opencode', label: 'OpenCode', file: 'opencode.json', shape: 'opencode', note: 'OpenCode wants the command as one array.' },
];

export interface WiringEntry {
  id: TargetId;
  label: string;
  file: string;
  note: string;
  /** The config file exists and points at our current script path. */
  wired: boolean;
  /** Wired, but at a stale script or project path — re-wiring fixes it. */
  stale: boolean;
  exists: boolean;
}

export interface WiringStatus {
  /** Absolute path of the installed MCP script. */
  script: string;
  node: string;
  memoryDir: string;
  /** Ready-to-paste config for anything not in TARGETS (Codex, Aider, …). */
  snippet: string;
  targets: WiringEntry[];
}

function targetFile(projectPath: string, target: TargetDef): string {
  return join(resolve(expandHome(projectPath)), target.file);
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.eaon-tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function serverBlock(shape: TargetDef['shape'], node: string, script: string, projectPath: string): unknown {
  const args = [script, '--project', projectPath];
  if (shape === 'opencode') {
    return { type: 'local', command: [node, ...args], enabled: true };
  }
  return { type: 'stdio', command: node, args, env: {} };
}

function containerKey(shape: TargetDef['shape']): string {
  if (shape === 'servers') return 'servers';
  if (shape === 'opencode') return 'mcp';
  return 'mcpServers';
}

/** Does this existing block already point at the right script and project? */
function blockMatches(block: unknown, script: string, projectPath: string): boolean {
  if (!block || typeof block !== 'object') return false;
  const o = block as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.command === 'string') parts.push(o.command);
  if (Array.isArray(o.command)) parts.push(...o.command.map((c) => String(c)));
  if (Array.isArray(o.args)) parts.push(...o.args.map((a) => String(a)));
  const joined = parts.join(' ');
  return joined.includes(script) && joined.includes(projectPath);
}

export function readWiring(projectPath: string, script: string, node: string): WiringStatus {
  const project = resolve(expandHome(projectPath));
  const targets: WiringEntry[] = TARGETS.map((target) => {
    const file = targetFile(project, target);
    const exists = existsSync(file);
    const json = exists ? readJson(file) : null;
    const container = json?.[containerKey(target.shape)] as Record<string, unknown> | undefined;
    const block = container && typeof container === 'object' ? container[SERVER_KEY] : undefined;
    const present = block !== undefined;
    return {
      id: target.id,
      label: target.label,
      file: target.file,
      note: target.note,
      exists,
      wired: present && blockMatches(block, script, project),
      stale: present && !blockMatches(block, script, project),
    };
  });

  return {
    script,
    node,
    memoryDir: memoryDir(project),
    snippet: JSON.stringify(
      { mcpServers: { [SERVER_KEY]: serverBlock('mcpServers', node, script, project) } },
      null,
      2,
    ),
    targets,
  };
}

export function applyWiring(
  projectPath: string,
  targetIds: TargetId[],
  script: string,
  node: string,
  enable: boolean,
): { changed: TargetId[]; errors: { id: TargetId; error: string }[] } {
  const project = resolve(expandHome(projectPath));
  const changed: TargetId[] = [];
  const errors: { id: TargetId; error: string }[] = [];

  for (const id of targetIds) {
    const target = TARGETS.find((t) => t.id === id);
    if (!target) {
      errors.push({ id, error: `Unknown target "${id}"` });
      continue;
    }
    const file = targetFile(project, target);
    try {
      const existing = existsSync(file) ? readJson(file) : null;
      if (existsSync(file) && existing === null) {
        // Refusing beats clobbering: this file belongs to the user's editor
        // setup, and overwriting an unparseable one loses real configuration.
        errors.push({ id, error: `${target.file} is not valid JSON — fix or remove it first` });
        continue;
      }
      const json: Record<string, unknown> = existing ?? {};
      const key = containerKey(target.shape);
      const container =
        json[key] && typeof json[key] === 'object' && !Array.isArray(json[key])
          ? ({ ...(json[key] as Record<string, unknown>) })
          : {};

      if (enable) {
        container[SERVER_KEY] = serverBlock(target.shape, node, script, project);
        if (target.shape === 'opencode' && !json.$schema) json.$schema = 'https://opencode.ai/config.json';
      } else {
        if (!(SERVER_KEY in container)) continue;
        delete container[SERVER_KEY];
      }

      // Don't leave an empty file behind that we created ourselves.
      if (!enable && Object.keys(container).length === 0 && Object.keys(json).length <= 1) {
        rmSync(file, { force: true });
        changed.push(id);
        continue;
      }

      json[key] = container;
      writeJson(file, json);
      changed.push(id);
    } catch (err) {
      errors.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { changed, errors };
}
