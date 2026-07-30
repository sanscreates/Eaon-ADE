/**
 * Typings for Electron's <webview> tag — the element the browser panel runs a
 * real Chromium page in.
 *
 * React already declares the *element* (`JSX.IntrinsicElements.webview`, as an
 * inert `HTMLWebViewElement`), so what is missing is only the behaviour: the
 * methods and events the guest page exposes. Those are hand-rolled here rather
 * than taken from Electron's own types on purpose — the client also builds for
 * a plain browser tab, where none of this exists at runtime, and pulling
 * Electron into the web build's types would claim otherwise. Only the members
 * the panel actually calls are declared, so an accidental reach for something
 * unsupported fails at compile time.
 */

export interface WebviewTag extends HTMLElement {
  src: string;
  loadURL(url: string, options?: { userAgent?: string; httpReferrer?: string }): Promise<void>;
  getURL(): string;
  getTitle(): string;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  clearHistory(): void;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  setZoomFactor(factor: number): void;
  setZoomLevel(level: number): void;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  insertCSS(css: string): Promise<string>;
  getWebContentsId(): number;
}

/** `did-navigate`, and `did-navigate-in-page` with the extra frame flag. */
export interface WebviewNavigateEvent extends Event {
  url: string;
  isMainFrame?: boolean;
}

export interface WebviewFailLoadEvent extends Event {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
  isMainFrame: boolean;
}

export interface WebviewTitleEvent extends Event {
  title: string;
  explicitSet: boolean;
}

export interface WebviewFaviconEvent extends Event {
  favicons: string[];
}

/**
 * `level` is a string on current Electron and a number on older builds
 * (0 verbose, 1 info, 2 warning, 3 error). Both shapes are declared because
 * the panel normalises whichever it is handed.
 */
export interface WebviewConsoleEvent extends Event {
  level: number | string;
  message: string;
  line: number;
  sourceId: string;
}
