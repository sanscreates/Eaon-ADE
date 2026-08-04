import { shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import * as pty from 'node-pty'
import { IDLE_LOGIN, type LoginState } from '../shared/accounts'

/**
 * Signing in to a new account, with Claude Code doing the signing in.
 *
 * The OAuth exchange is not reimplemented here and could not safely be: it
 * belongs to Claude Code, which owns the client it is registered as. What this
 * does is run Claude Code against an empty configuration directory, watch what
 * it prints, and carry the two things a person would otherwise have to move by
 * hand — the address, which goes to the browser, and the code the browser gives
 * back, which goes to the terminal nobody is looking at.
 *
 * Measured, against a fresh directory: it is not a login prompt first. A new
 * configuration directory starts onboarding — a theme picker, then a choice of
 * login method — and only then offers the address. The redirect is
 * `platform.claude.com`, not a port on this machine, so there is no callback to
 * catch; it ends at "Paste code here if prompted", which is what the dialog
 * asks for.
 *
 * Every step waits for the screen that step belongs to rather than for a number
 * of seconds. Onboarding gains and loses screens between versions, and a flow
 * built out of sleeps would appear to work until the day it silently answered
 * the wrong question. If a screen never arrives, the sign-in gives up and hands
 * back what it saw, so it can be finished by hand instead of failing blankly.
 */

/**
 * How long a screen must have been showing before it is answered.
 *
 * A full-screen interface draws in pieces, and the words that identify a screen
 * arrive before it is ready to take a keystroke. Answering the first frame that
 * mentions the theme picker sent Return into a screen that was still painting;
 * it went nowhere, and the sign-in then waited for a screen that had already
 * been and gone. Measured, against the real thing.
 */
const SETTLE_MS = 1400

/** Re-checked on a timer, because a screen with a spinner never stops arriving. */
const RECHECK_MS = 400

/** Long enough for a slow first start; short enough to admit defeat. */
const STEP_TIMEOUT_MS = 60_000
const OVERALL_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Screens that stand between a new directory and the address.
 *
 * Matched without spaces. A full-screen terminal interface does not separate
 * its words with spaces, it moves the cursor between them, so once the escape
 * sequences are gone "Choose the text style" has become "Choosethetextstyle".
 * Patterns written the way the words look on screen match nothing at all, and
 * that is a sign-in that hangs rather than one that fails.
 */
export const STEPS: { name: string; when: RegExp; send: string }[] = [
  { name: 'theme', when: /textstyle|darkmode|lightmode/, send: '\r' },
  { name: 'login method', when: /selectloginmethod|accountwithsubscription/, send: '\r' }
]

/** The visible text, with the escape sequences carrying the layout removed. */
export function clean(raw: string): string {
  return (
    raw
      /*
       * Hyperlinks arrive as OSC 8, and the address is *inside* the sequence:
       * ESC ] 8 ; params ; URI BEL. Dropping the sequence whole therefore
       * throws away the one copy of the address that is not broken across a
       * line — measured, and it left nothing on screen but a 150-character
       * fragment with no challenge or state in it. So the URI is kept and the
       * wrapper around it discarded.
       */
      .replace(/\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g, '\n$1\n')
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b[()][A-Z0-9]/g, '')
      .replace(/\x1b[=>]/g, '')
      .replace(/\x00/g, '')
  )
}

/** Everything on screen run together, which is what the steps match against. */
export function flatten(raw: string): string {
  return clean(raw).replace(/\s+/g, '').toLowerCase()
}

/**
 * The sign-in address, out of the several partial copies on screen.
 *
 * It is printed once wrapped across the width of the terminal and again inside
 * the hyperlink escape, and the wrapping leaves fragments that still look like
 * addresses. Taking the longest one that carries both the challenge and the
 * state is what distinguishes the whole address from a piece of it — and
 * sending somebody to a truncated one produces an error page rather than a
 * sign-in.
 */
export function pickUrl(text: string): string | null {
  const found = text.match(/https:\/\/[^\s"'<>)\]]*oauth\/authorize[^\s"'<>)\]]*/g)
  if (!found) return null
  const whole = found
    .filter((u) => u.includes('code_challenge=') && u.includes('state='))
    .sort((a, b) => b.length - a.length)[0]
  return whole ?? null
}

export type LoginListener = (state: LoginState) => void

export class AccountLogin {
  private proc: pty.IPty | null = null
  private seen = ''
  private state: LoginState = { ...IDLE_LOGIN }
  private listener: LoginListener = () => {}
  private timers: NodeJS.Timeout[] = []
  private settled = false

  constructor(
    private readonly configDir: string,
    private readonly onFinished: (ok: boolean) => void
  ) {}

  onState(listener: LoginListener): void {
    this.listener = listener
  }

  current(): LoginState {
    return this.state
  }

  private emit(next: Partial<LoginState>): void {
    this.state = { ...this.state, ...next }
    try {
      this.listener(this.state)
    } catch {
      /* the window went away mid sign-in */
    }
  }

  /** The last few lines Claude Code drew, for when the flow is not recognised. */
  private tail(): string {
    return clean(this.seen)
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim())
      .slice(-12)
      .join('\n')
  }

  start(): void {
    if (this.proc) return
    this.emit({ phase: 'starting', url: null, error: null, output: null })

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue
      // The same markers PtyManager drops. Inheriting this app's own agent
      // session would turn transcript saving off and confuse the sign-in about
      // whose session it is.
      if (/^(npm_|ELECTRON_|VITE_|CLAUDE_CODE_|VSCODE_|CURSOR_)/.test(key)) continue
      if (['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'NODE_ENV', 'NODE_OPTIONS'].includes(key)) {
        continue
      }
      env[key] = value
    }
    env.TERM = 'xterm-256color'
    env.CLAUDE_CONFIG_DIR = this.configDir
    // Claude Code opens the address itself given the chance. It is opened from
    // here instead, once it is known, so a browser never appears before the
    // dialog has said why.
    env.BROWSER = process.platform === 'win32' ? 'cmd /c exit' : '/usr/bin/true'

    try {
      // `exec`, so the login shell becomes the agent rather than parenting it.
      // Killing a shell that merely started the agent leaves the agent running,
      // and it goes on writing to the very directory an abandoned sign-in is
      // about to have deleted — which is how a cancelled sign-in left one
      // behind and offered it as an account.
      this.proc = pty.spawn(env.SHELL || '/bin/sh', ['-lc', 'exec claude'], {
        name: 'xterm-256color',
        cols: 150,
        rows: 45,
        cwd: this.configDir,
        env
      })
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err))
      return
    }

    this.proc.onData((chunk) => {
      try {
        this.seen += chunk
        // Only the tail is ever needed, and a login screen redraws constantly.
        if (this.seen.length > 400_000) this.seen = this.seen.slice(-200_000)
        this.advance()
      } catch {
        /* never throw inside a node-pty callback */
      }
    })

    this.proc.onExit(() => {
      try {
        if (!this.settled) this.fail('Sign-in closed before it finished.')
      } catch {
        /* as above */
      }
    })

    this.after(OVERALL_TIMEOUT_MS, () => this.fail('Sign-in timed out.'))
    const tick = setInterval(() => {
      try {
        if (!this.settled) this.advance()
      } catch {
        /* a bad frame must not stop the sign-in */
      }
    }, RECHECK_MS)
    this.timers.push(tick)
    this.expect()
  }

  private after(ms: number, fn: () => void): void {
    const t = setTimeout(fn, ms)
    this.timers.push(t)
  }

  /** Fails the sign-in if the screen we are waiting for never turns up. */
  private stepTimer: NodeJS.Timeout | null = null
  private expect(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer)
    this.stepTimer = setTimeout(() => {
      if (this.settled || this.state.phase === 'code') return
      this.emit({ output: this.tail() })
      this.fail('Could not follow the sign-in. What it showed is below.')
    }, STEP_TIMEOUT_MS)
  }

  private stepIndex = 0
  /** When the screen this step belongs to was first seen. */
  private stepSince = 0

  private advance(): void {
    // Answer whichever onboarding screen is showing, in order, once each — but
    // only after it has been showing long enough to be listening.
    if (this.stepIndex < STEPS.length) {
      const step = STEPS[this.stepIndex]
      if (!step.when.test(flatten(this.seen))) {
        this.stepSince = 0
        return
      }
      if (!this.stepSince) this.stepSince = Date.now()
      if (Date.now() - this.stepSince < SETTLE_MS) return

      this.stepIndex += 1
      this.stepSince = 0
      // Forget what has been drawn so the screen just answered cannot match the
      // next step as well, and so a redraw of it cannot answer it twice.
      this.seen = ''
      this.proc?.write(step.send)
      this.expect()
      return
    }

    if (!this.state.url) {
      const url = pickUrl(clean(this.seen))
      if (url) {
        this.emit({ phase: 'code', url })
        this.expect()
        try {
          void shell.openExternal(url)
        } catch {
          this.emit({ output: 'Could not open your browser. Open the address above by hand.' })
        }
      }
      return
    }

    // Credentials appearing is the only reliable sign it worked; the screen
    // that follows a sign-in has changed before and will change again.
    if (this.credentialsPresent()) this.succeed()
  }

  private credentialsPresent(): boolean {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(this.configDir, '.credentials.json'), 'utf8')
      ) as { claudeAiOauth?: { accessToken?: string } }
      return !!raw.claudeAiOauth?.accessToken
    } catch {
      return false
    }
  }

  /** The code shown in the browser after the account is approved. */
  submitCode(code: string): void {
    const clean = code.trim()
    if (!this.proc || !clean) return
    this.emit({ phase: 'finishing' })
    this.proc.write(`${clean}\r`)
    // The terminal is not asked whether it worked; the credentials file is.
    let tries = 0
    const poll = setInterval(() => {
      tries += 1
      if (this.settled) {
        clearInterval(poll)
        return
      }
      if (this.credentialsPresent()) {
        clearInterval(poll)
        this.succeed()
      } else if (tries > 40) {
        clearInterval(poll)
        this.emit({ output: this.tail() })
        this.fail('That code did not complete the sign-in.')
      }
    }, 500)
    this.timers.push(poll)
  }

  private succeed(): void {
    if (this.settled) return
    this.settled = true
    this.emit({ phase: 'done', error: null })
    this.stop()
    this.onFinished(true)
  }

  private fail(message: string): void {
    if (this.settled) return
    this.settled = true
    this.emit({ phase: 'error', error: message })
    this.stop()
    // The agent is killed above, but a directory removed while it is still
    // exiting gets written again on its way out and comes back.
    setTimeout(() => this.onFinished(false), 900)
  }

  /** Ends the sign-in. Safe at any point, including before it started. */
  stop(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer)
    this.stepTimer = null
    for (const t of this.timers) clearTimeout(t as NodeJS.Timeout)
    this.timers = []
    const proc = this.proc
    this.proc = null
    try {
      proc?.kill()
    } catch {
      /* already gone */
    }
  }

  cancel(): void {
    if (!this.settled) {
      this.settled = true
      this.emit({ phase: 'error', error: 'Sign-in cancelled.' })
    }
    this.stop()
    setTimeout(() => this.onFinished(false), 900)
  }
}
