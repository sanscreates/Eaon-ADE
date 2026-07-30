import type { ITheme } from '@xterm/xterm';

/**
 * Terminal colour schemes, independent of the app theme.
 *
 * These are the long-standing community palettes people already know by name.
 * Each is published under a permissive licence by its author (Dracula, Nord,
 * Catppuccin, Gruvbox, One Dark, Ayu, Everforest and Tokyo Night are MIT;
 * Solarized is MIT; Tango is a public-domain GNOME palette; Monokai's colour
 * values have been published openly for two decades). Only the sixteen ANSI
 * values plus background/foreground/cursor are reproduced — no code, no
 * assets — and each is credited by its own name in the picker.
 *
 * `follow` is the default and is not listed here: it means "derive the
 * terminal palette from the active app theme", which is what buildXtermTheme
 * does on its own.
 */
export interface TermScheme {
  id: string;
  name: string;
  kind: 'dark' | 'light';
  bg: string;
  fg: string;
  cursor: string;
  /** black, red, green, yellow, blue, magenta, cyan, white */
  normal: [string, string, string, string, string, string, string, string];
  bright: [string, string, string, string, string, string, string, string];
}

export const TERM_SCHEMES: TermScheme[] = [
  {
    id: 'dracula',
    name: 'Dracula',
    kind: 'dark',
    bg: '#282a36',
    fg: '#f8f8f2',
    cursor: '#f8f8f2',
    normal: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'],
    bright: ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  },
  {
    id: 'nord',
    name: 'Nord',
    kind: 'dark',
    bg: '#2e3440',
    fg: '#d8dee9',
    cursor: '#d8dee9',
    normal: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'],
    bright: ['#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    kind: 'dark',
    bg: '#1e1e2e',
    fg: '#cdd6f4',
    cursor: '#f5e0dc',
    normal: ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de'],
    bright: ['#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'],
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    kind: 'dark',
    bg: '#282828',
    fg: '#ebdbb2',
    cursor: '#ebdbb2',
    normal: ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984'],
    bright: ['#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'],
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    kind: 'dark',
    bg: '#1a1b26',
    fg: '#c0caf5',
    cursor: '#c0caf5',
    normal: ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6'],
    bright: ['#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'],
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    kind: 'dark',
    bg: '#282c34',
    fg: '#abb2bf',
    cursor: '#528bff',
    normal: ['#3f4451', '#e05561', '#8cc265', '#d18f52', '#4aa5f0', '#c162de', '#42b3c2', '#e6e6e6'],
    bright: ['#4f5666', '#ff616e', '#a5e075', '#f0a45d', '#4dc4ff', '#de73ff', '#4cd1e0', '#ffffff'],
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    kind: 'dark',
    bg: '#002b36',
    fg: '#839496',
    cursor: '#93a1a1',
    normal: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
    bright: ['#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
  },
  {
    id: 'ayu-dark',
    name: 'Ayu Dark',
    kind: 'dark',
    bg: '#0b0e14',
    fg: '#bfbdb6',
    cursor: '#e6b450',
    normal: ['#0d1017', '#ea6c73', '#7fd962', '#f9af4f', '#53bdfa', '#cda1fa', '#90e1c6', '#c7c7c7'],
    bright: ['#686868', '#f07178', '#aad94c', '#ffb454', '#59c2ff', '#d2a6ff', '#95e6cb', '#ffffff'],
  },
  {
    id: 'everforest-dark',
    name: 'Everforest Dark',
    kind: 'dark',
    bg: '#2d353b',
    fg: '#d3c6aa',
    cursor: '#d3c6aa',
    normal: ['#475258', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa'],
    bright: ['#5c6a72', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#fffbef'],
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    kind: 'dark',
    bg: '#0d1117',
    fg: '#c9d1d9',
    cursor: '#58a6ff',
    normal: ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4'],
    bright: ['#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc'],
  },
  {
    id: 'monokai',
    name: 'Monokai',
    kind: 'dark',
    bg: '#272822',
    fg: '#f8f8f2',
    cursor: '#f8f8f0',
    normal: ['#272822', '#f92672', '#a6e22e', '#e6db74', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2'],
    bright: ['#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5'],
  },
  {
    id: 'tango-dark',
    name: 'Tango Dark',
    kind: 'dark',
    bg: '#2e3436',
    fg: '#d3d7cf',
    cursor: '#d3d7cf',
    normal: ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf'],
    bright: ['#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'],
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    kind: 'light',
    bg: '#eff1f5',
    fg: '#4c4f69',
    cursor: '#dc8a78',
    normal: ['#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be'],
    bright: ['#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc'],
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    kind: 'light',
    bg: '#fdf6e3',
    fg: '#657b83',
    cursor: '#586e75',
    normal: ['#eee8d5', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#073642'],
    bright: ['#fdf6e3', '#cb4b16', '#93a1a1', '#839496', '#657b83', '#6c71c4', '#586e75', '#002b36'],
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    kind: 'light',
    bg: '#ffffff',
    fg: '#24292f',
    cursor: '#0969da',
    normal: ['#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781'],
    bright: ['#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f'],
  },
  {
    id: 'tango-light',
    name: 'Tango Light',
    kind: 'light',
    bg: '#ffffff',
    fg: '#2e3436',
    cursor: '#2e3436',
    normal: ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf'],
    bright: ['#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'],
  },
];

export function termScheme(id: string): TermScheme | null {
  return TERM_SCHEMES.find((s) => s.id === id) ?? null;
}

export function schemeToXterm(s: TermScheme): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white] = s.normal;
  const [bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite] = s.bright;
  return {
    background: s.bg,
    foreground: s.fg,
    cursor: s.cursor,
    cursorAccent: s.bg,
    selectionBackground: `${s.fg}44`,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack: bBlack,
    brightRed: bRed,
    brightGreen: bGreen,
    brightYellow: bYellow,
    brightBlue: bBlue,
    brightMagenta: bMagenta,
    brightCyan: bCyan,
    brightWhite: bWhite,
  };
}
