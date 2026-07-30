import { wsClient } from './ws';
import { useSessions } from '../store/sessions';
import { useLayout } from '../store/layout';
import { leaves } from './layoutTree';

/* ═══════════════════════════════════════════════════════════════════════════
   Sending text into running terminals.

   Every "make an agent do something" path in the app funnels through here —
   the swarm console, board dispatch, the browser's error hand-off, the command
   palette. Keeping it in one place is what makes the newline rule below hold
   everywhere instead of being re-remembered at each call site.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A CLI reads the first newline as "submit", so a multi-line prompt would run
 * as several separate commands — the first line as the task and the rest as
 * whatever the agent makes of them. Collapsing to one line is the only way to
 * hand over a paragraph intact.
 */
export function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isAlive(sessionId: string): boolean {
  const { sessions, status } = useSessions.getState();
  const meta = sessions[sessionId];
  if (!meta || meta.exitCode !== undefined) return false;
  return status[sessionId] !== 'exited';
}

export interface SendOptions {
  /** Press return afterwards. Off sends the text and leaves it for editing. */
  submit?: boolean;
  /** Keep newlines as-is. Only safe for a shell heredoc or a raw paste. */
  raw?: boolean;
}

/** Type text into one session as though the user had. */
export function sendToSession(sessionId: string, text: string, opts: SendOptions = {}): boolean {
  if (!isAlive(sessionId)) return false;
  const body = opts.raw ? text : flatten(text);
  if (!body) return false;
  wsClient.send({ t: 'input', id: sessionId, data: opts.submit === false ? body : `${body}\r` });
  return true;
}

/** Send the same text to many sessions. Returns how many actually took it. */
export function sendToSessions(sessionIds: string[], text: string, opts?: SendOptions): number {
  let sent = 0;
  for (const id of sessionIds) if (sendToSession(id, text, opts)) sent++;
  return sent;
}

/** Raw bytes — control characters, escape sequences, an interrupt. */
export function sendRaw(sessionId: string, data: string): boolean {
  if (!isAlive(sessionId)) return false;
  wsClient.send({ t: 'input', id: sessionId, data });
  return true;
}

/** Ctrl-C into a session, for stopping an agent mid-run without killing it. */
export function interruptSession(sessionId: string): boolean {
  return sendRaw(sessionId, '');
}

/** The session in the focused pane, if that pane holds a live one. */
export function activeSessionId(): string | null {
  const { activeLeafId, root } = useLayout.getState();
  if (!activeLeafId) return null;
  const leaf = leaves(root).find((l) => l.id === activeLeafId);
  const sessionId = leaf?.sessionId;
  return sessionId && isAlive(sessionId) ? sessionId : null;
}

/** Type a prompt into whichever agent pane is focused. */
export function sendToActiveAgent(text: string): boolean {
  const id = activeSessionId();
  return id ? sendToSession(id, text) : false;
}

/** Every live session belonging to a project — the broadcast target. */
export function liveSessionIds(projectId?: string): string[] {
  const { sessions, order } = useSessions.getState();
  return order.filter((id) => {
    const meta = sessions[id];
    if (!meta || !isAlive(id)) return false;
    return !projectId || !meta.projectId || meta.projectId === projectId;
  });
}
