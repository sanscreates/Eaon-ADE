import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  DownloadProgress,
  InstalledModel,
  SttEngineState,
  SttModelDef
} from '../shared/stt'
import type { SpeechSupport, SystemVoice } from '../shared/speech'
import type { UpdateState } from '../shared/update'
import type { UsageReport } from '../shared/usage'
import type { Account, LoginState } from '../shared/accounts'
import type { Stats } from '../shared/stats'
import type { BrainGraph, BrainStats, Memory, MemoryMeta, SearchHit } from '../shared/brain'
import type {
  AgentDef,
  DirEntry,
  GitStatus,
  PersistedState,
  ResumableSession,
  SpawnRequest
} from '../shared/types'

export interface SysInfo {
  platform: string
  version: string
  electron: string
  node: string
  shell: string
  home: string
}

export interface LogEntry {
  hash: string
  subject: string
  when: string
  author: string
}

/**
 * The only surface the renderer gets. Node stays in the main process; every
 * call below is an explicit, typed door.
 */
const api = {
  pty: {
    spawn: (req: SpawnRequest): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('pty:spawn', req),
    write: (paneId: string, data: string): void => ipcRenderer.send('pty:write', paneId, data),
    resize: (paneId: string, cols: number, rows: number): void =>
      ipcRenderer.send('pty:resize', paneId, cols, rows),
    kill: (paneId: string): void => ipcRenderer.send('pty:kill', paneId),
    alive: (paneId: string): Promise<boolean> => ipcRenderer.invoke('pty:alive', paneId),
    onData: (cb: (paneId: string, data: string) => void): (() => void) => {
      const handler = (_e: unknown, p: { paneId: string; data: string }): void =>
        cb(p.paneId, p.data)
      ipcRenderer.on('pty:data', handler)
      return () => ipcRenderer.removeListener('pty:data', handler)
    },
    onExit: (cb: (paneId: string, exitCode: number) => void): (() => void) => {
      const handler = (_e: unknown, p: { paneId: string; exitCode: number }): void =>
        cb(p.paneId, p.exitCode)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    }
  },

  state: {
    load: (): Promise<PersistedState> => ipcRenderer.invoke('state:load'),
    save: (next: PersistedState): void => ipcRenderer.send('state:save', next),
    reset: (): Promise<PersistedState> => ipcRenderer.invoke('state:reset'),
    path: (): Promise<string> => ipcRenderer.invoke('state:path')
  },

  fs: {
    list: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:list', dir),
    read: (file: string): Promise<{ text: string; truncated: boolean }> =>
      ipcRenderer.invoke('fs:read', file),
    write: (file: string, text: string): Promise<void> =>
      ipcRenderer.invoke('fs:write', file, text),
    search: (root: string, q: string): Promise<DirEntry[]> =>
      ipcRenderer.invoke('fs:search', root, q),
    isDir: (target: string): Promise<boolean> => ipcRenderer.invoke('fs:isDir', target),
    pickFolder: (startIn?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:pickFolder', startIn),

    /**
     * Where a dragged file actually lives.
     *
     * `File.path` was removed in Electron 32; this is the replacement, and it
     * only answers for files that came from a real drag or a file picker.
     * Anything synthesised in the page has no path and returns an empty string.
     */
    pathForDropped: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },

    /** Write a dropped payload that had no path of its own, and name it. */
    saveDropped: (name: string, bytes: Uint8Array): Promise<string> =>
      ipcRenderer.invoke('fs:saveDropped', name, bytes)
  },

  git: {
    status: (cwd: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', cwd),
    branch: (cwd: string): Promise<string | null> => ipcRenderer.invoke('git:branch', cwd),
    diff: (cwd: string, file: string, staged: boolean): Promise<string> =>
      ipcRenderer.invoke('git:diff', cwd, file, staged),
    stage: (cwd: string, file: string): Promise<void> => ipcRenderer.invoke('git:stage', cwd, file),
    unstage: (cwd: string, file: string): Promise<void> =>
      ipcRenderer.invoke('git:unstage', cwd, file),
    stageAll: (cwd: string): Promise<void> => ipcRenderer.invoke('git:stageAll', cwd),
    commit: (cwd: string, msg: string): Promise<string> =>
      ipcRenderer.invoke('git:commit', cwd, msg),
    log: (cwd: string): Promise<LogEntry[]> => ipcRenderer.invoke('git:log', cwd)
  },

  agents: {
    detect: (): Promise<AgentDef[]> => ipcRenderer.invoke('agents:detect')
  },

  sessions: {
    resumable: (): Promise<ResumableSession[]> => ipcRenderer.invoke('sessions:resumable'),
    countFor: (cwd: string): Promise<number> => ipcRenderer.invoke('sessions:countFor', cwd)
  },

  /** How much of the Claude plan has been spent. Read on disk unless told otherwise. */
  usage: {
    read: (opts: { fromAnthropic: boolean; session: number; week: number }): Promise<UsageReport> =>
      ipcRenderer.invoke('usage:read', opts),
    forget: (): void => ipcRenderer.send('usage:forget')
  },

  /**
   * Claude accounts. Signing in is Claude Code's own flow, driven in the main
   * process; the window only ever asks to start it and hands back the code.
   */
  accounts: {
    list: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
    setActive: (id: string): Promise<Account[]> => ipcRenderer.invoke('accounts:setActive', id),
    remove: (id: string): Promise<Account[]> => ipcRenderer.invoke('accounts:remove', id),

    beginLogin: (): Promise<LoginState> => ipcRenderer.invoke('accounts:beginLogin'),
    submitCode: (code: string): void => ipcRenderer.send('accounts:submitCode', code),
    cancelLogin: (): void => ipcRenderer.send('accounts:cancelLogin'),

    onLogin: (cb: (state: LoginState) => void): (() => void) => {
      const handler = (_e: unknown, state: LoginState): void => cb(state)
      ipcRenderer.on('accounts:login', handler)
      return () => ipcRenderer.removeListener('accounts:login', handler)
    },
    onChanged: (cb: (list: Account[]) => void): (() => void) => {
      const handler = (_e: unknown, list: Account[]): void => cb(list)
      ipcRenderer.on('accounts:changed', handler)
      return () => ipcRenderer.removeListener('accounts:changed', handler)
    }
  },

  browser: {
    /** Loopback ports with something listening, for the preview panel's chips. */
    devPorts: (): Promise<number[]> => ipcRenderer.invoke('browser:devPorts'),
    /**
     * Shortcuts pressed while the page itself had focus.
     *
     * Keys inside a <webview> go to the guest's own process and never reach
     * this window, so the main process catches the browser chords before the
     * guest sees them and sends them back here.
     */
    onKey: (cb: (chord: string) => void): (() => void) => {
      const handler = (_e: unknown, chord: string): void => cb(chord)
      ipcRenderer.on('browser:key', handler)
      return () => ipcRenderer.removeListener('browser:key', handler)
    }
  },

  /** Streak, contribution grid and code totals. Null folder counts everything. */
  stats: {
    get: (folder: string | null): Promise<Stats> => ipcRenderer.invoke('stats:get', folder)
  },

  /**
   * Voice dictation. Models are downloaded and run by the main process; the
   * renderer only ever hands over audio samples and gets text back.
   */
  stt: {
    catalog: (): Promise<SttModelDef[]> => ipcRenderer.invoke('stt:catalog'),
    installed: (): Promise<InstalledModel[]> => ipcRenderer.invoke('stt:installed'),
    usage: (): Promise<number> => ipcRenderer.invoke('stt:usage'),
    dir: (): Promise<string> => ipcRenderer.invoke('stt:dir'),

    download: (modelId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('stt:download', modelId),
    cancel: (modelId: string): void => ipcRenderer.send('stt:cancel', modelId),
    remove: (modelId: string): Promise<InstalledModel[]> =>
      ipcRenderer.invoke('stt:remove', modelId),

    load: (modelId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('stt:load', modelId),
    transcribe: (
      modelId: string,
      audio: Float32Array,
      language: string
    ): Promise<{ ok: boolean; text?: string; error?: string }> =>
      ipcRenderer.invoke('stt:transcribe', modelId, audio, language),
    stop: (): void => ipcRenderer.send('stt:stop'),
    state: (): Promise<SttEngineState> => ipcRenderer.invoke('stt:state'),

    onProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: DownloadProgress): void => cb(p)
      ipcRenderer.on('stt:progress', handler)
      return () => ipcRenderer.removeListener('stt:progress', handler)
    },
    onState: (cb: (s: SttEngineState) => void): (() => void) => {
      const handler = (_e: unknown, s: SttEngineState): void => cb(s)
      ipcRenderer.on('stt:state', handler)
      return () => ipcRenderer.removeListener('stt:state', handler)
    }
  },

  /**
   * Spoken alerts. The synthesiser belongs to the operating system, so the
   * renderer hands over a line of text and nothing else.
   */
  speech: {
    support: (): Promise<SpeechSupport> => ipcRenderer.invoke('speech:support'),
    voices: (): Promise<SystemVoice[]> => ipcRenderer.invoke('speech:voices'),
    refresh: (): Promise<SystemVoice[]> => ipcRenderer.invoke('speech:refresh'),
    speak: (text: string, opts: { voice?: string; rate?: number; volume?: number }): void =>
      ipcRenderer.send('speech:speak', text, opts),
    stop: (): void => ipcRenderer.send('speech:stop'),
    openVoiceSettings: (): void => ipcRenderer.send('speech:openVoiceSettings')
  },

  /**
   * Auto update. The renderer only ever reads state and asks to install; every
   * network decision stays in the main process.
   */
  update: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    install: (): void => ipcRenderer.send('update:install'),
    onState: (cb: (s: UpdateState) => void): (() => void) => {
      const handler = (_e: unknown, s: UpdateState): void => cb(s)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.removeListener('update:state', handler)
    }
  },

  /** Project memory: plain markdown in .eaonbrain/, shared with agents over MCP. */
  brain: {
    open: (cwd: string | null): Promise<{ stats: BrainStats; registered: boolean }> =>
      ipcRenderer.invoke('brain:open', cwd),
    list: (): Promise<MemoryMeta[]> => ipcRenderer.invoke('brain:list'),
    get: (slug: string): Promise<Memory | null> => ipcRenderer.invoke('brain:get', slug),
    write: (input: { title: string; content: string; tags?: string[]; slug?: string }): Promise<Memory | null> =>
      ipcRenderer.invoke('brain:write', input),
    remove: (slug: string): Promise<boolean> => ipcRenderer.invoke('brain:remove', slug),
    search: (q: string): Promise<SearchHit[]> => ipcRenderer.invoke('brain:search', q),
    related: (slug: string): Promise<{ backlinks: MemoryMeta[]; suggested: { meta: MemoryMeta; terms: string[] }[] }> =>
      ipcRenderer.invoke('brain:related', slug),
    graph: (): Promise<BrainGraph> => ipcRenderer.invoke('brain:graph'),
    stats: (): Promise<BrainStats> => ipcRenderer.invoke('brain:stats')
  },

  sys: {
    info: (): Promise<SysInfo> => ipcRenderer.invoke('sys:info'),
    home: (): Promise<string> => ipcRenderer.invoke('sys:home'),
    openExternal: (url: string): void => ipcRenderer.send('sys:openExternal', url),
    reveal: (target: string): void => ipcRenderer.send('sys:reveal', target)
  },

  win: {
    minimize: (): void => ipcRenderer.send('win:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('win:toggleMaximize'),
    close: (): void => ipcRenderer.send('win:close'),
    onFullscreen: (cb: (isFull: boolean) => void): (() => void) => {
      const handler = (_e: unknown, v: boolean): void => cb(v)
      ipcRenderer.on('win:fullscreen', handler)
      return () => ipcRenderer.removeListener('win:fullscreen', handler)
    }
  }
}

export type EaonApi = typeof api

contextBridge.exposeInMainWorld('eaon', api)
