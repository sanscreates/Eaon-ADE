import { create } from 'zustand';
import { api } from '../lib/api';
import { uid } from '../lib/utils';
import { navigateWebview } from '../lib/webviews';

export type ConsoleLevel = 'log' | 'info' | 'warning' | 'error';

export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  message: string;
  source?: string;
  line?: number;
  at: number;
}

export interface BrowserTab {
  id: string;
  /** Where the page actually is. Empty means the start page. */
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  failure: { code: number; description: string; url: string } | null;
  logs: ConsoleEntry[];
  /** Bumped on every explicit navigate or reload. Only the iframe fallback
   *  needs it — it has no reload() to call, so it is re-keyed instead. */
  reloadSeq: number;
}

/** A dev server the machine is currently running, found by scanning ports. */
export interface DetectedServer {
  port: number;
  url: string;
  title?: string;
}

export interface DevicePreset {
  id: string;
  label: string;
  /** 0 means "whatever the panel is" — no emulation, no scaling. */
  width: number;
  height: number;
}

/* Sizes are CSS pixels, which is what a page actually lays out against.
   Deliberately short: the point is to catch a broken breakpoint in two
   clicks, not to reproduce a device lab. */
export const DEVICES: DevicePreset[] = [
  { id: 'responsive', label: 'Responsive', width: 0, height: 0 },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { id: 'iphone', label: 'iPhone 15 Pro', width: 393, height: 852 },
  { id: 'pixel', label: 'Pixel 8', width: 412, height: 915 },
  { id: 'ipad', label: 'iPad', width: 820, height: 1180 },
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
  { id: 'desktop', label: 'Desktop', width: 1512, height: 945 },
];

const LOG_LIMIT = 300;
const RECENT_LIMIT = 12;
const STORE_KEY = 'eaon.browser';

/**
 * Typing a URL should be the slow path. A bare port, a `:port`, `localhost`
 * or an IP all mean "the thing I am running right now"; a dotted name means a
 * site; anything else is a search. Getting this right is most of why you stop
 * reaching for Chrome.
 */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  if (/^(https?|file|data|about|blob|chrome):/i.test(raw)) return raw;
  // A bare port, with or without a path: `3000`, `3000/checkout`, `:5173`.
  if (/^\d{2,5}([/?#]|$)/.test(raw)) return `http://localhost:${raw}`;
  if (/^:\d{2,5}([/?#]|$)/.test(raw)) return `http://localhost${raw}`;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$|\?)/i.test(raw)) {
    return `http://${raw.replace(/^0\.0\.0\.0/, 'localhost')}`;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$|\?)/.test(raw)) return `http://${raw}`;
  // A dotted, space-free token is a hostname; everything else is a question.
  if (/^[^\s/?#]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(raw)) return `https://${raw}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
}

/** Drop the scheme and any trailing slash — an address bar, not a log line. */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function normalizeLevel(level: number | string): ConsoleLevel {
  if (typeof level === 'number') {
    return level >= 3 ? 'error' : level === 2 ? 'warning' : level === 1 ? 'info' : 'log';
  }
  const l = level.toLowerCase();
  if (l === 'error') return 'error';
  if (l === 'warning' || l === 'warn') return 'warning';
  if (l === 'debug' || l === 'verbose') return 'log';
  return 'info';
}

function makeTab(url = ''): BrowserTab {
  return {
    id: uid(),
    url,
    title: '',
    favicon: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    failure: null,
    logs: [],
    reloadSeq: 0,
  };
}

interface Persisted {
  tabs: { url: string; title: string }[];
  activeId: number;
  deviceId: string;
  landscape: boolean;
  recents: string[];
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function initialTabs(): { tabs: BrowserTab[]; activeTabId: string } {
  const saved = loadPersisted();
  const urls = saved?.tabs?.length
    ? saved.tabs
    : // Carry over the single URL the old iframe preview remembered, so
      // upgrading does not silently lose where you were pointed.
      [{ url: localStorage.getItem('eaon.previewUrl') ?? '', title: '' }];
  const tabs = urls.map((t) => ({ ...makeTab(t.url), title: t.title ?? '' }));
  if (!tabs.length) tabs.push(makeTab());
  const idx = Math.min(Math.max(saved?.activeId ?? 0, 0), tabs.length - 1);
  return { tabs, activeTabId: tabs[idx].id };
}

interface BrowserState {
  tabs: BrowserTab[];
  activeTabId: string;
  deviceId: string;
  /** Device presets are portrait; this swaps the axes. */
  landscape: boolean;
  showConsole: boolean;
  recents: string[];
  servers: DetectedServer[];
  scanning: boolean;

  active: () => BrowserTab | null;
  tab: (id: string) => BrowserTab | null;
  patch: (id: string, patch: Partial<BrowserTab>) => void;

  openTab: (url?: string, opts?: { background?: boolean }) => string;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  /** Send the active tab (or a named one) somewhere, normalising the input. */
  go: (input: string, tabId?: string) => void;

  /** Re-key the iframe fallback, which has no reload() of its own. */
  bumpReload: (id: string) => void;

  addLog: (id: string, raw: { level: number | string; message: string; sourceId?: string; line?: number }) => void;
  clearLogs: (id: string) => void;

  setDevice: (deviceId: string) => void;
  toggleLandscape: () => void;
  setShowConsole: (open: boolean) => void;

  scanServers: () => Promise<void>;
}

export const useBrowser = create<BrowserState>((set, get) => {
  const saved = loadPersisted();
  const { tabs, activeTabId } = initialTabs();

  const persist = () => {
    const s = get();
    const payload: Persisted = {
      tabs: s.tabs.map((t) => ({ url: t.url, title: t.title })),
      activeId: Math.max(0, s.tabs.findIndex((t) => t.id === s.activeTabId)),
      deviceId: s.deviceId,
      landscape: s.landscape,
      recents: s.recents,
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch {
      // A full or disabled localStorage costs us the session's tabs, nothing more.
    }
  };

  return {
    tabs,
    activeTabId,
    deviceId: saved?.deviceId ?? 'responsive',
    landscape: saved?.landscape ?? false,
    showConsole: false,
    recents: saved?.recents ?? [],
    servers: [],
    scanning: false,

    active: () => get().tabs.find((t) => t.id === get().activeTabId) ?? null,
    tab: (id) => get().tabs.find((t) => t.id === id) ?? null,

    patch: (id, patch) => {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
      if ('url' in patch || 'title' in patch) persist();
    },

    openTab: (url = '', opts) => {
      const tab = makeTab(url ? normalizeUrl(url) : '');
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: opts?.background ? s.activeTabId : tab.id,
      }));
      persist();
      return tab.id;
    },

    closeTab: (id) => {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        if (idx === -1) return s;
        const tabs = s.tabs.filter((t) => t.id !== id);
        // Never leave the panel with nothing in it — an empty browser has no
        // way back to a page except the start screen, so keep one open.
        if (!tabs.length) {
          const fresh = makeTab();
          return { tabs: [fresh], activeTabId: fresh.id };
        }
        const activeTabId =
          s.activeTabId === id ? tabs[Math.min(idx, tabs.length - 1)].id : s.activeTabId;
        return { tabs, activeTabId };
      });
      persist();
    },

    selectTab: (id) => {
      set({ activeTabId: id });
      persist();
    },

    go: (input, tabId) => {
      const id = tabId ?? get().activeTabId;
      const url = normalizeUrl(input);
      if (!url) return;
      get().patch(id, { failure: null, loading: true, logs: [] });
      navigateWebview(id, url);
      set((s) => ({
        // The address bar leads the page: a load that fails still has to show
        // what was asked for, or the retry button has nothing to retry.
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, url, reloadSeq: t.reloadSeq + 1 } : t)),
        recents: [url, ...s.recents.filter((r) => r !== url)].slice(0, RECENT_LIMIT),
      }));
      persist();
    },

    bumpReload: (id) =>
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, reloadSeq: t.reloadSeq + 1 } : t)),
      })),

    addLog: (id, raw) => {
      /* Electron injects its own dev-mode security advisories into every guest
         page. They are about this shell, not the product under test — counting
         them would put a CSP lecture in the problem badge and send an agent off
         to fix our window instead of their bug. */
      if (/^%cElectron Security Warning/.test(raw.message)) return;

      const entry: ConsoleEntry = {
        id: uid(),
        level: normalizeLevel(raw.level),
        message: raw.message,
        source: raw.sourceId,
        line: raw.line,
        at: Date.now(),
      };
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id ? { ...t, logs: [...t.logs, entry].slice(-LOG_LIMIT) } : t,
        ),
      }));
    },

    clearLogs: (id) => get().patch(id, { logs: [] }),

    setDevice: (deviceId) => {
      set({ deviceId });
      persist();
    },

    toggleLandscape: () => {
      set((s) => ({ landscape: !s.landscape }));
      persist();
    },

    setShowConsole: (open) => set({ showConsole: open }),

    scanServers: async () => {
      if (get().scanning) return;
      set({ scanning: true });
      try {
        const res = await api.get<{ servers: DetectedServer[] }>('/api/preview/servers');
        set({ servers: res.servers ?? [] });
      } catch {
        set({ servers: [] });
      } finally {
        set({ scanning: false });
      }
    },
  };
});

/** Errors and warnings only — what you would actually hand to an agent. */
export function problemsOf(tab: BrowserTab): ConsoleEntry[] {
  return tab.logs.filter((l) => l.level === 'error' || l.level === 'warning');
}
