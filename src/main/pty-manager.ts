import os from 'node:os'
import { app } from 'electron'
import * as pty from 'node-pty'
import type { SpawnRequest } from '../shared/types'

/**
 * Variables that describe whatever launched Eaon rather than the terminal we
 * are about to open. A shell started from Finder never sees these, so neither
 * should ours — otherwise a CLI agent run inside Eaon inherits the session
 * markers of the process that started the app and quietly degrades itself.
 *
 * The login shell re-sources the user's profile, so anything they genuinely
 * set for themselves comes straight back.
 */
const DROP_PREFIXES = [
  'npm_', // npm/npx lifecycle vars — npm_config_prefix breaks nvm
  'ELECTRON_',
  'VITE_',
  'CLAUDE_CODE_',
  'VSCODE_',
  'CURSOR_'
]

const DROP_EXACT = new Set([
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'AI_AGENT',
  'INIT_CWD',
  'NODE_ENV',
  'NODE_OPTIONS',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'ITERM_SESSION_ID',
  'ITERM_PROFILE',
  'COLORFGBG',
  'CHROME_DESKTOP',
  'ORIGINAL_XDG_CURRENT_DESKTOP'
])

interface Session {
  proc: pty.IPty
  buffer: string[]
  timer: NodeJS.Timeout | null
  alive: boolean
  /** Command waiting for the shell to finish printing its prompt. */
  pendingCommand: string | null
  commandTimer: NodeJS.Timeout | null
  sawOutput: boolean
}

type Sender = (channel: string, payload: unknown) => void

/**
 * Owns every pseudo-terminal. Output is coalesced on a short timer before it
 * crosses the IPC boundary — with a dozen agents streaming at once, one message
 * per read would flood the renderer.
 *
 * Nothing thrown inside a node-pty callback may escape. node-pty delivers reads
 * on a thread-safe function, and an exception there is converted to a C++ throw
 * with no JS scope to catch it, which aborts the whole process. Every callback
 * body below is wrapped for that reason — a window closing mid-stream must not
 * be able to take the app down.
 */
export class PtyManager {
  private sessions = new Map<string, Session>()
  private readonly flushMs = 12
  private send: Sender = () => {}

  /** Called once at startup with a sender that resolves the live window. */
  setSender(sender: Sender): void {
    this.send = sender
  }

  private emit(channel: string, payload: unknown): void {
    try {
      this.send(channel, payload)
    } catch {
      /* the window went away between the check and the send */
    }
  }

  private defaultShell(): string {
    if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
    return process.env.SHELL || '/bin/zsh'
  }

  /** Login shells inherit the user's PATH, which is where `claude` usually lives. */
  private shellArgs(shell: string): string[] {
    if (process.platform === 'win32') return []
    return /(bash|zsh|fish)$/.test(shell) ? ['-l'] : []
  }

  /** The environment a freshly opened terminal window would actually have. */
  private buildEnv(paneId: string): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue
      if (DROP_EXACT.has(key)) continue
      if (DROP_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
      env[key] = value
    }

    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    // No space: TERM_PROGRAM is compared verbatim by shells and CLIs.
    env.TERM_PROGRAM = 'EaonADE'
    env.TERM_PROGRAM_VERSION = app.getVersion()
    env.EAON_PANE = paneId

    // Launched from Finder there is no locale, and every box-drawing character
    // in a CLI's UI turns to mojibake without one.
    if (!env.LC_ALL && !env.LC_CTYPE && !env.LANG) {
      env.LANG = 'en_US.UTF-8'
    }

    return env
  }

  spawn(req: SpawnRequest): { ok: boolean; error?: string } {
    this.kill(req.paneId)

    const shell = req.shell?.trim() || this.defaultShell()
    const cwd = req.cwd && req.cwd.length ? req.cwd : os.homedir()

    try {
      const proc = pty.spawn(shell, this.shellArgs(shell), {
        name: 'xterm-256color',
        cols: Math.max(20, req.cols || 80),
        rows: Math.max(5, req.rows || 24),
        cwd,
        env: this.buildEnv(req.paneId)
      })

      const session: Session = {
        proc,
        buffer: [],
        timer: null,
        alive: true,
        pendingCommand: req.command?.trim() || null,
        commandTimer: null,
        sawOutput: false
      }
      this.sessions.set(req.paneId, session)

      proc.onData((chunk) => {
        try {
          // Type the launch command once the shell has actually printed a
          // prompt. A dozen shells starting at once makes fixed delays unsafe.
          if (session.pendingCommand && !session.sawOutput) {
            session.sawOutput = true
            this.scheduleCommand(session, 400)
          }

          session.buffer.push(chunk)
          if (session.timer) return
          session.timer = setTimeout(() => {
            session.timer = null
            const data = session.buffer.join('')
            session.buffer.length = 0
            if (data) this.emit('pty:data', { paneId: req.paneId, data })
          }, this.flushMs)
        } catch {
          /* never let this reach node-pty's thread-safe function */
        }
      })

      proc.onExit(({ exitCode, signal }) => {
        try {
          session.alive = false
          if (session.timer) {
            clearTimeout(session.timer)
            session.timer = null
          }
          if (session.commandTimer) {
            clearTimeout(session.commandTimer)
            session.commandTimer = null
          }
          const tail = session.buffer.join('')
          session.buffer.length = 0
          if (tail) this.emit('pty:data', { paneId: req.paneId, data: tail })
          this.emit('pty:exit', { paneId: req.paneId, exitCode, signal })
          this.sessions.delete(req.paneId)
        } catch {
          this.sessions.delete(req.paneId)
        }
      })

      // Fallback for shells that print nothing at all before their prompt.
      if (session.pendingCommand) this.scheduleCommand(session, 2500)

      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[eaon] pty spawn failed for ${req.paneId} in ${cwd}:`, message)
      return { ok: false, error: message }
    }
  }

  /** Types the pending launch command exactly once, after `delay` ms. */
  private scheduleCommand(session: Session, delay: number): void {
    if (session.commandTimer) clearTimeout(session.commandTimer)
    session.commandTimer = setTimeout(() => {
      session.commandTimer = null
      const line = session.pendingCommand
      if (!line || !session.alive) return
      session.pendingCommand = null
      try {
        session.proc.write(`${line}\r`)
      } catch {
        /* the shell exited before it could be driven */
      }
    }, delay)
  }

  write(paneId: string, data: string): void {
    const s = this.sessions.get(paneId)
    if (!s?.alive) return
    try {
      s.proc.write(data)
    } catch {
      /* the shell exited between the check and the write */
    }
  }

  resize(paneId: string, cols: number, rows: number): void {
    const s = this.sessions.get(paneId)
    if (!s?.alive) return
    try {
      s.proc.resize(Math.max(20, Math.floor(cols)), Math.max(5, Math.floor(rows)))
    } catch {
      /* the process can exit between the check and the resize */
    }
  }

  kill(paneId: string): void {
    const s = this.sessions.get(paneId)
    if (!s) return
    s.alive = false
    if (s.timer) clearTimeout(s.timer)
    if (s.commandTimer) clearTimeout(s.commandTimer)
    s.buffer.length = 0
    try {
      s.proc.kill()
    } catch {
      /* already gone */
    }
    this.sessions.delete(paneId)
  }

  has(paneId: string): boolean {
    return this.sessions.get(paneId)?.alive === true
  }

  list(): string[] {
    return [...this.sessions.keys()]
  }

  /** Stops sending to the renderer, then tears every shell down. */
  killAll(): void {
    this.send = () => {}
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
