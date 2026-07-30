import { create } from 'zustand';
import { wsClient } from './ws';
import { writeToTerminal, disposeTerminal, refitAllTerminals } from './terminals';
import { useSessions, noteSessionOutput, noteSessionInput, clearSessionTracking } from '../store/sessions';
import { useLayout } from '../store/layout';
import { useUi } from '../store/ui';
import { useProjects } from '../store/projects';
import { useAgents } from '../store/agents';
import { useBoard } from '../store/board';
import { useGit } from '../store/git';
import { initNotifyEngine } from './notify';
import { noteClaudeSessionEnded } from '../store/claude';
import type { SessionMeta } from './types';

export const useConnection = create<{ connected: boolean }>(() => ({ connected: false }));

let booted = false;

interface WindowState {
  focused: boolean;
  fullScreen: boolean;
}

interface EaonDesktop {
  isApp: boolean;
  platform: string;
  onWindowState?: (handler: (state: WindowState) => void) => () => void;
}

/**
 * Mirror desktop window state onto the root element so CSS can respond to it.
 * A Mac app recedes when its window loses focus and reclaims the traffic-light
 * gutter in full screen — neither is expressible in a browser tab.
 */
function trackWindowState(): void {
  const root = document.documentElement;
  const desktop = (window as unknown as { eaonDesktop?: EaonDesktop }).eaonDesktop;
  if (!desktop?.isApp) return;

  root.setAttribute('data-desktop', '');
  root.toggleAttribute('data-window-blurred', !document.hasFocus());

  // Focus is observable directly; full screen has to come over the bridge.
  window.addEventListener('focus', () => root.removeAttribute('data-window-blurred'));
  window.addEventListener('blur', () => root.setAttribute('data-window-blurred', ''));
  desktop.onWindowState?.((state) => {
    root.toggleAttribute('data-window-blurred', !state.focused);
    root.toggleAttribute('data-fullscreen', state.fullScreen);
  });
}

/**
 * While the window is hidden or occluded, fitTerminal refuses to run (a
 * degenerate size there is what used to shrink Claude Code to a sliver).
 * When the window comes back, refit everything so any swallowed resize �
 * or one baked in by a Space/minimize transition � heals immediately.
 * The double rAF lets the window manager settle before we measure.
 */
function healTerminalSizes(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => refitAllTerminals()));
}

function trackTerminalHealing(): void {
  window.addEventListener('focus', healTerminalSizes);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) healTerminalSizes();
  });
}

export function bootstrap(): void {
  if (booted) return;
  booted = true;

  trackWindowState();
  trackTerminalHealing();
  initNotifyEngine();
  wsClient.connect();

  wsClient.onMessage((msg) => {
    const sessions = useSessions.getState();
    const layout = useLayout.getState();
    const ui = useUi.getState();

    switch (msg.t) {
      case '__open': {
        const wasDown = !useConnection.getState().connected;
        useConnection.setState({ connected: true });
        wsClient.send({ t: 'list' });
        // A reconnect means the server restarted, so anything fetched over
        // HTTP is stale or was never fetched. Pull it again.
        if (wasDown) {
          const project = useProjects
            .getState()
            .projects.find((p) => p.id === useProjects.getState().activeId);
          useAgents.getState().fetch();
          if (project) {
            useBoard.getState().load(project.path);
            useGit.getState().refresh(project.path);
          }
        }
        break;
      }
      case '__close': {
        useConnection.setState({ connected: false });
        break;
      }
      case 'sessions': {
        sessions.upsertMany(msg.sessions as SessionMeta[]);
        break;
      }
      case 'spawned': {
        const meta = msg.session as SessionMeta;
        sessions.upsert(meta);
        sessions.setStatus(meta.id, 'idle');
        break;
      }
      case 'replay': {
        const meta = msg.session as SessionMeta;
        sessions.upsert(meta);
        if (typeof msg.data === 'string' && msg.data) {
          writeToTerminal(meta.id, msg.data);
        }
        sessions.setStatus(meta.id, meta.exitCode !== undefined ? 'exited' : 'idle');
        break;
      }
      case 'output': {
        const id = msg.id as string;
        writeToTerminal(id, msg.data as string);
        noteSessionOutput(id, msg.data as string);
        break;
      }
      case 'exit': {
        const id = msg.id as string;
        const code = msg.code as number;
        // Claude Code rewrites its credentials on every run, so a Claude pane
        // finishing is the moment a stale token most likely became valid.
        if (sessions.sessions[id]?.agentId === 'claude') noteClaudeSessionEnded();
        sessions.setExit(id, code);
        clearSessionTracking(id);
        writeToTerminal(id, `\r\n[2m[process exited · code ${code}][0m\r\n`);
        break;
      }
      case 'removed': {
        const id = msg.id as string;
        disposeTerminal(id);
        clearSessionTracking(id);
        sessions.removeLocal(id);
        layout.closeBySession(id);
        break;
      }
      case 'renamed': {
        sessions.rename(msg.id as string, msg.title as string);
        break;
      }
      case 'memory-changed': {
        // The memory folder changed on disk — almost always an agent writing
        // a note through MCP, which is invisible to this app otherwise. Pull
        // it in so the graph reflects what the agents actually know.
        void import('../store/memory').then((m) =>
          m.useMemory.getState().noteExternalChange(String(msg.project ?? '')),
        );
        break;
      }
      case 'agent-detected': {
        // A shell pane revealed itself to be running an agent (e.g. the user
        // typed `claude`). Adopt the identity so the sidebar, sessions page
        // and notifications all describe what's actually inside.
        sessions.setAgent(msg.id as string, msg.agentId as string, msg.title as string | undefined);
        break;
      }
      case 'error': {
        ui.toast(String(msg.message ?? 'Unknown error'), 'error');
        const id = msg.id as string | undefined;
        if (id) {
          disposeTerminal(id);
          sessions.removeLocal(id);
          layout.closeBySession(id);
        }
        break;
      }
    }
  });
}

/** Note user keystrokes for status detection (called from terminal input path). */
export function noteInput(id: string): void {
  noteSessionInput(id);
}
