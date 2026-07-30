import type { WebviewTag } from './webview';

/**
 * The live <webview> elements, keyed by browser tab id — the same shape as
 * terminals.ts holds xterm instances. A webview is an imperative object with
 * its own process behind it; keeping the elements out of React state means a
 * re-render can never tear one down and lose the page you were testing.
 */
const views = new Map<string, WebviewTag>();

/**
 * A webview rejects every method call until it has attached to the embedder.
 * Navigations asked for before then are held here and flushed on `did-attach`.
 */
const attached = new Set<string>();
const queued = new Map<string, string>();

export function registerWebview(id: string, el: WebviewTag | null): void {
  if (el) {
    views.set(id, el);
    return;
  }
  views.delete(id);
  attached.delete(id);
  queued.delete(id);
}

export function markAttached(id: string): void {
  attached.add(id);
  const pending = queued.get(id);
  if (pending) {
    queued.delete(id);
    navigateWebview(id, pending);
  }
}

export function navigateWebview(id: string, url: string): void {
  const el = views.get(id);
  if (!el) return;
  if (!attached.has(id)) {
    queued.set(id, url);
    return;
  }
  // Rejects on any aborted or failed load; `did-fail-load` is where those are
  // reported to the user, so the promise itself is noise.
  el.loadURL(url).catch(() => {});
}

/** Run an imperative call against a tab's page, or do nothing if it is not up yet. */
function withView(id: string, fn: (el: WebviewTag) => void): void {
  const el = views.get(id);
  if (!el || !attached.has(id)) return;
  try {
    fn(el);
  } catch {
    // A page that is mid-teardown throws on every method; nothing to recover.
  }
}

export const webviewOps = {
  back: (id: string) => withView(id, (el) => el.goBack()),
  forward: (id: string) => withView(id, (el) => el.goForward()),
  reload: (id: string) => withView(id, (el) => el.reload()),
  hardReload: (id: string) => withView(id, (el) => el.reloadIgnoringCache()),
  stop: (id: string) => withView(id, (el) => el.stop()),
  devTools: (id: string) =>
    withView(id, (el) => (el.isDevToolsOpened() ? el.closeDevTools() : el.openDevTools())),
  focus: (id: string) => withView(id, (el) => el.focus()),
};

/** Read history state straight off the page — only safe once it has attached. */
export function readHistory(id: string): { canGoBack: boolean; canGoForward: boolean } {
  const el = views.get(id);
  if (!el || !attached.has(id)) return { canGoBack: false, canGoForward: false };
  try {
    return { canGoBack: el.canGoBack(), canGoForward: el.canGoForward() };
  } catch {
    return { canGoBack: false, canGoForward: false };
  }
}

export function isWebviewAttached(id: string): boolean {
  return attached.has(id);
}
