import { create } from 'zustand'
import {
  AGENTS,
  DEFAULT_SETTINGS,
  HUES,
  NAME_POOL,
  type AgentDef,
  type BoardCard,
  type PaneSpec,
  type PaneStatus,
  type PersistedState,
  type Preset,
  type RecentFolder,
  type ResumableSession,
  type Settings,
  type SurfaceId,
  type VaultNote,
  type Workspace
} from '@shared/types'
import type { DownloadProgress, InstalledModel, SttEngineState } from '@shared/stt'
import { IDLE_UPDATE_STATE, type UpdateState } from '@shared/update'
import { terminals } from '../lib/terminals'
import { basename, uid } from '../lib/util'

export type DockTab = 'browser' | 'editor' | 'git' | 'tools'

export interface Notice {
  id: string
  kind: 'info' | 'attention' | 'error'
  title: string
  text: string
  at: number
  paneId?: string
  workspaceId?: string
}

export interface WizardDraft {
  step: 0 | 1 | 2
  mode: SurfaceId
  cwd: string
  layout: number
  agentId: string
  prompt: string
  presetId: string | null
}

interface AppState {
  ready: boolean
  home: string
  appVersion: string
  agents: AgentDef[]

  workspaces: Workspace[]
  activeWorkspaceId: string | null
  presets: Preset[]
  recents: RecentFolder[]
  settings: Settings
  board: BoardCard[]
  vault: VaultNote[]
  dismissedResume: string[]

  surface: SurfaceId
  wizard: WizardDraft | null
  railOpen: boolean
  dockOpen: boolean
  dockTab: DockTab
  dockWidth: number
  conductorOpen: boolean
  paletteOpen: boolean
  settingsOpen: boolean
  resumeOpen: boolean
  presetEditorId: string | null | 'new'
  notices: Notice[]

  /** Speech models present on this machine. */
  sttInstalled: InstalledModel[]
  /** Live download progress, keyed by model id. */
  sttProgress: Record<string, DownloadProgress>
  sttEngine: SttEngineState

  /** Auto-update state, pushed from the main process. */
  update: UpdateState
  /** Version the user dismissed the card for, this session only. */
  updateDismissed: string | null

  hydrate: () => Promise<void>
  persist: () => void

  setUpdate: (u: UpdateState) => void
  dismissUpdate: (version: string | null) => void

  refreshStt: () => Promise<void>
  setSttProgress: (p: DownloadProgress) => void
  setSttEngine: (s: SttEngineState) => void
  downloadModel: (modelId: string) => Promise<void>
  removeModel: (modelId: string) => Promise<void>

  openWizard: (mode: SurfaceId, preset?: Preset) => void
  updateWizard: (patch: Partial<WizardDraft>) => void
  closeWizard: () => void
  createWorkspace: (draft: WizardDraft) => void

  setActiveWorkspace: (id: string) => void
  closeWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void

  addPane: (
    workspaceId: string,
    opts?: { agentId?: string; command?: string | null; cwd?: string }
  ) => void
  resumeSessions: (sessions: ResumableSession[]) => void
  closePane: (workspaceId: string, paneId: string) => void
  focusPane: (workspaceId: string, paneId: string) => void
  zoomPane: (workspaceId: string, paneId: string | null) => void
  patchPane: (paneId: string, patch: Partial<PaneSpec>) => void
  restartPane: (paneId: string) => void

  savePreset: (preset: Preset) => void
  deletePreset: (id: string) => void
  touchRecent: (path: string) => void

  updateSettings: (patch: Partial<Settings>) => void
  setSurface: (s: SurfaceId) => void
  toggleRail: () => void
  toggleDock: (tab?: DockTab) => void
  setDockTab: (tab: DockTab) => void
  setDockWidth: (w: number) => void
  toggleConductor: () => void
  setPalette: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setResumeOpen: (open: boolean) => void
  setPresetEditor: (id: string | null | 'new') => void

  notify: (n: Omit<Notice, 'id' | 'at'>) => void
  dismissNotice: (id: string) => void
  clearNotices: () => void

  saveCard: (card: BoardCard) => void
  deleteCard: (id: string) => void
  saveNote: (note: VaultNote) => void
  deleteNote: (id: string) => void
  dismissResume: (ids: string[]) => void
}

function pickNames(count: number, taken: string[]): string[] {
  const pool = NAME_POOL.filter((n) => !taken.includes(n))
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    if (pool.length) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
    } else {
      out.push(`Pane ${taken.length + i + 1}`)
    }
  }
  return out
}

function makePane(name: string, cwd: string, agentId: string): PaneSpec {
  const agent = AGENTS.find((a) => a.id === agentId)
  const command = agent && agent.bin ? [agent.bin, ...agent.args].join(' ') : null
  return {
    id: uid('p_'),
    name,
    title: null,
    cwd,
    agentId,
    command,
    status: 'idle',
    branch: null,
    contextPct: null,
    createdAt: Date.now()
  }
}

/** Workspaces cycle through the identity hues so the rail stays readable. */
function nextHue(existing: Workspace[]): string {
  const counts = HUES.map((h) => existing.filter((w) => w.hue === h).length)
  const min = Math.min(...counts)
  return HUES[counts.indexOf(min)]
}

let persistTimer: number | null = null

/**
 * Opening prompts, held outside the store because they are consumed once and
 * must never be written to disk with the workspace.
 */
export const pendingPrompts = new Map<string, string>()

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  home: '',
  // Placeholder until hydrate() reads the real one from the main process.
  appVersion: '1.0.0',
  agents: AGENTS,

  workspaces: [],
  activeWorkspaceId: null,
  presets: [],
  recents: [],
  settings: { ...DEFAULT_SETTINGS },
  board: [],
  vault: [],
  dismissedResume: [],

  surface: 'grid',
  wizard: null,
  railOpen: true,
  dockOpen: false,
  dockTab: 'editor',
  dockWidth: 460,
  // Closed on launch. It floats over the bottom row, so it has to be asked for
  // (⌘J) rather than turn up in front of your terminals every time.
  conductorOpen: false,
  paletteOpen: false,
  settingsOpen: false,
  resumeOpen: false,
  presetEditorId: null,
  notices: [],

  sttInstalled: [],
  sttProgress: {},
  sttEngine: { kind: 'idle' },

  update: { ...IDLE_UPDATE_STATE },
  updateDismissed: null,

  async hydrate() {
    const [saved, info, agents] = await Promise.all([
      window.eaon.state.load(),
      window.eaon.sys.info(),
      window.eaon.agents.detect()
    ])

    // The terminal font default changed with the brand. Move anyone who never
    // chose their own onto it; leave a real preference alone.
    const savedSettings = { ...(saved.settings ?? {}) }
    const LEGACY_FONT = '"SF Mono", "JetBrains Mono", "Fira Code", Menlo, monospace'
    if (savedSettings.fontFamily === LEGACY_FONT) {
      savedSettings.fontFamily = DEFAULT_SETTINGS.fontFamily
    }
    // Same for the cursor: the default used to be a thin bar, and a terminal
    // should look like a terminal. Anyone still on the old default moves over.
    if (savedSettings.cursorStyle === 'bar') {
      savedSettings.cursorStyle = DEFAULT_SETTINGS.cursorStyle
    }
    // And the cell height, which is what the block cursor is measured against.
    if (savedSettings.lineHeight === 1.35) {
      savedSettings.lineHeight = DEFAULT_SETTINGS.lineHeight
    }

    // Panes are restored as empty shells; their processes died with the app.
    const workspaces = (saved.workspaces ?? []).map((w) => ({
      ...w,
      zoomedPaneId: null,
      panes: w.panes.map((p) => ({ ...p, status: 'idle' as PaneStatus, contextPct: null, title: null }))
    }))

    set({
      ready: true,
      home: info.home,
      appVersion: info.version,
      agents,
      workspaces,
      activeWorkspaceId: workspaces.some((w) => w.id === saved.activeWorkspaceId)
        ? saved.activeWorkspaceId
        : (workspaces[0]?.id ?? null),
      presets: saved.presets ?? [],
      recents: saved.recents ?? [],
      settings: { ...DEFAULT_SETTINGS, ...savedSettings },
      board: saved.board ?? [],
      vault: saved.vault ?? [],
      dismissedResume: saved.dismissedResume ?? []
    })

    void get().refreshStt()
  },

  async refreshStt() {
    set({ sttInstalled: await window.eaon.stt.installed() })
  },

  setSttProgress(p) {
    set({ sttProgress: { ...get().sttProgress, [p.modelId]: p } })
    if (p.done) void get().refreshStt()
  },

  setSttEngine(sttEngine) {
    set({ sttEngine })
  },

  async downloadModel(modelId) {
    const res = await window.eaon.stt.download(modelId)
    await get().refreshStt()
    if (!res.ok && res.error && res.error !== 'Cancelled') {
      get().notify({ kind: 'error', title: 'Download failed', text: res.error })
      return
    }
    if (res.ok) {
      // First model down: make it the one dictation uses, so the feature works
      // without a second trip into settings.
      if (!get().settings.voiceModelId) get().updateSettings({ voiceModelId: modelId })
    }
  },

  async removeModel(modelId) {
    const installed = await window.eaon.stt.remove(modelId)
    set({ sttInstalled: installed })
    if (get().settings.voiceModelId === modelId) {
      const next = installed.find((m) => m.complete)
      get().updateSettings({ voiceModelId: next?.id ?? '' })
    }
  },

  persist() {
    if (persistTimer !== null) window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      const s = get()
      const snapshot: PersistedState = {
        version: 1,
        workspaces: s.workspaces,
        activeWorkspaceId: s.activeWorkspaceId,
        presets: s.presets,
        recents: s.recents,
        settings: s.settings,
        board: s.board,
        vault: s.vault,
        dismissedResume: s.dismissedResume
      }
      window.eaon.state.save(snapshot)
    }, 400)
  },

  openWizard(mode, preset) {
    const s = get()
    set({
      wizard: {
        step: 0,
        mode,
        cwd: preset?.cwd ?? s.recents[0]?.path ?? s.home,
        layout: preset?.layout ?? (mode === 'swarm' ? 4 : 1),
        agentId: preset?.agentId ?? s.settings.defaultAgentId,
        prompt: preset?.prompt ?? '',
        presetId: preset?.id ?? null
      }
    })
  },

  updateWizard(patch) {
    const w = get().wizard
    if (!w) return
    set({ wizard: { ...w, ...patch } })
  },

  closeWizard() {
    set({ wizard: null })
  },

  createWorkspace(draft) {
    const s = get()
    const names = pickNames(draft.layout, s.workspaces.flatMap((w) => w.panes.map((p) => p.name)))
    const workspace: Workspace = {
      id: uid('w_'),
      name: basename(draft.cwd) || 'Workspace',
      cwd: draft.cwd,
      hue: nextHue(s.workspaces),
      layout: draft.layout,
      panes: names.map((n) => makePane(n, draft.cwd, draft.agentId)),
      activePaneId: null,
      zoomedPaneId: null,
      createdAt: Date.now()
    }
    workspace.activePaneId = workspace.panes[0]?.id ?? null
    if (draft.prompt.trim() && draft.agentId !== 'shell') {
      pendingPrompts.set(workspace.id, draft.prompt.trim())
    }

    set({
      workspaces: [...s.workspaces, workspace],
      activeWorkspaceId: workspace.id,
      wizard: null,
      surface: draft.mode === 'swarm' ? 'grid' : draft.mode
    })
    get().touchRecent(draft.cwd)
    get().persist()
  },

  setActiveWorkspace(id) {
    // Picking a workspace means "show me that workspace", so it leaves Settings.
    set({ activeWorkspaceId: id, surface: 'grid', settingsOpen: false })
    get().persist()
  },

  closeWorkspace(id) {
    const s = get()
    const target = s.workspaces.find((w) => w.id === id)
    target?.panes.forEach((p) => terminals.dispose(p.id))
    const rest = s.workspaces.filter((w) => w.id !== id)
    set({
      workspaces: rest,
      activeWorkspaceId: s.activeWorkspaceId === id ? (rest[rest.length - 1]?.id ?? null) : s.activeWorkspaceId,
      notices: s.notices.filter((n) => n.workspaceId !== id)
    })
    get().persist()
  },

  renameWorkspace(id, name) {
    set({
      workspaces: get().workspaces.map((w) => (w.id === id ? { ...w, name } : w))
    })
    get().persist()
  },

  addPane(workspaceId, opts) {
    const s = get()
    set({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        const taken = s.workspaces.flatMap((x) => x.panes.map((p) => p.name))
        const [name] = pickNames(1, taken)
        const pane = makePane(name, opts?.cwd ?? w.cwd, opts?.agentId ?? s.settings.defaultAgentId)
        if (opts?.command !== undefined) pane.command = opts.command
        return { ...w, panes: [...w.panes, pane], activePaneId: pane.id, layout: w.panes.length + 1 }
      })
    })
    get().persist()
  },

  resumeSessions(sessions) {
    if (!sessions.length) return
    const s = get()
    const taken = s.workspaces.flatMap((w) => w.panes.map((p) => p.name))
    const names = pickNames(sessions.length, taken)
    const cwd = sessions[0].cwd || s.home
    const panes = sessions.map((session, i) => {
      const pane = makePane(names[i], session.cwd || cwd, 'shell')
      pane.command = session.command
      pane.title = session.label
      return pane
    })
    const workspace: Workspace = {
      id: uid('w_'),
      name: `Resumed ${basename(cwd) || 'sessions'}`,
      cwd,
      hue: nextHue(s.workspaces),
      layout: panes.length,
      panes,
      activePaneId: panes[0].id,
      zoomedPaneId: null,
      createdAt: Date.now()
    }
    set({
      workspaces: [...s.workspaces, workspace],
      activeWorkspaceId: workspace.id,
      resumeOpen: false,
      surface: 'grid'
    })
    get().touchRecent(cwd)
    get().persist()
  },

  closePane(workspaceId, paneId) {
    terminals.dispose(paneId)
    const s = get()
    set({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        const panes = w.panes.filter((p) => p.id !== paneId)
        return {
          ...w,
          panes,
          layout: Math.max(1, panes.length),
          activePaneId: w.activePaneId === paneId ? (panes[0]?.id ?? null) : w.activePaneId,
          zoomedPaneId: w.zoomedPaneId === paneId ? null : w.zoomedPaneId
        }
      }),
      notices: s.notices.filter((n) => n.paneId !== paneId)
    })
    get().persist()
  },

  focusPane(workspaceId, paneId) {
    terminals.acknowledge(paneId)
    terminals.focus(paneId)
    set({
      workspaces: get().workspaces.map((w) =>
        w.id === workspaceId ? { ...w, activePaneId: paneId } : w
      ),
      notices: get().notices.filter((n) => n.paneId !== paneId)
    })
  },

  zoomPane(workspaceId, paneId) {
    set({
      workspaces: get().workspaces.map((w) =>
        w.id === workspaceId ? { ...w, zoomedPaneId: paneId } : w
      )
    })
  },

  patchPane(paneId, patch) {
    set({
      workspaces: get().workspaces.map((w) => {
        if (!w.panes.some((p) => p.id === paneId)) return w
        return { ...w, panes: w.panes.map((p) => (p.id === paneId ? { ...p, ...patch } : p)) }
      })
    })
  },

  restartPane(paneId) {
    const s = get()
    const pane = s.workspaces.flatMap((w) => w.panes).find((p) => p.id === paneId)
    if (!pane) return
    get().patchPane(paneId, { status: 'idle', contextPct: null, title: null })
    // The registry does the swap: the pane component mounted once and will not
    // mount again, so it cannot re-attach the replacement terminal itself.
    terminals.restart(paneId, pane.cwd, pane.command, get().settings)
  },

  savePreset(preset) {
    const s = get()
    const exists = s.presets.some((p) => p.id === preset.id)
    set({
      presets: exists ? s.presets.map((p) => (p.id === preset.id ? preset : p)) : [...s.presets, preset]
    })
    get().persist()
  },

  deletePreset(id) {
    set({ presets: get().presets.filter((p) => p.id !== id) })
    get().persist()
  },

  touchRecent(path) {
    if (!path) return
    const s = get()
    const rest = s.recents.filter((r) => r.path !== path)
    const entry: RecentFolder = {
      path,
      name: basename(path) || path,
      lastOpened: Date.now(),
      sessions: s.recents.find((r) => r.path === path)?.sessions ?? 0
    }
    set({ recents: [entry, ...rest].slice(0, 12) })
    window.eaon.sessions.countFor(path).then((count) => {
      set({
        recents: get().recents.map((r) => (r.path === path ? { ...r, sessions: count } : r))
      })
    })
    get().persist()
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    terminals.applySettings(settings)
    get().persist()
  },

  setSurface(surface) {
    set({ surface })
  },
  toggleRail() {
    set({ railOpen: !get().railOpen })
  },
  toggleDock(tab) {
    const s = get()
    if (tab && (!s.dockOpen || s.dockTab !== tab)) set({ dockOpen: true, dockTab: tab })
    else set({ dockOpen: !s.dockOpen })
  },
  /** Switching tabs inside the dock never closes it — only the toggle does. */
  setDockTab(tab) {
    set({ dockOpen: true, dockTab: tab })
  },
  setDockWidth(w) {
    set({ dockWidth: Math.min(880, Math.max(320, w)) })
  },
  toggleConductor() {
    set({ conductorOpen: !get().conductorOpen })
  },
  setPalette(open) {
    set({ paletteOpen: open })
  },
  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },
  setResumeOpen(open) {
    set({ resumeOpen: open })
  },
  setPresetEditor(id) {
    set({ presetEditorId: id })
  },

  setUpdate(update) {
    // A newer version supersedes an earlier dismissal, so the card can return.
    const previous = get().update
    const changedVersion = update.version && update.version !== previous.version
    set({ update, ...(changedVersion ? { updateDismissed: null } : {}) })
  },
  dismissUpdate(version) {
    set({ updateDismissed: version })
  },

  notify(n) {
    const notice: Notice = { ...n, id: uid('n_'), at: Date.now() }
    set({ notices: [notice, ...get().notices].slice(0, 40) })
  },
  dismissNotice(id) {
    set({ notices: get().notices.filter((n) => n.id !== id) })
  },
  clearNotices() {
    set({ notices: [] })
  },

  saveCard(card) {
    const s = get()
    const exists = s.board.some((c) => c.id === card.id)
    set({ board: exists ? s.board.map((c) => (c.id === card.id ? card : c)) : [card, ...s.board] })
    get().persist()
  },
  deleteCard(id) {
    set({ board: get().board.filter((c) => c.id !== id) })
    get().persist()
  },
  saveNote(note) {
    const s = get()
    const exists = s.vault.some((n) => n.id === note.id)
    set({ vault: exists ? s.vault.map((n) => (n.id === note.id ? note : n)) : [note, ...s.vault] })
    get().persist()
  },
  deleteNote(id) {
    set({ vault: get().vault.filter((n) => n.id !== id) })
    get().persist()
  },
  dismissResume(ids) {
    set({ dismissedResume: [...new Set([...get().dismissedResume, ...ids])].slice(-200) })
    get().persist()
  }
}))

/** Convenience selector — the workspace currently shown in the stage. */
export function useActiveWorkspace(): Workspace | null {
  return useStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null)
}
