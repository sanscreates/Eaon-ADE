import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';
import type { SessionMeta } from './types.js';

const MAX_BUFFER_CHARS = 400_000;

/**
 * Environment that describes *a particular agent session*, not the machine.
 *
 * Agent CLIs export these into everything they spawn so a nested run can tell
 * it is a child — and a child deliberately keeps no transcript and never shows
 * up in `/resume`. That is right for a tool call inside a session and wrong for
 * a pane here: every pane is a top-level session the user drives themselves.
 *
 * It leaks in whenever the ADE is launched from inside an agent (or from a
 * terminal that was), because the markers ride the whole chain — agent → shell
 * → Electron → this server → pty. Left alone, an ADE started that way quietly
 * strips history from every Claude pane it opens for the rest of its life.
 *
 * Only session identity is dropped. Anything that configures *how* an agent
 * runs — CLAUDE_CONFIG_DIR for account profiles, ANTHROPIC_*, install paths —
 * is the user's setup and is passed through untouched.
 */
const SESSION_SCOPED_ENV = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'AI_AGENT',
  // Codex and Cursor mark their children the same way.
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CURSOR_AGENT',
]);

/** The server's environment as a fresh session should see it. */
function inheritableEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || SESSION_SCOPED_ENV.has(key)) continue;
    env[key] = value;
  }
  return env;
}

interface SessionRecord {
  meta: SessionMeta;
  proc: pty.IPty;
  buffer: string;
  dead: boolean;
  /** The title as spawned — a rename away from it means the user chose it. */
  defaultTitle: string;
  /** ANSI-stripped recent output, scanned for agent TUI banners. */
  scanTail: string;
}

const ANSI_RE = /[][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

/**
 * When a user types `claude` (or gemini, or …) inside a plain shell pane, the
 * session was spawned as 'shell' and nothing would ever relabel it. The agent
 * announces itself in its output — a welcome banner, a branded status line —
 * so we watch shell-ish sessions for those signatures and adopt the identity.
 * Only high-precision markers qualify: the words must essentially never appear
 * unless that TUI is actually on screen. Matching the typed command instead
 * would misfire on `echo claude notes.md`.
 */
const AGENT_SIGNATURES: { agentId: string; name: string; re: RegExp }[] = [
  { agentId: 'claude', name: 'Claude Code', re: /Welcome to Claude Code|Claude Code v\d|Bypassing Permissions/ },
  { agentId: 'codex', name: 'Codex', re: /OpenAI Codex/ },
  { agentId: 'gemini', name: 'Gemini CLI', re: /Gemini CLI|Welcome to Gemini/ },
  { agentId: 'opencode', name: 'OpenCode', re: /\bOpenCode\b/ },
  { agentId: 'cursor-agent', name: 'Cursor Agent', re: /Cursor Agent/ },
  { agentId: 'aider', name: 'Aider', re: /Aider v\d/ },
];

export interface SpawnOptions {
  id: string;
  command: string;
  args?: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  title?: string;
  projectId?: string;
  agentId?: string;
}

class SessionManager extends EventEmitter {
  private sessions = new Map<string, SessionRecord>();

  list(): SessionMeta[] {
    return [...this.sessions.values()].map((s) => ({ ...s.meta }));
  }

  get(id: string): SessionMeta | undefined {
    const rec = this.sessions.get(id);
    return rec ? { ...rec.meta } : undefined;
  }

  replay(id: string): string | undefined {
    return this.sessions.get(id)?.buffer;
  }

  spawn(opts: SpawnOptions): SessionMeta {
    const cols = Math.max(2, opts.cols ?? 80);
    const rows = Math.max(2, opts.rows ?? 24);
    const proc = pty.spawn(opts.command, opts.args ?? [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.cwd,
      env: {
        ...inheritableEnv(),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'Eaon',
        ...(opts.env ?? {}),
      },
    });

    const meta: SessionMeta = {
      id: opts.id,
      title: opts.title ?? opts.command,
      command: opts.command,
      args: opts.args ?? [],
      cwd: opts.cwd,
      projectId: opts.projectId,
      agentId: opts.agentId,
      pid: proc.pid,
      cols,
      rows,
      createdAt: Date.now(),
    };

    const rec: SessionRecord = {
      meta,
      proc,
      buffer: '',
      dead: false,
      defaultTitle: meta.title,
      scanTail: '',
    };

    proc.onData((data) => {
      rec.buffer += data;
      if (rec.buffer.length > MAX_BUFFER_CHARS) {
        rec.buffer = rec.buffer.slice(rec.buffer.length - MAX_BUFFER_CHARS);
      }
      this.maybeAdoptAgent(rec, data);
      this.emit('output', opts.id, data);
    });

    proc.onExit(({ exitCode }) => {
      rec.dead = true;
      rec.meta.exitCode = exitCode;
      this.emit('exit', opts.id, exitCode);
    });

    this.sessions.set(opts.id, rec);
    return { ...meta };
  }

  /**
   * Upgrade a shell-ish session's identity when an agent's TUI signature
   * appears in its output. Sticky in one direction only — when the agent
   * exits and the shell prompt returns, the label stays (the pane still
   * holds that agent's transcript, so the identity remains honest).
   */
  private maybeAdoptAgent(rec: SessionRecord, data: string): void {
    const { agentId } = rec.meta;
    if (agentId !== undefined && agentId !== 'shell') return;

    rec.scanTail = (rec.scanTail + data.replace(ANSI_RE, '')).slice(-2000);
    const match = AGENT_SIGNATURES.find((s) => s.re.test(rec.scanTail));
    if (!match) return;

    rec.meta.agentId = match.agentId;
    // Retitle only a session still wearing its spawn default — never stomp a
    // name the user typed themselves.
    if (rec.meta.title === rec.defaultTitle) rec.meta.title = match.name;
    rec.scanTail = '';
    this.emit('agent-detected', rec.meta.id, match.agentId, rec.meta.title);
  }

  write(id: string, data: string): void {
    const rec = this.sessions.get(id);
    if (!rec || rec.dead) return;
    rec.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const rec = this.sessions.get(id);
    if (!rec || rec.dead) return;
    if (cols < 2 || rows < 2) return;
    rec.meta.cols = cols;
    rec.meta.rows = rows;
    try {
      rec.proc.resize(cols, rows);
    } catch {
      // pty may be mid-teardown; safe to ignore
    }
  }

  rename(id: string, title: string): void {
    const rec = this.sessions.get(id);
    if (rec) rec.meta.title = title;
  }

  kill(id: string): void {
    const rec = this.sessions.get(id);
    if (!rec || rec.dead) return;
    try {
      rec.proc.kill();
    } catch {
      // already gone
    }
  }

  remove(id: string): void {
    this.kill(id);
    this.sessions.delete(id);
    this.emit('removed', id);
  }

  shutdown(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}

export const sessionManager = new SessionManager();
