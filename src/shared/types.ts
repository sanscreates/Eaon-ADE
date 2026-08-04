/**
 * Types shared between the Electron main process, the preload bridge and the
 * renderer. Keep this file free of runtime imports so both sides can use it.
 */

import { DEFAULT_THEME_ID } from './themes'
import { DEFAULT_SEARCH_ENGINE } from './browser'

export type PaneStatus = 'live' | 'idle' | 'attention' | 'exited'

export type SurfaceId = 'grid' | 'swarm' | 'board' | 'vault' | 'brain'

export interface AgentDef {
  id: string
  label: string
  /** Binary we look for on PATH. */
  bin: string
  /** Extra args appended after the binary. */
  args: string[]
  /** Short line shown in the picker. */
  blurb: string
  /** Whether the binary was found on this machine. Filled in at runtime. */
  available?: boolean
}

export interface PaneSpec {
  id: string
  /** Stable short handle: "Tate", "Ava". Used for addressing in broadcasts. */
  name: string
  /** Title reported by the program via the OSC title escape, if any. */
  title: string | null
  cwd: string
  agentId: string
  /** Full command line that was launched, or null for a bare shell. */
  command: string | null
  status: PaneStatus
  branch: string | null
  /** Context percentage parsed out of the agent's own status line. */
  contextPct: number | null
  /**
   * The conversation this pane owns.
   *
   * Chosen by us before the agent starts rather than read back afterwards, so
   * a pane and its conversation are bound together from the first moment and
   * stay bound across a restart. Null for a bare shell, or for a pane restored
   * from a command that already names its own session.
   */
  sessionId: string | null
  createdAt: number
}

/**
 * What a workspace holds.
 *
 * Terminal workspaces own panes. The rest own a single surface and no shells —
 * they sit in the same rail so that opening the board is switching to something
 * rather than covering over what you were doing.
 */
export type WorkspaceKind = 'terminals' | 'board' | 'vault' | 'brain' | 'stats'

/** Kinds that hold a surface instead of shells. */
export const PANEL_KINDS = ['board', 'vault', 'brain', 'stats'] as const

export const PANEL_LABEL: Record<(typeof PANEL_KINDS)[number], string> = {
  board: 'Board',
  vault: 'Vault',
  brain: 'Brain',
  stats: 'Stats'
}

export function isPanelKind(kind: WorkspaceKind): kind is (typeof PANEL_KINDS)[number] {
  return kind !== 'terminals'
}

/**
 * A group in the rail.
 *
 * Holds nothing itself — a workspace points at the folder it is filed under —
 * so deleting one can never take a session with it. That is the whole reason it
 * is modelled this way round rather than as a folder owning a list of ids: a
 * workspace has exactly one home, and it cannot go missing by being in a list
 * that got dropped.
 */
export interface WorkspaceFolder {
  id: string
  name: string
  /** Folded shut in the rail. Remembered across restarts, like everything else. */
  collapsed: boolean
  createdAt: number
}

export interface Workspace {
  id: string
  /** Absent on anything saved before workspaces had kinds; read as 'terminals'. */
  kind: WorkspaceKind
  name: string
  cwd: string
  hue: string
  /** Number of panes the workspace was opened with. */
  layout: number
  panes: PaneSpec[]
  activePaneId: string | null
  zoomedPaneId: string | null
  /**
   * The folder this is filed under, or null for the top level. Absent on
   * anything saved before folders existed, which reads the same as null.
   */
  folderId: string | null
  createdAt: number
}

export interface Preset {
  id: string
  name: string
  layout: number
  agentId: string
  /** Optional folder this preset always opens in. */
  cwd?: string
  /** Optional prompt broadcast to every pane once the agents are up. */
  prompt?: string
}

export interface RecentFolder {
  path: string
  name: string
  lastOpened: number
  sessions: number
}

export interface Settings {
  themeId: string
  /** Null follows the theme's own accent; otherwise an ACCENT_OVERRIDES id. */
  accentOverride: string | null
  fontFamily: string
  fontSize: number
  lineHeight: number
  shell: string
  defaultAgentId: string
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  scrollback: number
  confirmClose: boolean
  reduceMotion: boolean
  bellAttention: boolean

  // ---- voice dictation ---------------------------------------------------
  /** Catalogue id of the downloaded speech model to use. Empty means none yet. */
  voiceModelId: string
  /** Microphone deviceId, or empty for the system default. */
  voiceMicId: string
  /** 'auto' or an ISO code. Ignored by English-only models, which reject it. */
  voiceLanguage: string
  /** Stop listening after this much silence. 0 keeps the mic open until you stop it. */
  voiceSilenceMs: number
  /**
   * KeyboardEvent.code of the key you hold to talk, or '' for no hold key.
   *
   * Not Fn: macOS never delivers the Fn/globe key to an application's key
   * handling at all, so it cannot be observed without a native input monitor
   * and the permission that comes with it.
   */
  voiceHoldKey: string

  // ---- spoken alerts -----------------------------------------------------
  /**
   * Say "<pane> has finished" out loud when an agent stops working.
   *
   * Off until you ask for it. A tool that starts talking to you the first time
   * you open it has made a decision that was yours to make.
   */
  speakOnFinish: boolean
  /** System voice name, or '' to use the best one installed. */
  speakVoice: string
  /** Words per minute handed to the synthesiser. */
  speakRate: number
  /** 0 to 1. */
  speakVolume: number
  /** Only speak when the pane that finished is not the one you are watching. */
  speakOnlyWhenAway: boolean

  // ---- preview browser ---------------------------------------------------
  /** Address the preview panel opens at, and the last one you visited. */
  browserHome: string
  /** SEARCH_ENGINES id used when the address bar is given words, not an address. */
  browserSearchEngine: string
  /** Page zoom, as a multiplier. Kept so it survives a restart, as a browser's does. */
  browserZoom: number

  // ---- plan usage --------------------------------------------------------
  /**
   * Ask Anthropic for the real percentages instead of reading the transcripts.
   *
   * Off by default, and deliberately: turning it on lets the app read the OAuth
   * token out of Claude Code's credentials and make a request as you. The local
   * reading needs neither and is what runs until you say otherwise.
   */
  usageFromAnthropic: boolean
  /** Billed tokens the 5-hour window is measured against. 0 uses the plan default. */
  usageSessionLimit: number
  /** Billed tokens the 7-day window is measured against. 0 uses the plan default. */
  usageWeekLimit: number
}

export interface BoardCard {
  id: string
  title: string
  notes: string
  column: 'queued' | 'running' | 'review' | 'done'
  assignedPaneName: string | null
  createdAt: number
}

export interface VaultNote {
  id: string
  title: string
  body: string
  updatedAt: number
}

export interface PersistedState {
  version: number
  workspaces: Workspace[]
  /** Rail groups. Absent on anything saved before folders existed. */
  folders: WorkspaceFolder[]
  activeWorkspaceId: string | null
  presets: Preset[]
  recents: RecentFolder[]
  settings: Settings
  board: BoardCard[]
  vault: VaultNote[]
  dismissedResume: string[]
}

export interface ResumableSession {
  id: string
  tool: string
  cwd: string
  label: string
  command: string
  updatedAt: number
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  size: number
}

export interface GitFile {
  path: string
  index: string
  work: string
  staged: boolean
}

export interface GitStatus {
  repo: boolean
  branch: string | null
  ahead: number
  behind: number
  files: GitFile[]
}

export interface SpawnRequest {
  paneId: string
  cwd: string
  cols: number
  rows: number
  shell?: string
  /** Command typed into the fresh shell, e.g. "claude". */
  command?: string | null
  /** Which agent this is, so the session flags can be chosen for it. */
  agentId?: string
  /** Conversation to pin or reopen. The main process decides which. */
  sessionId?: string | null
}

/**
 * Agents that let a conversation be named up front.
 *
 * `pin` starts a new conversation under an id we chose; `resume` reopens it.
 * Naming it in advance is what makes reopening exact — the alternative is
 * guessing from timestamps, which falls apart the moment two panes share a
 * folder. Anything absent from here simply starts fresh, as it always did.
 */
export const SESSION_FLAGS: Record<string, { pin: string; resume: string }> = {
  claude: { pin: '--session-id', resume: '--resume' }
}

/** True when a pane running this agent should be given a conversation id. */
export function agentKeepsSessions(agentId: string): boolean {
  return agentId in SESSION_FLAGS
}

export const LAYOUTS = [1, 2, 4, 6, 8, 10, 12] as const

/** Column count for a given pane count. Rows fall out of it. */
export function gridColumns(count: number): number {
  if (count <= 1) return 1
  if (count <= 2) return 2
  if (count <= 4) return 2
  if (count <= 6) return 3
  if (count <= 9) return 3
  return 4
}

export function gridShape(count: number): { cols: number; rows: number } {
  const cols = gridColumns(count)
  return { cols, rows: Math.ceil(count / cols) }
}

export const AGENTS: AgentDef[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    args: [],
    blurb: 'Anthropic’s terminal agent'
  },
  { id: 'codex', label: 'Codex', bin: 'codex', args: [], blurb: 'OpenAI’s terminal agent' },
  { id: 'gemini', label: 'Gemini CLI', bin: 'gemini', args: [], blurb: 'Google’s terminal agent' },
  { id: 'aider', label: 'Aider', bin: 'aider', args: [], blurb: 'Pair programmer in your repo' },
  { id: 'shell', label: 'Plain shell', bin: '', args: [], blurb: 'No agent, just a terminal' }
]

/** Short handles assigned to panes so you can address them out loud. */
export const NAME_POOL = [
  'Ada','Bo','Cleo','Dex','Esme','Flint','Gus','Hazel','Iris','Jax','Kit','Lark',
  'Mica','Nia','Otto','Pia','Quill','Remy','Sage','Tate','Uma','Vero','Wade','Xan',
  'Yuri','Zev','Bram','Cove','Dune','Eero','Fen','Gale','Hollis','Ines','Juno','Knox'
]

export const HUES = ['aqua', 'azure', 'violet', 'amber', 'rose', 'lime'] as const

export const DEFAULT_SETTINGS: Settings = {
  themeId: DEFAULT_THEME_ID,
  accentOverride: null,
  fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
  fontSize: 12,
  // 1.0 is what Terminal.app uses. Anything taller stretches the cell, and the
  // block cursor stretches with it — that is what makes it look elongated.
  lineHeight: 1,
  shell: '',
  defaultAgentId: 'claude',
  // A filled block, the way Terminal.app does it — it inverts the character
  // underneath and stays legible at a glance across a grid of panes.
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 8000,
  confirmClose: true,
  reduceMotion: false,
  bellAttention: true,

  voiceModelId: '',
  voiceMicId: '',
  voiceLanguage: 'auto',
  voiceSilenceMs: 1500,
  voiceHoldKey: 'MetaRight',

  speakOnFinish: false,
  speakVoice: '',
  speakRate: 180,
  speakVolume: 0.75,
  speakOnlyWhenAway: false,

  browserHome: 'http://localhost:5173',
  browserSearchEngine: DEFAULT_SEARCH_ENGINE,
  browserZoom: 1,

  usageFromAnthropic: false,
  usageSessionLimit: 0,
  usageWeekLimit: 0
}
