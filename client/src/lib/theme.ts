import * as monaco from 'monaco-editor';
import type { ITheme } from '@xterm/xterm';
import { schemeToXterm, termScheme } from './termThemes';

/** The settings store's persisted blob; read directly to avoid an import cycle. */
function readTerminalSchemeId(): string | null {
  try {
    const raw = localStorage.getItem('eaon.settings.v1');
    if (!raw) return null;
    return (JSON.parse(raw) as { terminalTheme?: string }).terminalTheme ?? null;
  } catch {
    return null;
  }
}

export type ThemeKind = 'dark' | 'light';

export interface ThemeMeta {
  /** data-theme value; 'eaon' maps to the :root tokens (no attribute). */
  id: string;
  name: string;
  kind: ThemeKind;
  desc: string;
}

export const THEMES: ThemeMeta[] = [
  { id: 'eaon', name: 'Eaon', kind: 'dark', desc: 'The default. Ink chrome, coral accent.' },
  { id: 'midnight', name: 'Midnight', kind: 'dark', desc: 'Deep blue-black with an indigo accent.' },
  { id: 'tokyo-night', name: 'Tokyo Night', kind: 'dark', desc: 'Cool dusk tones, sky-blue accent.' },
  { id: 'nord', name: 'Nord', kind: 'dark', desc: 'Arctic blues, calm and low-contrast.' },
  { id: 'catppuccin', name: 'Catppuccin Mocha', kind: 'dark', desc: 'Warm pastels on a mauve base.' },
  { id: 'github-dark', name: 'GitHub Dark', kind: 'dark', desc: 'The familiar canvas and scale.' },
  { id: 'solarized', name: 'Solarized Dark', kind: 'dark', desc: 'Precision-teal, easy on long nights.' },
  { id: 'one-dark', name: 'One Dark', kind: 'dark', desc: 'Atom’s classic grey-blue palette.' },
  { id: 'daylight', name: 'Daylight', kind: 'light', desc: 'Clean paper-white, burnt amber accent.' },
  { id: 'paper', name: 'Solarized Light', kind: 'light', desc: 'Warm parchment for bright rooms.' },
];

export function themeMeta(id: string): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/* ------------------------------------------------------------------ */

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mix(hex: string, toward: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(toward);
  const c = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `#${[c(r1, r2), c(g1, g2), c(b1, b2)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Resolved hex for a token that is a plain colour (hex in every theme). */
function colorOf(name: string, fallback: string): string {
  const v = readVar(name);
  return v.startsWith('#') ? v : fallback;
}

/* ------------------------------------------------------------------ */
/* xterm                                                                */

/**
 * Terminal colours follow the app theme: the background and cursor come from
 * the same tokens as the chrome, ANSI hues from the semantic state colours.
 * Bright ANSI variants step toward the foreground's light end so `ls -l`
 * keeps its two-tone contrast in any theme.
 */
export function buildXtermTheme(): ITheme {
  // An explicit scheme wins over the app theme. Read straight from storage
  // rather than importing the settings store — that store imports this module,
  // and the cycle would leave one of them half-initialised at boot.
  const chosen = readTerminalSchemeId();
  if (chosen && chosen !== 'follow') {
    const scheme = termScheme(chosen);
    if (scheme) return schemeToXterm(scheme);
  }

  const meta = themeMeta(document.documentElement.getAttribute('data-theme') ?? 'eaon');
  const canvas = colorOf('--n-950', '#0a0a0a');
  const accent = colorOf('--accent', '#e0a84d');
  const accentHi = colorOf('--accent-hi', '#efbb63');
  const ok = colorOf('--ok', '#4ec26a');
  const info = colorOf('--info', '#5b9cf8');
  const danger = colorOf('--danger', '#f2635a');
  const folder = colorOf('--folder', '#4dc4c0');
  const magenta = colorOf('--magenta', '#bc8cff');
  const shift = meta.kind === 'light' ? '#1a1a1a' : '#ffffff';
  const bright = (hex: string) => mix(hex, shift, 0.18);

  return {
    background: canvas,
    foreground: colorOf('--n-100', '#d4d4d4'),
    cursor: accent,
    cursorAccent: canvas,
    selectionBackground: rgba(accent, 0.26),
    black: colorOf('--n-750', '#1f1f1f'),
    red: danger,
    green: ok,
    yellow: accent,
    blue: info,
    magenta,
    cyan: folder,
    white: colorOf('--n-200', '#a8a8a8'),
    brightBlack: colorOf('--n-400', '#6e6e6e'),
    brightRed: bright(danger),
    brightGreen: bright(ok),
    brightYellow: accentHi,
    brightBlue: bright(info),
    brightMagenta: bright(magenta),
    brightCyan: bright(folder),
    brightWhite: colorOf('--n-000', '#fafafa'),
  };
}

/* ------------------------------------------------------------------ */
/* monaco                                                               */

/**
 * Re-points the 'eaon-dark' editor theme at the active app theme. The name is
 * kept so mounted editors (which hold the name, not the colours) pick up the
 * change the moment the theme switches.
 */
function syncMonaco(meta: ThemeMeta): void {
  const accent = colorOf('--accent', '#e0a84d');
  const ok = colorOf('--ok', '#4ec26a');
  const danger = colorOf('--danger', '#f2635a');
  const light = meta.kind === 'light';
  const scroll = (a: number) => (light ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);

  monaco.editor.defineTheme('eaon-dark', {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': colorOf('--n-900', '#0f0f0f'),
      'editor.foreground': colorOf('--n-100', '#d4d4d4'),
      'editor.lineHighlightBackground': colorOf('--n-850', '#161616'),
      'editor.selectionBackground': rgba(accent, light ? 0.2 : 0.24),
      'editorCursor.foreground': accent,
      'editorLineNumber.foreground': colorOf('--n-500', '#4d4d4d'),
      'editorLineNumber.activeForeground': colorOf('--n-200', '#a8a8a8'),
      'editorIndentGuide.background1': colorOf('--n-750', '#1f1f1f'),
      'editorGutter.background': colorOf('--n-900', '#0f0f0f'),
      'editorWidget.background': colorOf('--n-800', '#191919'),
      'editorWidget.border': colorOf('--n-700', '#262626'),
      'editorSuggestWidget.background': colorOf('--n-800', '#191919'),
      'editorSuggestWidget.selectedBackground': colorOf('--n-700', '#262626'),
      'editorOverviewRuler.border': '#00000000',
      'diffEditor.insertedTextBackground': rgba(ok, 0.12),
      'diffEditor.removedTextBackground': rgba(danger, 0.12),
      'scrollbarSlider.background': scroll(0.08),
      'scrollbarSlider.hoverBackground': scroll(0.15),
      'scrollbarSlider.activeBackground': scroll(0.2),
      'input.background': colorOf('--n-950', '#0a0a0a'),
      'input.border': colorOf('--n-700', '#262626'),
      focusBorder: rgba(accent, 0.4),
    },
  });
  monaco.editor.setTheme('eaon-dark');
}

/* ------------------------------------------------------------------ */
/* application                                                          */

type ThemeListener = (meta: ThemeMeta) => void;
const listeners = new Set<ThemeListener>();

/** Other subsystems (xterm instances) hook in here to repaint live. */
export function subscribeTheme(fn: ThemeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyTheme(id: string): void {
  const meta = themeMeta(id);
  const rootEl = document.documentElement;
  if (meta.id === 'eaon') rootEl.removeAttribute('data-theme');
  else rootEl.setAttribute('data-theme', meta.id);
  rootEl.toggleAttribute('data-theme-light', meta.kind === 'light');
  syncMonaco(meta);
  for (const fn of listeners) fn(meta);
}
