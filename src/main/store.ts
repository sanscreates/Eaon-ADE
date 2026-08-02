import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { DEFAULT_SETTINGS, type PersistedState } from '../shared/types'

const STATE_VERSION = 1

function emptyState(): PersistedState {
  return {
    version: STATE_VERSION,
    workspaces: [],
    activeWorkspaceId: null,
    presets: [],
    recents: [],
    settings: { ...DEFAULT_SETTINGS },
    board: [],
    vault: [],
    dismissedResume: []
  }
}

/**
 * Single JSON document in the app's user-data folder. Writes go to a temp file
 * first so a crash mid-save can never leave a truncated state behind.
 */
export class Store {
  private file: string
  private cache: PersistedState | null = null
  private writeTimer: NodeJS.Timeout | null = null

  constructor() {
    this.file = path.join(app.getPath('userData'), 'state.json')
    this.migrateFromPreviousName()
  }

  /**
   * The app has been renamed more than once, and each name meant a different
   * user-data folder. Carry the newest surviving one across so a rename never
   * reads as "all my workspaces vanished". Newest first.
   */
  private migrateFromPreviousName(): void {
    const LEGACY_NAMES = ['ADE', 'Eaon']
    try {
      if (fs.existsSync(this.file)) return
      for (const name of LEGACY_NAMES) {
        const legacy = path.join(app.getPath('appData'), name, 'state.json')
        if (!fs.existsSync(legacy)) continue
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        fs.copyFileSync(legacy, this.file)
        return
      }
    } catch {
      /* a failed migration just means starting fresh */
    }
  }

  get path(): string {
    return this.file
  }

  load(): PersistedState {
    if (this.cache) return this.cache
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedState>
      const base = emptyState()
      this.cache = {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        version: STATE_VERSION
      }
    } catch {
      this.cache = emptyState()
    }
    return this.cache
  }

  /** Debounced so rapid UI updates collapse into one disk write. */
  save(next: PersistedState): void {
    this.cache = { ...next, version: STATE_VERSION }
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    if (!this.cache) return
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch {
      /* a failed save must never take the app down */
    }
  }

  reset(): PersistedState {
    this.cache = emptyState()
    this.flush()
    return this.cache
  }
}
