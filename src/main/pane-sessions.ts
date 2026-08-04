import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ObservedSession } from './sessions'

/**
 * What each pane was last seen running.
 *
 * Kept beside the workspace rather than inside it, and owned by the main
 * process, because this is something only the main process can know: it is read
 * off the process table, not off anything the window did. Keeping it here also
 * steps around the one hole in the renderer's own saving — that snapshot is
 * debounced, so a change made in the last moments before a quit never leaves
 * the window, and the last moments before a quit are exactly when this matters.
 *
 * Keyed by pane id, which outlives the process it describes: the pane is in
 * `state.json`, so the record still means something on the next launch.
 */

/** A record this old belongs to a pane that is long gone. */
const STALE_MS = 30 * 24 * 60 * 60 * 1000

/** Long enough to collapse a burst of changes, short enough to survive a crash. */
const WRITE_DELAY_MS = 1000

export class PaneSessions {
  private map = new Map<string, ObservedSession>()
  private timer: NodeJS.Timeout | null = null
  readonly file: string

  constructor(dir?: string) {
    this.file = path.join(dir ?? app.getPath('userData'), 'pane-sessions.json')
    this.read()
  }

  private read(): void {
    let raw: Record<string, ObservedSession>
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, ObservedSession>
    } catch {
      // First run, or a file we cannot make sense of. Either way, start empty:
      // the worst this costs is that panes come back as shells once.
      return
    }
    const cutoff = Date.now() - STALE_MS
    for (const [paneId, entry] of Object.entries(raw ?? {})) {
      if (entry?.sessionId && entry.agentId && entry.at > cutoff) this.map.set(paneId, entry)
    }
  }

  get(paneId: string): ObservedSession | null {
    return this.map.get(paneId) ?? null
  }

  /**
   * Records a session, or notes that a known one is still running.
   *
   * A pane that has not changed only has its timestamp refreshed, without
   * asking for a write — otherwise every poll would rewrite the whole file for
   * a number nobody reads until the next launch, and the timestamp is current
   * again by the time the final flush runs.
   */
  set(paneId: string, next: Omit<ObservedSession, 'at'>): void {
    const prev = this.map.get(paneId)
    if (prev && prev.sessionId === next.sessionId && prev.cwd === next.cwd) {
      prev.at = Date.now()
      return
    }
    this.map.set(paneId, { ...next, at: Date.now() })
    this.schedule()
  }

  /**
   * Forgets a pane's session. Called when the agent is no longer running, which
   * is what makes a conversation you deliberately exited stay closed rather
   * than reopening itself on the next launch.
   */
  clear(paneId: string): void {
    if (this.map.delete(paneId)) this.schedule()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS)
  }

  /** Writes now, for the way out, where a timer would never get to fire. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const out: Record<string, ObservedSession> = {}
    for (const [paneId, entry] of this.map) out[paneId] = entry
    try {
      // Written aside and renamed, so an interrupted write cannot leave a
      // half-file that would be thrown away whole on the next read.
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2))
      fs.renameSync(tmp, this.file)
    } catch {
      /* a note about what was running is not worth failing a quit over */
    }
  }
}
