import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { wsClient } from './ws';
import { buildXtermTheme, subscribeTheme } from './theme';

export interface TermEntry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  opened: boolean;
  webglTried: boolean;
  /* Last size actually sent to the PTY; 0 means never. Fit results that
     repeat are swallowed here so the server never sees a resize storm. */
  sentCols: number;
  sentRows: number;
}

const entries = new Map<string, TermEntry>();
const locallySpawned = new Set<string>();

// Browsers cap WebGL contexts (~16); leave headroom for Monaco/others.
let webglBudget = 10;

export function markLocallySpawned(id: string): void {
  locallySpawned.add(id);
}

export function wasLocallySpawned(id: string): boolean {
  return locallySpawned.has(id);
}

const attachRequested = new Set<string>();

/** True exactly once per session per page load, and never for locally spawned sessions. */
export function shouldRequestReplay(id: string): boolean {
  if (locallySpawned.has(id)) return false;
  if (attachRequested.has(id)) return false;
  attachRequested.add(id);
  return true;
}

const DEFAULT_FONT_SIZE = 13;
let fontSize = Number(localStorage.getItem('eaon.termFontSize')) || DEFAULT_FONT_SIZE;

export function getTerminalFontSize(): number {
  return fontSize;
}

const BASE_FONT = '"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Mono", monospace';
let fontStack = BASE_FONT;

export type TerminalCursorStyle = 'bar' | 'block' | 'underline';

let cursorStyle: TerminalCursorStyle = 'bar';
let cursorBlink = true;
let scrollbackLines = 8000;

/** Live-updatable: xterm re-reads options on the next frame. */
export function setTerminalCursorStyle(style: TerminalCursorStyle): void {
  cursorStyle = style;
  for (const entry of entries.values()) entry.term.options.cursorStyle = style;
}

export function setTerminalCursorBlink(on: boolean): void {
  cursorBlink = on;
  for (const entry of entries.values()) entry.term.options.cursorBlink = on;
}

/** Shrinking truncates the oldest lines in every pane — xterm handles the trim. */
export function setTerminalScrollback(lines: number): void {
  scrollbackLines = Math.max(1000, Math.min(20000, Math.round(lines)));
  for (const entry of entries.values()) entry.term.options.scrollback = scrollbackLines;
}

/**
 * Put the chosen family in front of the stack rather than replacing it, so a
 * font that turns out not to be installed degrades to the same monospace
 * fallbacks instead of to a proportional face — which would wreck alignment.
 */
export function setTerminalFont(family: string): void {
  fontStack = family ? `"${family}", ${BASE_FONT}` : BASE_FONT;
  for (const [id, entry] of entries) {
    entry.term.options.fontFamily = fontStack;
    fitTerminal(id);
  }
}

/** Re-apply the resolved palette to every open terminal. */
export function repaintTerminals(): void {
  for (const entry of entries.values()) entry.term.options.theme = buildXtermTheme();
}

/** Set an absolute size, clamped, and refit every open pane. */
export function setTerminalFontSize(px: number): void {
  fontSize = Math.max(9, Math.min(24, Math.round(px)));
  localStorage.setItem('eaon.termFontSize', String(fontSize));
  for (const [id, entry] of entries) {
    entry.term.options.fontSize = fontSize;
    fitTerminal(id);
  }
}

/**
 * ⌘+/⌘−/⌘0 must change the terminal font, not the page zoom. Page zoom
 * rescales the whole layout and throws off xterm's glyph metrics and the fit
 * addon's column maths; this resizes the type and refits every pane.
 */
export function adjustTerminalFontSize(delta: number | 'reset'): void {
  setTerminalFontSize(delta === 'reset' ? DEFAULT_FONT_SIZE : fontSize + delta);
}

export function getOrCreateTerminal(id: string): TermEntry {
  const existing = entries.get(id);
  if (existing) return existing;

  const term = new Terminal({
    fontFamily: fontStack,
    fontSize,
    lineHeight: 1.25,
    cursorBlink,
    cursorStyle,
    scrollback: scrollbackLines,
    allowProposedApi: true,
    // Derived from the design tokens in styles.css/themes.css: the chrome's
    // background, the theme's accent for the cursor, and ANSI hues from the
    // semantic state colours. Repainted live when the theme switches.
    theme: buildXtermTheme(),
  });

  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon());

  term.onData((data) => {
    wsClient.send({ t: 'input', id, data });
  });

  const entry: TermEntry = { term, fit, search, opened: false, webglTried: false, sentCols: 0, sentRows: 0 };
  entries.set(id, entry);
  return entry;
}

export function attachTerminal(id: string, container: HTMLElement): TermEntry {
  const entry = getOrCreateTerminal(id);
  if (entry.opened && entry.term.element) {
    if (entry.term.element.parentElement !== container) {
      container.appendChild(entry.term.element);
    }
  } else {
    entry.term.open(container);
    entry.opened = true;
  }

  if (!entry.webglTried) {
    entry.webglTried = true;
    if (webglBudget > 0) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          webglBudget += 1;
        });
        entry.term.loadAddon(webgl);
        webglBudget -= 1;
      } catch {
        // fall back to the default canvas renderer
      }
    }
  }

  requestAnimationFrame(() => fitTerminal(id));
  return entry;
}

/* Below these the pane is unusable anyway; fitting at a degenerate size only
   reflows the scrollback into garbage and shrinks full-screen TUIs (Claude
   Code redraws on SIGWINCH) to a sliver they never recover from. */
const MIN_COLS = 20;
const MIN_ROWS = 4;

export function fitTerminal(id: string): { cols: number; rows: number } | null {
  const entry = entries.get(id);
  if (!entry || !entry.opened) return null;

  // An occluded window (alt-tab with full coverage, another Space, minimize)
  // reports visibilityState=hidden and can yield transient zero-ish sizes.
  // Fitting then would bake a bogus size into both xterm's buffer and the
  // PTY — the "condensed Claude" bug. Wait for the focus/visibility heal.
  if (document.hidden) return null;

  const el = entry.term.element;
  if (!el || el.clientWidth < 40 || el.clientHeight < 20) return null;

  try {
    entry.fit.fit();
    const { cols, rows } = entry.term;
    if (cols < MIN_COLS || rows < MIN_ROWS) return null;
    if (cols === entry.sentCols && rows === entry.sentRows) return { cols, rows };
    entry.sentCols = cols;
    entry.sentRows = rows;
    wsClient.send({ t: 'resize', id, cols, rows });
    return { cols, rows };
  } catch {
    return null;
  }
}

/**
 * Refit every open terminal. Called when the window comes back from being
 * hidden or unfocused, so any resize that was swallowed while occluded —
 * or baked in by a window-manager transition — self-heals on return.
 */
export function refitAllTerminals(): void {
  for (const id of entries.keys()) fitTerminal(id);
}

export function focusTerminal(id: string): void {
  entries.get(id)?.term.focus();
}

export function writeToTerminal(id: string, data: string): void {
  entries.get(id)?.term.write(data);
}

export function disposeTerminal(id: string): void {
  const entry = entries.get(id);
  if (entry) {
    entry.term.dispose();
    entries.delete(id);
  }
  locallySpawned.delete(id);
  attachRequested.delete(id);
}

export function hasTerminal(id: string): boolean {
  return entries.has(id);
}

// Repaint every live terminal when the app theme changes.
subscribeTheme(() => {
  const theme = buildXtermTheme();
  for (const [, entry] of entries) {
    entry.term.options.theme = theme;
  }
});
