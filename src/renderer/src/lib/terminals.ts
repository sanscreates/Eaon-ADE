import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { getTheme, type TerminalPalette } from '@shared/themes'
import type { PaneStatus, Settings } from '@shared/types'
import { IS_MAC, commandFor } from './keys'
import { stripAnsi } from './util'

/** Patterns that mean the agent has stopped and is waiting on a human. */
const WAITING = [
  /do you want to (proceed|continue|allow)/i,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /press enter to continue/i,
  /enter to confirm/i,
  /esc to cancel/i,
  /waiting for your input/i,
  /permission (to|request)/i
]

/**
 * Context readouts agents print in their status lines. Everything is
 * normalised to "percent used" so one pill means one thing across agents.
 */
const CONTEXT_PATTERNS: { re: RegExp; reportsRemaining: boolean }[] = [
  { re: /context left until auto-compact:\s*(\d{1,3})\s*%/i, reportsRemaining: true },
  { re: /(\d{1,3})\s*%\s*context\s*(?:left|remaining)/i, reportsRemaining: true },
  { re: /context(?:\s+window)?(?:\s+used)?:\s*(\d{1,3})\s*%/i, reportsRemaining: false },
  { re: /\d+(?:\.\d+)?k\s*\((\d{1,3})%\)/i, reportsRemaining: false }
]

/**
 * What the Command key does to a line of text everywhere else on a Mac.
 *
 * These are the readline control codes, not the arrow-key escapes: a shell,
 * a REPL and an agent's own prompt all bind ^A/^E/^U, while `ESC[H` style
 * sequences are only understood by some of them.
 */
const MAC_LINE_EDITING: Record<string, string> = {
  ArrowLeft: '\x01', // beginning of line
  ArrowRight: '\x05', // end of line
  Backspace: '\x15' // kill to the start of the line
}

/** What should happen to a key pressed inside a pane. */
export type KeyVerdict =
  | { do: 'terminal' }
  | { do: 'app' }
  | { do: 'send'; data: string }
  | { do: 'selectAll' }
  | { do: 'copy' }
  | { do: 'paste' }

/** Only the fields the decision depends on, so it can be exercised directly. */
export type KeyLike = Pick<
  KeyboardEvent,
  'type' | 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'
> & { code?: string }

/** What the pane knows that the key alone does not. */
export interface KeyContext {
  /** Whether anything is selected, which is what makes Ctrl+C ambiguous. */
  hasSelection?: boolean
}

/**
 * Decide who owns a keypress: the shell, the app, or this layer.
 *
 * Kept apart from xterm so the mapping can be checked on its own — the whole
 * bug class here is "two different keys send the same bytes", which is
 * invisible from the outside and obvious from a table.
 */
export function resolveKey(e: KeyLike, ctx: KeyContext = {}): KeyVerdict {
  if (e.type !== 'keydown') return { do: 'terminal' }

  /*
   * Shift+Enter opens a line instead of submitting one.
   *
   * A terminal has no way to say this on its own: Enter and Shift+Enter both
   * arrive as a bare CR, so the agent on the other end cannot tell them apart
   * and treats every one as "send". ESC CR is the sequence CLI agents read as
   * "newline, do not send" — the same thing iTerm2 and VS Code users bind by
   * hand to make Shift+Enter work.
   *
   * Alt+Enter already produces this via macOptionIsMeta, so both work.
   */
  if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return { do: 'send', data: '\x1b\r' }
  }

  if (!IS_MAC) {
    /*
     * Windows and Linux have one modifier, and the shell already owns every
     * bare Control chord — ^C interrupts, ^D ends input, ^W deletes a word,
     * ^K kills a line. None of them can become application shortcuts without
     * leaving an agent you cannot exit. So the app takes Ctrl+Shift, and
     * anything else Control does goes straight through.
     */
    const command = commandFor(e)
    if (command === 'selectAll') return { do: 'selectAll' }
    if (command) return { do: 'app' }

    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const key = e.key.toLowerCase()
      // Ctrl+Shift+C and Ctrl+Shift+V, which is where every Windows terminal
      // puts the clipboard precisely because Ctrl+C is spoken for.
      if (e.shiftKey && key === 'c') return { do: 'copy' }
      if (e.shiftKey && key === 'v') return { do: 'paste' }

      /*
       * Bare Ctrl+C is the one genuine ambiguity on this platform: copy, or
       * interrupt? Windows Terminal resolves it by what is on screen — with a
       * selection it copies, without one it interrupts — and that is what a
       * Windows user's hands already expect.
       */
      if (!e.shiftKey && key === 'c' && ctx.hasSelection) return { do: 'copy' }
      if (!e.shiftKey && key === 'v') return { do: 'paste' }
    }

    return { do: 'terminal' }
  }

  // Command-key combos belong to the app, not the shell, apart from the handful
  // a terminal is expected to own itself.
  if (e.metaKey) {
    const key = e.key.toLowerCase()

    // Select-all has to be done by the terminal. Left to the browser it selects
    // the contents of xterm's hidden input, which is empty, so the binding the
    // app advertises would quietly do nothing.
    if (key === 'a') return { do: 'selectAll' }

    // The line-editing keys every other macOS text field has. Sent as readline
    // control codes rather than arrow escapes, because those are what shells
    // and the agents' own prompts actually bind.
    const editing = MAC_LINE_EDITING[e.key]
    if (editing) return { do: 'send', data: editing }

    // Copy and paste stay with the browser, which already routes them through
    // xterm's own clipboard handling. Everything else is an app shortcut.
    return key === 'c' || key === 'v' ? { do: 'terminal' } : { do: 'app' }
  }

  return { do: 'terminal' }
}

export interface TerminalEvents {
  onTitle: (paneId: string, title: string) => void
  onStatus: (paneId: string, status: PaneStatus) => void
  onContext: (paneId: string, pct: number) => void
  onExit: (paneId: string, code: number) => void
}

interface Runtime {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  wrapper: HTMLDivElement
  host: HTMLElement | null
  observer: ResizeObserver | null
  /** Last size actually sent to the PTY, so we never resend the same one. */
  sentCols: number
  sentRows: number
  fitTimer: number | null
  lastData: number
  status: PaneStatus
  /** Rolling plain-text tail used for status-line parsing. */
  tail: string
  contextPct: number | null
  spawned: boolean
  /** GPU renderer, or null when this pane fell back to the DOM one. */
  webgl: WebglAddon | null
  disposers: (() => void)[]
}

const TICK_MS = 400
const IDLE_MS = 1800

/**
 * Owns every xterm instance. Terminals outlive their React components — each
 * one lives in a detached wrapper element that gets re-parented as you move
 * between workspaces, so a background agent keeps streaming while you're away.
 */
class TerminalRegistry {
  private panes = new Map<string, Runtime>()
  private events: TerminalEvents | null = null
  private settings: Settings | null = null
  private ticker: number | null = null
  private palette: ITheme = getTheme(undefined).terminal
  private resizeListeners = new Map<string, (cols: number, rows: number) => void>()

  init(events: TerminalEvents, settings: Settings): void {
    this.events = events
    this.settings = settings
    if (this.ticker === null) {
      this.ticker = window.setInterval(() => this.tick(), TICK_MS)
    }
  }

  /** Repaints every open terminal when the theme changes. */
  applyPalette(palette: TerminalPalette): void {
    this.palette = palette
    for (const rt of this.panes.values()) rt.term.options.theme = palette
  }

  /** Drops panes back to idle once their output has been quiet long enough. */
  private tick(): void {
    const now = Date.now()
    for (const [id, rt] of this.panes) {
      if (rt.status === 'live' && now - rt.lastData > IDLE_MS) {
        rt.status = 'idle'
        this.events?.onStatus(id, 'idle')
      }
    }
  }

  ensure(paneId: string, settings: Settings): Runtime {
    const existing = this.panes.get(paneId)
    if (existing) return existing

    const wrapper = document.createElement('div')
    wrapper.style.width = '100%'
    wrapper.style.height = '100%'

    const term = new Terminal({
      allowProposedApi: true,
      // No transparency: the theme paints the terminal background directly, and
      // transparent mode costs a redraw path that leaves stale cells behind.
      allowTransparency: false,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      scrollback: settings.scrollback,
      macOptionIsMeta: true,
      // 1 disables contrast correction. A CLI's colours are its own business;
      // rewriting them is how "themed" terminals end up looking wrong.
      minimumContrastRatio: 1,
      // Draw block and box-drawing characters as geometry rather than glyphs,
      // so solid runs meet exactly. Needs the GPU renderer below.
      customGlyphs: true,
      theme: this.palette
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)

    try {
      term.loadAddon(new WebLinksAddon((_e, uri) => window.eaon.sys.openExternal(uri)))
    } catch {
      /* links are a nicety, never a blocker */
    }

    term.open(wrapper)

    const rt: Runtime = {
      term,
      fit,
      search,
      wrapper,
      host: null,
      observer: null,
      sentCols: 0,
      sentRows: 0,
      fitTimer: null,
      lastData: 0,
      status: 'idle',
      tail: '',
      contextPct: null,
      spawned: false,
      webgl: null,
      disposers: []
    }

    // Must come after open(). This is the whole reason block art comes out
    // solid: only the GPU renderer honours `customGlyphs` and paints ▀ ▄ █ and
    // the box-drawing set as exact rectangles. The DOM renderer draws them as
    // font glyphs in separately positioned cells, and fractional cell metrics
    // leave hairline cracks through anything meant to be solid.
    this.attachRenderer(rt)

    const listeners = [
      term.onData((data) => window.eaon.pty.write(paneId, data)),
      term.onBinary((data) => window.eaon.pty.write(paneId, data)),
      term.onTitleChange((title) => {
        const clean = title.trim()
        if (clean) this.events?.onTitle(paneId, clean)
      }),
      term.onBell(() => {
        rt.status = 'attention'
        this.events?.onStatus(paneId, 'attention')
      })
    ]
    for (const listener of listeners) rt.disposers.push(() => listener.dispose())

    term.attachCustomKeyEventHandler((e) => {
      const verdict = resolveKey(e, { hasSelection: term.hasSelection() })
      switch (verdict.do) {
        case 'send':
          e.preventDefault()
          // Through input() rather than straight to the PTY, so these behave
          // like any other keystroke — including scrolling back to the prompt.
          term.input(verdict.data)
          return false
        case 'selectAll':
          e.preventDefault()
          term.selectAll()
          return false
        case 'copy': {
          const text = term.getSelection()
          e.preventDefault()
          // Nothing selected is not an error, it is a no-op — and on Windows
          // this path is only reached with a selection anyway.
          if (text) void navigator.clipboard.writeText(text)
          return false
        }
        case 'paste':
          e.preventDefault()
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (text) term.paste(text)
            })
            .catch(() => {
              /* clipboard refused; nothing useful to do about it */
            })
          return false
        case 'app':
          return false
        default:
          return true
      }
    })

    this.panes.set(paneId, rt)
    return rt
  }

  /**
   * Puts a pane on the GPU renderer, falling back to the DOM one if WebGL is
   * unavailable or the context is later lost. Losing a context is normal — the
   * browser drops the oldest when too many are alive — so it must degrade
   * quietly rather than leave a pane blank.
   */
  private attachRenderer(rt: Runtime): void {
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => {
        try {
          addon.dispose()
        } catch {
          /* already gone */
        }
        rt.webgl = null
      })
      rt.term.loadAddon(addon)
      rt.webgl = addon
    } catch {
      // No WebGL: xterm keeps the DOM renderer and the terminal still works.
      rt.webgl = null
    }
  }

  /** Which renderer a pane ended up on. Surfaced in Settings › Terminal. */
  rendererOf(paneId: string): 'gpu' | 'dom' {
    return this.panes.get(paneId)?.webgl ? 'gpu' : 'dom'
  }

  attach(paneId: string, host: HTMLElement, settings: Settings): void {
    const rt = this.ensure(paneId, settings)
    if (rt.host === host) return
    rt.host = host
    host.appendChild(rt.wrapper)

    rt.observer?.disconnect()
    rt.observer = new ResizeObserver(() => this.scheduleFit(paneId))
    rt.observer.observe(host)
    // Two frames: one for layout, one for the font metrics xterm needs.
    requestAnimationFrame(() => requestAnimationFrame(() => this.fit(paneId)))
  }

  /**
   * Coalesces resizes. Dragging a divider fires the observer dozens of times,
   * and every SIGWINCH makes a full-screen CLI repaint from scratch — which is
   * exactly when output tears.
   */
  private scheduleFit(paneId: string): void {
    const rt = this.panes.get(paneId)
    if (!rt) return
    if (rt.fitTimer !== null) window.clearTimeout(rt.fitTimer)
    rt.fitTimer = window.setTimeout(() => {
      rt.fitTimer = null
      this.fit(paneId)
    }, 60)
  }

  detach(paneId: string): void {
    const rt = this.panes.get(paneId)
    if (!rt) return
    rt.observer?.disconnect()
    rt.observer = null
    if (rt.wrapper.parentElement) rt.wrapper.parentElement.removeChild(rt.wrapper)
    rt.host = null
  }

  fit(paneId: string): void {
    const rt = this.panes.get(paneId)
    if (!rt || !rt.host) return
    const { width, height } = rt.host.getBoundingClientRect()
    if (width < 40 || height < 30) return
    try {
      rt.fit.fit()
      const { cols, rows } = rt.term
      // Only tell the shell when the size genuinely changed.
      if (cols === rt.sentCols && rows === rt.sentRows) return
      rt.sentCols = cols
      rt.sentRows = rows
      window.eaon.pty.resize(paneId, cols, rows)
      this.resizeListeners.get(paneId)?.(cols, rows)
    } catch {
      /* the pane can be mid-unmount */
    }
  }

  /** Lets a pane show its own size while it is being resized. */
  onResize(paneId: string, cb: (cols: number, rows: number) => void): () => void {
    this.resizeListeners.set(paneId, cb)
    return () => this.resizeListeners.delete(paneId)
  }

  dimensions(paneId: string): { cols: number; rows: number } | null {
    const rt = this.panes.get(paneId)
    return rt ? { cols: rt.term.cols, rows: rt.term.rows } : null
  }

  fitAll(): void {
    for (const id of this.panes.keys()) this.fit(id)
  }

  /** Starts the shell for a pane, once. */
  async spawn(paneId: string, cwd: string, command: string | null, settings: Settings): Promise<void> {
    const rt = this.ensure(paneId, settings)
    if (rt.spawned) return
    rt.spawned = true
    const res = await window.eaon.pty.spawn({
      paneId,
      cwd,
      cols: rt.term.cols || 80,
      rows: rt.term.rows || 24,
      shell: settings.shell || undefined,
      command
    })
    if (!res.ok) {
      rt.spawned = false
      rt.term.writeln(`\r\n  Could not start a shell here.\r\n  ${res.error ?? ''}\r\n`)
      this.events?.onStatus(paneId, 'exited')
    }
  }

  /**
   * Tear a pane's shell down and bring a fresh one up in the same place.
   *
   * Disposing a terminal takes its DOM with it, and a pane only attaches its
   * terminal when the component mounts — which does not happen again, because
   * the pane id has not changed. Re-spawning on its own therefore leaves a live
   * shell with nothing on screen. Holding on to the host element across the
   * swap is what keeps the restarted session visible.
   */
  restart(paneId: string, cwd: string, command: string | null, settings: Settings): void {
    const host = this.panes.get(paneId)?.host ?? null
    this.dispose(paneId)
    this.ensure(paneId, settings)
    if (host) this.attach(paneId, host, settings)

    // Two frames, so the fresh terminal has measured itself before the shell
    // starts and the PTY is created at the size it will actually be drawn at.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.fit(paneId)
        void this.spawn(paneId, cwd, command, settings)
        // Restarting is always something you asked for, so the caret belongs
        // in the pane you asked about.
        this.focus(paneId)
      })
    )
  }

  /** Feeds PTY output into the terminal and updates the derived signals. */
  receive(paneId: string, data: string): void {
    const rt = this.panes.get(paneId)
    if (!rt) return
    rt.term.write(data)
    rt.lastData = Date.now()

    if (rt.status !== 'live') {
      rt.status = 'live'
      this.events?.onStatus(paneId, 'live')
    }

    rt.tail = (rt.tail + stripAnsi(data)).slice(-3000)

    for (const { re, reportsRemaining } of CONTEXT_PATTERNS) {
      const m = rt.tail.match(re)
      if (!m) continue
      const raw = Number(m[1])
      if (raw < 0 || raw > 100) break
      const used = reportsRemaining ? 100 - raw : raw
      if (used !== rt.contextPct) {
        rt.contextPct = used
        this.events?.onContext(paneId, used)
      }
      break
    }
  }

  markExited(paneId: string, code: number): void {
    const rt = this.panes.get(paneId)
    if (!rt) return
    rt.spawned = false
    rt.status = 'exited'
    rt.term.writeln(`\r\n  [session ended, exit ${code}]`)
    this.events?.onExit(paneId, code)
  }

  /** Called when a pane gets focus — clears a pending attention flag. */
  acknowledge(paneId: string): void {
    const rt = this.panes.get(paneId)
    if (!rt || rt.status !== 'attention') return
    rt.status = 'idle'
    this.events?.onStatus(paneId, 'idle')
  }

  /** True when the recent output looks like a prompt waiting on a human. */
  looksBlocked(paneId: string): boolean {
    const rt = this.panes.get(paneId)
    if (!rt) return false
    const tail = rt.tail.slice(-600)
    return WAITING.some((re) => re.test(tail))
  }

  send(paneId: string, text: string): void {
    window.eaon.pty.write(paneId, text)
  }

  /** Goes through xterm so bracketed paste is honoured, like a real terminal. */
  paste(paneId: string, text: string): void {
    const rt = this.panes.get(paneId)
    if (!rt || !text) return
    rt.term.paste(text)
  }

  selectAll(paneId: string): void {
    this.panes.get(paneId)?.term.selectAll()
  }

  focus(paneId: string): void {
    this.panes.get(paneId)?.term.focus()
  }

  status(paneId: string): PaneStatus {
    return this.panes.get(paneId)?.status ?? 'idle'
  }

  clear(paneId: string): void {
    this.panes.get(paneId)?.term.clear()
  }

  find(paneId: string, query: string, back = false): void {
    const rt = this.panes.get(paneId)
    if (!rt || !query) return
    const opts = { caseSensitive: false, regex: false, wholeWord: false }
    if (back) rt.search.findPrevious(query, opts)
    else rt.search.findNext(query, opts)
  }

  clearFind(paneId: string): void {
    this.panes.get(paneId)?.search.clearDecorations()
  }

  selection(paneId: string): string {
    return this.panes.get(paneId)?.term.getSelection() ?? ''
  }

  applySettings(settings: Settings): void {
    this.settings = settings
    for (const [id, rt] of this.panes) {
      rt.term.options.fontFamily = settings.fontFamily
      rt.term.options.fontSize = settings.fontSize
      rt.term.options.lineHeight = settings.lineHeight
      rt.term.options.cursorStyle = settings.cursorStyle
      rt.term.options.cursorBlink = settings.cursorBlink
      rt.term.options.scrollback = settings.scrollback
      // New metrics mean a new grid, so the cached size no longer applies.
      rt.sentCols = 0
      rt.sentRows = 0
      this.fit(id)
    }
  }

  currentSettings(): Settings | null {
    return this.settings
  }

  dispose(paneId: string): void {
    const rt = this.panes.get(paneId)
    if (!rt) return
    window.eaon.pty.kill(paneId)
    if (rt.fitTimer !== null) window.clearTimeout(rt.fitTimer)
    this.resizeListeners.delete(paneId)
    // Free the GPU context explicitly; there is a hard cap on live ones.
    try {
      rt.webgl?.dispose()
    } catch {
      /* already gone */
    }
    rt.webgl = null
    rt.observer?.disconnect()
    for (const off of rt.disposers) {
      try {
        off()
      } catch {
        /* already gone */
      }
    }
    if (rt.wrapper.parentElement) rt.wrapper.parentElement.removeChild(rt.wrapper)
    rt.term.dispose()
    this.panes.delete(paneId)
  }

  has(paneId: string): boolean {
    return this.panes.has(paneId)
  }
}

export const terminals = new TerminalRegistry()
