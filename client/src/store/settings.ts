import { create } from 'zustand';
import { applyTheme, themeMeta } from '../lib/theme';
import {
  getTerminalFontSize,
  repaintTerminals,
  setTerminalCursorBlink,
  setTerminalCursorStyle,
  setTerminalFont,
  setTerminalFontSize,
  setTerminalScrollback,
  type TerminalCursorStyle,
} from '../lib/terminals';

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'terminal'
  | 'editor'
  | 'agents'
  | 'sessions'
  | 'board'
  | 'git'
  | 'notifications'
  | 'shortcuts'
  | 'data'
  | 'about';

const STORAGE_KEY = 'eaon.settings.v1';

export type ThemeMode = 'system' | 'dark' | 'light';
export type SidebarSkin = 'default' | 'match-terminal' | 'tinted';
export type CardLayout = 'detailed' | 'compact';
export type UsageMode = 'used' | 'remaining';
export type SessionPlacement = 'smart' | 'split';

/** Which shortcut buttons the sidebar's top nav shows. */
export interface SidebarNavBits {
  tasks: boolean;
  pulls: boolean;
  files: boolean;
  memory: boolean;
}

interface PersistedSettings {
  theme: string;
  defaultAgentId: string | null;
  editorFontSize: number;
  editorMinimap: boolean;
  editorWordWrap: boolean;
  showClaudeUsage: boolean;
  claudeAccountSlug: string | null;

  /* interface */
  themeMode: ThemeMode;
  darkTheme: string;
  lightTheme: string;
  uiScale: number;
  uiFont: string;

  /* terminal */
  terminalFontFamily: string;
  terminalTheme: string;
  dividerColor: string;
  showPaneDivider: boolean;
  terminalCursorStyle: TerminalCursorStyle;
  terminalCursorBlink: boolean;
  terminalScrollback: number;

  /* window & sidebar */
  sidebarSkin: SidebarSkin;
  usageMode: UsageMode;
  sidebarNav: SidebarNavBits;
  cardLayout: CardLayout;
  filesShowHidden: boolean;

  /* general */
  sessionPlacement: SessionPlacement;

  /* sessions */
  replayScrollback: boolean;

  /* board */
  boardDispatchAgentId: string | null;
  boardAutoProgress: boolean;

  /* git */
  gitAutoRefresh: boolean;
  gitRefreshSeconds: number;

  /* notifications & sounds */
  notifyEnabled: boolean;
  notifyWaiting: boolean;
  notifyExit: boolean;
  soundEnabled: boolean;
  soundVolume: number;
}

const DEFAULTS: PersistedSettings = {
  theme: 'eaon',
  defaultAgentId: null,
  editorFontSize: 12,
  editorMinimap: false,
  editorWordWrap: false,
  showClaudeUsage: true,
  claudeAccountSlug: null,

  themeMode: 'dark',
  darkTheme: 'eaon',
  lightTheme: 'daylight',
  uiScale: 1,
  uiFont: '',

  terminalFontFamily: '',
  terminalTheme: 'follow',
  dividerColor: '',
  showPaneDivider: true,
  terminalCursorStyle: 'bar',
  terminalCursorBlink: true,
  terminalScrollback: 8000,

  sidebarSkin: 'default',
  usageMode: 'used',
  sidebarNav: { tasks: true, pulls: true, files: true, memory: true },
  cardLayout: 'detailed',
  filesShowHidden: false,

  sessionPlacement: 'smart',

  replayScrollback: true,

  boardDispatchAgentId: null,
  boardAutoProgress: true,

  gitAutoRefresh: true,
  gitRefreshSeconds: 10,

  notifyEnabled: true,
  notifyWaiting: true,
  notifyExit: true,
  soundEnabled: false,
  soundVolume: 75,
};

function loadPersisted(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<PersistedSettings>;
    // Nested objects need their own merge, or a settings file written before a
    // bit existed leaves it undefined and the switch renders uncontrolled.
    return {
      ...DEFAULTS,
      ...saved,
      sidebarNav: { ...DEFAULTS.sidebarNav, ...(saved.sidebarNav ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(s: PersistedSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface SettingsState extends PersistedSettings {
  open: boolean;
  section: SettingsSection;
  terminalFontSize: number;

  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setSection: (section: SettingsSection) => void;

  setTheme: (id: string) => void;
  setTerminalFontSize: (px: number) => void;
  setEditorFontSize: (px: number) => void;
  setEditorMinimap: (on: boolean) => void;
  setEditorWordWrap: (on: boolean) => void;
  setDefaultAgent: (id: string | null) => void;
  setShowClaudeUsage: (on: boolean) => void;
  setClaudeAccount: (slug: string | null) => void;

  setThemeMode: (mode: ThemeMode) => void;
  setUiScale: (scale: number) => void;
  setUiFont: (font: string) => void;
  setTerminalFontFamily: (font: string) => void;
  setTerminalTheme: (id: string) => void;
  setDividerColor: (hex: string) => void;
  setShowPaneDivider: (on: boolean) => void;
  setSidebarSkin: (skin: SidebarSkin) => void;
  setUsageMode: (mode: UsageMode) => void;
  setSidebarNavBit: (key: keyof SidebarNavBits, on: boolean) => void;
  setCardLayout: (layout: CardLayout) => void;
  setFilesShowHidden: (on: boolean) => void;

  setTerminalCursorStyle: (style: TerminalCursorStyle) => void;
  setTerminalCursorBlink: (on: boolean) => void;
  setTerminalScrollback: (lines: number) => void;
  setSessionPlacement: (mode: SessionPlacement) => void;
  setReplayScrollback: (on: boolean) => void;
  setBoardDispatchAgent: (id: string | null) => void;
  setBoardAutoProgress: (on: boolean) => void;
  setGitAutoRefresh: (on: boolean) => void;
  setGitRefreshSeconds: (seconds: number) => void;
  setNotifyEnabled: (on: boolean) => void;
  setNotifyWaiting: (on: boolean) => void;
  setNotifyExit: (on: boolean) => void;
  setSoundEnabled: (on: boolean) => void;
  setSoundVolume: (volume: number) => void;
  resetAll: () => void;
}

/**
 * The theme the app should actually wear. `themeMode` is the intent — follow
 * the OS, or pin to dark/light — and `darkTheme`/`lightTheme` remember which
 * palette each mode prefers, so flipping mode doesn't lose your choice.
 */
function resolveTheme(s: {
  themeMode: ThemeMode;
  darkTheme: string;
  lightTheme: string;
}): string {
  if (s.themeMode === 'dark') return s.darkTheme;
  if (s.themeMode === 'light') return s.lightTheme;
  const prefersDark =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true;
  return prefersDark ? s.darkTheme : s.lightTheme;
}

/**
 * Chrome-only zoom. Deliberately not Electron's page zoom: that rescales the
 * terminal too, which throws off xterm's glyph metrics and the fit addon's
 * column maths. Every type token multiplies by this instead, so the shell
 * scales and the terminals keep their own independent font size.
 */
function applyUiScale(scale: number): void {
  // A non-finite value here would make every calc() invalid and drop the type
  // scale wholesale, so a bad persisted value can never reach the stylesheet.
  const safe = Number.isFinite(scale) ? Math.max(0.8, Math.min(1.4, scale)) : 1;
  document.documentElement.style.setProperty('--ui-scale', String(safe));
}

/** The stack `--font` falls back to; kept in sync with styles.css. */
const SYSTEM_UI_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif';

/**
 * Replaces `--font` outright rather than prepending via a second variable.
 * An empty custom property inside a font-family list resolves to a leading
 * comma, which makes the declaration invalid and silently drops every UI font
 * back to the browser's default serif. Removing the property restores the
 * stylesheet's own value.
 */
function applyUiFont(font: string): void {
  const root = document.documentElement.style;
  if (font) root.setProperty('--font', `"${font}", ${SYSTEM_UI_STACK}`);
  else root.removeProperty('--font');
}

function applyDivider(hex: string): void {
  const root = document.documentElement.style;
  if (/^#[0-9a-f]{6}$/i.test(hex)) root.setProperty('--divider-override', hex);
  else root.removeProperty('--divider-override');
}

function applyChrome(s: {
  uiScale: number;
  uiFont: string;
  dividerColor: string;
  sidebarSkin: SidebarSkin;
  showPaneDivider: boolean;
}): void {
  applyUiScale(s.uiScale);
  applyUiFont(s.uiFont);
  applyDivider(s.dividerColor);
  document.documentElement.setAttribute('data-sidebar-skin', s.sidebarSkin);
  document.documentElement.toggleAttribute('data-no-divider', !s.showPaneDivider);
}

const saved = loadPersisted();

export const useSettings = create<SettingsState>((set, get) => ({
  ...saved,
  open: false,
  section: 'appearance',
  terminalFontSize: getTerminalFontSize(),

  openSettings: (section) =>
    set((s) => ({
      open: true,
      section: section ?? s.section ?? 'appearance',
      // ⌘+/⌘− can change this while settings are closed; re-sync on open.
      terminalFontSize: getTerminalFontSize(),
    })),

  closeSettings: () => set({ open: false }),

  toggleSettings: () => set((s) => ({ open: !s.open })),

  setSection: (section) => set({ section }),

  // Picking a palette also pins it as the preference for its own kind, so
  // switching System → Dark → Light and back keeps each choice.
  setTheme: (theme) => {
    const kind = themeMeta(theme).kind;
    set(kind === 'light' ? { theme, lightTheme: theme } : { theme, darkTheme: theme });
    persist({ ...get() });
  },

  setThemeMode: (themeMode) => {
    set({ themeMode });
    set({ theme: resolveTheme(get()) });
    persist({ ...get() });
  },

  setUiScale: (scale) => {
    const clamped = Math.max(0.8, Math.min(1.4, Math.round(scale * 100) / 100));
    applyUiScale(clamped);
    set({ uiScale: clamped });
    persist({ ...get() });
  },

  setUiFont: (uiFont) => {
    applyUiFont(uiFont);
    set({ uiFont });
    persist({ ...get() });
  },

  setTerminalFontFamily: (terminalFontFamily) => {
    setTerminalFont(terminalFontFamily);
    set({ terminalFontFamily });
    persist({ ...get() });
  },

  setTerminalTheme: (terminalTheme) => {
    set({ terminalTheme });
    persist({ ...get() });
    repaintTerminals();
  },

  setDividerColor: (dividerColor) => {
    applyDivider(dividerColor);
    set({ dividerColor });
    persist({ ...get() });
  },

  setShowPaneDivider: (on) => {
    document.documentElement.toggleAttribute('data-no-divider', !on);
    set({ showPaneDivider: on });
    persist({ ...get() });
  },

  setSidebarSkin: (sidebarSkin) => {
    document.documentElement.setAttribute('data-sidebar-skin', sidebarSkin);
    set({ sidebarSkin });
    persist({ ...get() });
  },

  setUsageMode: (usageMode) => {
    set({ usageMode });
    persist({ ...get() });
  },

  setSidebarNavBit: (key, on) => {
    set((s) => ({ sidebarNav: { ...s.sidebarNav, [key]: on } }));
    persist({ ...get() });
  },

  setCardLayout: (cardLayout) => {
    set({ cardLayout });
    persist({ ...get() });
  },

  setFilesShowHidden: (on) => {
    set({ filesShowHidden: on });
    persist({ ...get() });
  },

  setTerminalFontSize: (px) => {
    const clamped = Math.max(9, Math.min(24, Math.round(px)));
    setTerminalFontSize(clamped);
    set({ terminalFontSize: clamped });
  },

  setEditorFontSize: (px) => {
    const clamped = Math.max(10, Math.min(20, Math.round(px)));
    set({ editorFontSize: clamped });
    persist({ ...get() });
  },

  setEditorMinimap: (on) => {
    set({ editorMinimap: on });
    persist({ ...get() });
  },

  setEditorWordWrap: (on) => {
    set({ editorWordWrap: on });
    persist({ ...get() });
  },

  setDefaultAgent: (id) => {
    set({ defaultAgentId: id });
    persist({ ...get() });
  },

  setShowClaudeUsage: (on) => {
    set({ showClaudeUsage: on });
    persist({ ...get() });
  },

  setClaudeAccount: (slug) => {
    set({ claudeAccountSlug: slug });
    persist({ ...get() });
  },

  setTerminalCursorStyle: (style) => {
    setTerminalCursorStyle(style);
    set({ terminalCursorStyle: style });
    persist({ ...get() });
  },

  setTerminalCursorBlink: (on) => {
    setTerminalCursorBlink(on);
    set({ terminalCursorBlink: on });
    persist({ ...get() });
  },

  setTerminalScrollback: (lines) => {
    const clamped = Math.max(1000, Math.min(20000, Math.round(lines / 1000) * 1000));
    setTerminalScrollback(clamped);
    set({ terminalScrollback: clamped });
    persist({ ...get() });
  },

  setSessionPlacement: (mode) => {
    set({ sessionPlacement: mode });
    persist({ ...get() });
  },

  setReplayScrollback: (on) => {
    set({ replayScrollback: on });
    persist({ ...get() });
  },

  setBoardDispatchAgent: (id) => {
    set({ boardDispatchAgentId: id });
    persist({ ...get() });
  },

  setBoardAutoProgress: (on) => {
    set({ boardAutoProgress: on });
    persist({ ...get() });
  },

  setGitAutoRefresh: (on) => {
    set({ gitAutoRefresh: on });
    persist({ ...get() });
  },

  setGitRefreshSeconds: (seconds) => {
    const clamped = Math.max(5, Math.min(120, Math.round(seconds)));
    set({ gitRefreshSeconds: clamped });
    persist({ ...get() });
  },

  setNotifyEnabled: (on) => {
    set({ notifyEnabled: on });
    persist({ ...get() });
  },

  setNotifyWaiting: (on) => {
    set({ notifyWaiting: on });
    persist({ ...get() });
  },

  setNotifyExit: (on) => {
    set({ notifyExit: on });
    persist({ ...get() });
  },

  setSoundEnabled: (on) => {
    set({ soundEnabled: on });
    persist({ ...get() });
  },

  setSoundVolume: (volume) => {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    set({ soundVolume: clamped });
    persist({ ...get() });
  },

  resetAll: () => {
    // Every settings write flows through persist(), so dropping the key and
    // re-applying the defaults is a complete reset; the page reload picks up
    // the other one-off localStorage keys (font size, sidebar, tabs) too.
    localStorage.removeItem(STORAGE_KEY);
    Object.keys(localStorage)
      .filter((k) => k.startsWith('eaon.'))
      .forEach((k) => localStorage.removeItem(k));
    location.reload();
  },
}));

// Apply the persisted look at boot and follow every later change. Persisted
// state is spread into the store, so `persist({ ...get() })` carries the
// other fields along on each write.
{
  const s = useSettings.getState();
  // In System mode the OS has the final say, so re-resolve rather than
  // trusting the theme that was persisted on whatever the OS was doing then.
  const boot = s.themeMode === 'system' ? resolveTheme(s) : s.theme;
  if (boot !== s.theme) useSettings.setState({ theme: boot });
  applyTheme(boot);
  applyChrome(s);
  if (s.terminalFontFamily) setTerminalFont(s.terminalFontFamily);
  setTerminalCursorStyle(s.terminalCursorStyle);
  setTerminalCursorBlink(s.terminalCursorBlink);
  setTerminalScrollback(s.terminalScrollback);
}

let lastTheme = useSettings.getState().theme;
useSettings.subscribe((s) => {
  if (s.theme !== lastTheme) {
    lastTheme = s.theme;
    applyTheme(s.theme);
  }
});

// Follow the OS appearance, but only while the user asked us to.
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const s = useSettings.getState();
    if (s.themeMode !== 'system') return;
    useSettings.setState({ theme: resolveTheme(s) });
  });
}
