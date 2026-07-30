import { useSessions } from '../store/sessions';
import { useSettings } from '../store/settings';

/**
 * The notification engine. Watches session status transitions and turns the
 * two that matter into signals:
 *
 *   working → waiting   the agent is blocked on you (a prompt, a y/n)
 *   *       → exited    the process ended, with its exit code
 *
 * System notifications only fire while the window is blurred — tapping you
 * on the shoulder while you're already looking at the pane is noise, and
 * macOS apps have trained us to expect that restraint. Sounds are the
 * opposite channel: they play even while focused, because you might be
 * staring at a different pane in the grid.
 */

type SessionStatus = ReturnType<typeof useSessions.getState>['status'][string];

let started = false;

/* ---- sound ------------------------------------------------------------- */

let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    if (!audio) audio = new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  at: number; // seconds from now
  dur: number;
}

/**
 * A tiny two-note chime — synthesized, no asset to ship. `kind` shifts the
 * intervals: waiting rises (a question), exiting falls (a full stop).
 * Volume is a percentage; the 0.22 ceiling keeps 100% assertive but polite.
 */
export function playChime(kind: 'waiting' | 'exit', volumePct?: number): void {
  const volume = Math.max(0, Math.min(100, volumePct ?? useSettings.getState().soundVolume));
  if (volume === 0) return;
  const ctx = audioContext();
  if (!ctx) return;

  const notes: Note[] =
    kind === 'waiting'
      ? [
          { freq: 987.77, at: 0, dur: 0.09 }, // B5
          { freq: 1318.51, at: 0.07, dur: 0.16 }, // E6
        ]
      : [
          { freq: 783.99, at: 0, dur: 0.1 }, // G5
          { freq: 587.33, at: 0.08, dur: 0.18 }, // D5
        ];

  const peak = 0.22 * (volume / 100);
  const t0 = ctx.currentTime + 0.01;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = n.freq;
    gain.gain.setValueAtTime(0, t0 + n.at);
    gain.gain.linearRampToValueAtTime(peak, t0 + n.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.02);
  }
}

/* ---- notifications ----------------------------------------------------- */

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

function fire(title: string, body: string): void {
  if (notificationPermission() !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: `eaon-${title}` });
    n.onclick = () => window.focus();
  } catch {
    // Some runtimes (older Electron) require the service-worker path; ignore.
  }
}

/* ---- the watcher -------------------------------------------------------- */

export function initNotifyEngine(): void {
  if (started) return;
  started = true;

  let prev: Record<string, SessionStatus> = { ...useSessions.getState().status };

  useSessions.subscribe((state) => {
    const next = state.status;
    for (const id of Object.keys(next)) {
      const from = prev[id];
      const to = next[id];
      if (from === to) continue;

      const settings = useSettings.getState();
      const meta = state.sessions[id];
      const name = meta?.title ?? 'Session';

      if (to === 'waiting' && from !== 'exited') {
        if (settings.soundEnabled) playChime('waiting', settings.soundVolume);
        if (settings.notifyEnabled && settings.notifyWaiting && !document.hasFocus()) {
          fire(name, 'is waiting for your input');
        }
      }

      if (to === 'exited' && from !== 'exited') {
        if (settings.soundEnabled) playChime('exit', settings.soundVolume);
        if (settings.notifyEnabled && settings.notifyExit && !document.hasFocus()) {
          const code = meta?.exitCode;
          fire(name, code === 0 ? 'finished' : `exited with code ${code ?? '?'}`);
        }
      }
    }
    prev = { ...next };
  });
}
