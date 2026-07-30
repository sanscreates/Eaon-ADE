import { wsClient } from './ws';
import { markLocallySpawned } from './terminals';
import { useLayout } from '../store/layout';
import { useSessions } from '../store/sessions';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { useWorkspaces } from '../store/workspaces';
import { useClaude } from '../store/claude';
import { makeLeaf, findLeaf, leaves } from './layoutTree';
import { uid } from './utils';
import type { AgentPreset } from './types';

export interface SpawnRequest {
  command: string;
  args?: string[];
  cwd: string;
  title: string;
  agentId?: string;
  projectId?: string;
  prompt?: string;
  promptMode?: AgentPreset['promptMode'];
  /** Extra environment for the process, e.g. CLAUDE_CONFIG_DIR for a profile. */
  env?: Record<string, string>;
  /** 'active' reuses the active empty leaf; 'split' always splits; default picks sensibly */
  placement?: 'active' | 'split' | 'auto';
}

/**
 * Record a session locally the moment we ask for it, before the server has
 * echoed it back. Without this the grid reconciler sees the pane we just
 * created as belonging to a session that does not exist and prunes it, so a
 * new pane would flicker out and back in — and a whole pane template would
 * be torn down and rebuilt one confirmation at a time. The server's
 * `spawned` message overwrites this with the authoritative meta.
 */
function registerLocally(meta: {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  title: string;
  agentId?: string;
  projectId?: string;
}): void {
  useSessions.getState().upsert({
    ...meta,
    cols: 100,
    rows: 30,
    createdAt: Date.now(),
  });
}

export function spawnSession(req: SpawnRequest): string {
  const id = uid();
  markLocallySpawned(id);
  useWorkspaces.getState().claim(id);

  const args = [...(req.args ?? [])];
  let typedPrompt: string | null = null;
  if (req.prompt) {
    if (req.promptMode === 'arg') {
      args.push(req.prompt);
    } else {
      typedPrompt = req.prompt.replace(/\s*\n\s*/g, ' ');
    }
  }

  wsClient.send({
    t: 'spawn',
    id,
    command: req.command,
    args,
    cwd: req.cwd,
    title: req.title,
    agentId: req.agentId,
    projectId: req.projectId,
    env: req.env,
    cols: 100,
    rows: 30,
  });

  if (typedPrompt) {
    const prompt = typedPrompt;
    setTimeout(() => wsClient.send({ t: 'input', id, data: `${prompt}\r` }), 1800);
  }

  registerLocally({
    id,
    command: req.command,
    args,
    cwd: req.cwd,
    title: req.title,
    agentId: req.agentId,
    projectId: req.projectId,
  });
  // An explicit placement from the caller wins; otherwise the user's default
  // from Settings → General decides ('smart' reuses an empty pane first).
  const fallback = useSettings.getState().sessionPlacement === 'split' ? 'split' : 'auto';
  placeSession(id, req.placement ?? fallback);
  return id;
}

/** Route a session into the grid: reuse an empty active leaf, otherwise split. */
export function placeSession(sessionId: string, mode: 'active' | 'split' | 'auto' = 'auto'): void {
  // A session can be spawned while a Files/Browser/Board/etc. tab is on
  // screen (dispatch-from-Board is the common case) — there's no grid to
  // place it into until one is on screen, so switch to (or make) one first.
  useWorkspaces.getState().ensureGridTabActive();
  const layout = useLayout.getState();
  const { root, activeLeafId } = layout;

  if (!root) {
    const leaf = makeLeaf(sessionId);
    layout.setRoot(leaf);
    useLayout.setState({ activeLeafId: leaf.id });
    return;
  }

  const activeLeaf = activeLeafId ? findLeaf(root, activeLeafId) : null;
  if (mode !== 'split' && activeLeaf && activeLeaf.sessionId === null) {
    layout.assign(activeLeaf.id, sessionId);
    return;
  }

  const anchor = activeLeaf ?? leaves(root)[0];
  if (!anchor) return;
  layout.split(anchor.id, 'row', sessionId);
}

export function killSession(id: string): void {
  wsClient.send({ t: 'remove', id });
}

/**
 * Close a session, always asking first. Closing is only reachable from a
 * right-click menu now, so this is the second half of a deliberate two-step:
 * the menu says what will happen, the dialog confirms it. An already-exited
 * session still asks, so "close" behaves the same way every time rather than
 * silently doing something irreversible in one of the two cases.
 */
export function requestCloseSession(id: string): void {
  const state = useSessions.getState();
  const status = state.status[id];
  const alive = status !== undefined && status !== 'exited';
  const title = state.sessions[id]?.title ?? 'this session';
  useUi.getState().askConfirm({
    title: 'Close pane?',
    body: alive
      ? `The session “${title}” is still running. Closing the pane kills the process.`
      : `“${title}” has already exited. Closing removes its pane.`,
    confirmLabel: 'Close pane',
    danger: true,
    onConfirm: () => killSession(id),
  });
}

/* Sending into a *running* terminal lives in lib/dispatch.ts. Re-exported here
   because "spawn an agent" and "talk to an agent" are the same job from a call
   site's point of view, and splitting the import would be noise. */
export { sendToActiveAgent, sendToSession, sendToSessions } from './dispatch';

/** Everything `spawnAgent` needs beyond the preset itself. */
export interface SpawnAgentOptions {
  cwd: string;
  projectId?: string;
  title?: string;
  /** The first thing to say to the agent once it is up. */
  task?: string;
  /** Standing instruction: agent system prompt + role charter + member notes. */
  systemText?: string;
  env?: Record<string, string>;
  placement?: 'active' | 'split' | 'auto';
}

/**
 * The Claude profile the user picked in Settings, as environment. Every spawn
 * path goes through here so a one-click launch, a board dispatch and a swarm
 * member all sign in as the same account — they used to disagree.
 */
export function claudeAccountEnv(agentId: string): Record<string, string> | undefined {
  if (agentId !== 'claude') return undefined;
  const slug = useSettings.getState().claudeAccountSlug;
  if (!slug) return undefined;
  const account = useClaude.getState().accounts.find((a) => a.slug === slug);
  return account && !account.isSystem ? { CLAUDE_CONFIG_DIR: account.configDir } : undefined;
}

/**
 * Launch an agent from its full preset — args, env and standing instruction
 * included. `spawnSession` is the low-level "run this command"; this is the
 * one that knows what an *agent* is, and it is what every launcher should call
 * so a custom agent's args and a role's charter are never quietly dropped.
 *
 * How the instruction reaches the agent depends on the CLI: one that documents
 * a system-prompt flag gets it as a flag, and anything else has it folded into
 * the first message — which needs no cooperation from the CLI, and so is the
 * fallback rather than a failure.
 */
export function spawnAgent(preset: AgentPreset, opts: SpawnAgentOptions): string {
  const args = [...(preset.args ?? [])];
  const systemText = (opts.systemText ?? '').trim();
  let prompt = opts.task?.trim() ?? '';

  if (systemText) {
    if (preset.systemPromptFlag) {
      args.push(preset.systemPromptFlag, systemText);
    } else if (prompt) {
      prompt = `${systemText}\n\n${prompt}`;
    }
    // With neither a flag nor a task there is nothing to attach the brief to
    // yet; the caller sends it with the first task instead.
  }

  return spawnSession({
    command: preset.command,
    args,
    cwd: opts.cwd,
    title: opts.title ?? preset.name,
    agentId: preset.id,
    projectId: opts.projectId,
    prompt: prompt || undefined,
    promptMode: preset.promptMode,
    env: { ...(preset.env ?? {}), ...claudeAccountEnv(preset.id), ...(opts.env ?? {}) },
    placement: opts.placement,
  });
}

/** Spawn shells as needed and arrange exactly `n` panes in a balanced grid. */
export function applyPaneTemplate(n: number, opts: { cwd: string; projectId?: string; shellCommand: string }): void {
  useWorkspaces.getState().ensureGridTabActive();
  const layout = useLayout.getState();
  const existing = leaves(layout.root)
    .map((l) => l.sessionId)
    .filter((x): x is string => x !== null);

  const ids = [...existing];
  while (ids.length < n) {
    const id = uid();
    markLocallySpawned(id);
    useWorkspaces.getState().claim(id);
    wsClient.send({
      t: 'spawn',
      id,
      command: opts.shellCommand,
      args: [],
      cwd: opts.cwd,
      title: 'shell',
      agentId: 'shell',
      projectId: opts.projectId,
      cols: 100,
      rows: 30,
    });
    registerLocally({
      id,
      command: opts.shellCommand,
      args: [],
      cwd: opts.cwd,
      title: 'shell',
      agentId: 'shell',
      projectId: opts.projectId,
    });
    ids.push(id);
  }
  layout.applyTemplate(ids);
}

export function restartSession(id: string): void {
  const meta = useSessions.getState().sessions[id];
  if (!meta) return;
  killSession(id);
  // Give the server a tick to tear down, then respawn with the same spec.
  setTimeout(() => {
    spawnSession({
      command: meta.command,
      args: meta.args,
      cwd: meta.cwd,
      title: meta.title,
      agentId: meta.agentId,
      projectId: meta.projectId,
      promptMode: 'type',
    });
  }, 150);
}
