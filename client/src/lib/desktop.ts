/**
 * The bridge the Electron preload exposes, in one typed place. The client also
 * builds for a plain browser tab, so everything the shell offers has to be
 * optional at the type level and absent at runtime without anything blowing up.
 */

export interface WindowState {
  focused: boolean;
  fullScreen: boolean;
}

/** What the update checker reports. Mirrors `publicState()` in updater.mjs. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';
  /** The version running right now. */
  current: string;
  autoCheck: boolean;
  lastCheckedAt: number | null;
  releasesUrl: string;
  /** 'notify' hands off a download; 'install' would swap in place. */
  installMode: 'notify' | 'install';
  /** Present when status === 'available'. */
  version?: string;
  notes?: string;
  publishedAt?: string | null;
  downloadUrl?: string;
  downloadName?: string | null;
  downloadSize?: number | null;
  pageUrl?: string;
  /** Present when status === 'error'. */
  message?: string;
  /** Present when status === 'up-to-date' and worth explaining. */
  note?: string;
}

export interface UpdatesBridge {
  check(opts?: { silent?: boolean }): Promise<UpdateState>;
  state(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  openPage(): Promise<UpdateState>;
  skip(): Promise<UpdateState>;
  dismiss(): Promise<UpdateState>;
  setAutoCheck(on: boolean): Promise<UpdateState>;
  onState(handler: (state: UpdateState) => void): () => void;
}

export interface DesktopBridge {
  isApp: true;
  platform: string;
  /** The packaged bundle's version — authoritative over any constant. */
  appVersion?: string | null;
  versions: { electron: string; node: string };
  /** True when the shell turned on the <webview> tag the browser panel needs. */
  webviewEnabled?: boolean;
  onWindowState(handler: (state: WindowState) => void): () => void;
  onMenuCommand(handler: (command: string) => void): () => void;
  /** A link an embedded page tried to open in a new window. */
  onBrowserOpenTab?(handler: (url: string) => void): () => void;
  /** Absent in the browser build, where there is nothing to update. */
  updates?: UpdatesBridge;
}

export const desktop: DesktopBridge | null =
  (window as unknown as { eaonDesktop?: DesktopBridge }).eaonDesktop ?? null;

export const inDesktopApp = !!desktop?.isApp;

/**
 * Whether the browser panel can run a real Chromium page rather than an
 * iframe. False in the browser-served build, where the panel degrades to an
 * iframe and says so.
 */
export const canEmbedBrowser = !!desktop?.webviewEnabled;
