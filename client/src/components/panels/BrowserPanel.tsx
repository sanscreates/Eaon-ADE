import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEVICES,
  problemsOf,
  prettyUrl,
  useBrowser,
  type BrowserTab,
  type ConsoleEntry,
} from '../../store/browser';
import { useUi } from '../../store/ui';
import { useWorkspaces } from '../../store/workspaces';
import { canEmbedBrowser, desktop } from '../../lib/desktop';
import { sendToActiveAgent } from '../../lib/spawn';
import { markAttached, readHistory, registerWebview, webviewOps } from '../../lib/webviews';
import { cls } from '../../lib/utils';
import type {
  WebviewConsoleEvent,
  WebviewFailLoadEvent,
  WebviewFaviconEvent,
  WebviewNavigateEvent,
  WebviewTag,
  WebviewTitleEvent,
} from '../../lib/webview';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBug,
  IconCode,
  IconExternal,
  IconGlobe,
  IconRefresh,
  IconRotate,
  IconSmartphone,
  IconTerminal,
  IconTrash,
  IconX,
} from '../Icons';

/**
 * Pages run in one persistent session of their own, so a login you do while
 * testing survives closing the panel and quitting the app — and stays out of
 * the ADE's own cookie jar.
 */
const PARTITION = 'persist:eaon-browser';

/**
 * Present as a plain Chrome. Plenty of sites degrade themselves the moment
 * they see "Electron" in the UA, which is not a bug worth debugging while you
 * are trying to debug your own product.
 */
const GUEST_UA = navigator.userAgent
  .replace(/\s*Electron\/[^\s]+/i, '')
  .replace(/\s*Eaon[ -]?ADE\/[^\s]+/i, '')
  .trim();

/**
 * Renders exactly one browser-store tab, full-bleed. The workspace tab strip
 * at the top of the window is the only tab strip in the app now — this used
 * to keep its own second one (`TabStrip` below, now unused), which would
 * have meant two rows of tabs stacked on top of each other for what is,
 * from the outside, one browser page.
 */
export function BrowserPanel({ tabId }: { tabId: string }) {
  const deviceId = useBrowser((s) => s.deviceId);
  const landscape = useBrowser((s) => s.landscape);
  const showConsole = useBrowser((s) => s.showConsole);
  const active = useBrowser((s) => s.tab(tabId));

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  // Scan for dev servers when the panel opens: the answer to "which port is
  // it on this time" should already be on screen.
  useEffect(() => {
    useBrowser.getState().scanServers();
  }, []);

  // A page that calls window.open gets its own top-level tab, not a second
  // tab hidden inside this one — routed through the workspace layer so the
  // new tab shows up in the one tab strip the app has.
  useEffect(
    () => desktop?.onBrowserOpenTab?.((url) => useWorkspaces.getState().openBrowserTab(url)),
    [],
  );

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[0];
  const emulating = device.width > 0;
  const dw = emulating && landscape ? device.height : device.width;
  const dh = emulating && landscape ? device.width : device.height;
  // Shrink to fit rather than clip: a 1512px desktop frame inside a 600px
  // panel is only useful if you can see all of it at once.
  const scale =
    emulating && stage.w > 0 ? Math.min(1, (stage.w - 24) / dw, (stage.h - 24) / dh) : 1;

  if (!active) return null;

  return (
    <div className="browser-panel">
      <Toolbar tab={active} />
      <div className="br-stage" ref={stageRef}>
        <div
          className={cls('br-page', 'br-page-on', emulating && 'br-page-device')}
          style={emulating ? { width: dw, height: dh, transform: scale < 1 ? `scale(${scale})` : undefined } : undefined}
        >
          <TabView tab={active} />
        </div>
        {emulating && (
          <div className="br-device-badge">
            {dw} × {dh}
            {scale < 1 && ` · ${Math.round(scale * 100)}%`}
          </div>
        )}
      </div>
      {showConsole && <ConsoleDrawer tab={active} />}
    </div>
  );
}

/* ── toolbar ──────────────────────────────────────────────────────────── */

function Toolbar({ tab }: { tab: BrowserTab | undefined }) {
  const go = useBrowser((s) => s.go);
  const showConsole = useBrowser((s) => s.showConsole);
  const setShowConsole = useBrowser((s) => s.setShowConsole);
  const [value, setValue] = useState(tab?.url ?? '');
  const focusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow the page, but never yank the text out from under someone typing.
  useEffect(() => {
    if (!focusedRef.current) setValue(tab?.url ?? '');
  }, [tab?.id, tab?.url]);

  if (!tab) return null;

  const problems = problemsOf(tab).length;

  return (
    <div className="panel-toolbar br-toolbar">
      <button
        className="icon-btn"
        title="Back"
        disabled={!tab.canGoBack}
        onClick={() => webviewOps.back(tab.id)}
      >
        <IconArrowLeft size={14} />
      </button>
      <button
        className="icon-btn"
        title="Forward"
        disabled={!tab.canGoForward}
        onClick={() => webviewOps.forward(tab.id)}
      >
        <IconArrowRight size={14} />
      </button>
      <button
        className="icon-btn"
        title={tab.loading ? 'Stop' : 'Reload (hold ⇧ to bypass cache)'}
        disabled={!tab.url}
        onClick={(e) => {
          if (!canEmbedBrowser) return useBrowser.getState().bumpReload(tab.id);
          if (tab.loading) webviewOps.stop(tab.id);
          else if (e.shiftKey) webviewOps.hardReload(tab.id);
          else webviewOps.reload(tab.id);
        }}
      >
        {tab.loading ? <IconX size={13} /> : <IconRefresh size={13} />}
      </button>

      <input
        ref={inputRef}
        className="br-url"
        value={value}
        placeholder="localhost:3000, a port, or a search"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => {
          focusedRef.current = true;
          inputRef.current?.select();
        }}
        onBlur={() => {
          focusedRef.current = false;
          setValue(tab.url);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            go(value, tab.id);
            inputRef.current?.blur();
          } else if (e.key === 'Escape') {
            setValue(tab.url);
            inputRef.current?.blur();
          }
        }}
      />

      <DeviceMenu />

      <button
        className={cls('icon-btn', showConsole && 'icon-btn-on', problems > 0 && 'br-has-problems')}
        title={problems ? `Console — ${problems} problem${problems === 1 ? '' : 's'}` : 'Console'}
        onClick={() => setShowConsole(!showConsole)}
      >
        <IconBug size={13} />
        {problems > 0 && <span className="br-badge">{problems > 99 ? '99+' : problems}</span>}
      </button>
      <button
        className="icon-btn"
        title={canEmbedBrowser ? 'Page DevTools' : 'DevTools need the desktop app'}
        disabled={!canEmbedBrowser}
        onClick={() => webviewOps.devTools(tab.id)}
      >
        <IconCode size={13} />
      </button>
      <button
        className="icon-btn"
        title="Open in your default browser"
        disabled={!tab.url}
        onClick={() => window.open(tab.url, '_blank')}
      >
        <IconExternal size={13} />
      </button>
    </div>
  );
}

function DeviceMenu() {
  const deviceId = useBrowser((s) => s.deviceId);
  const landscape = useBrowser((s) => s.landscape);
  const setDevice = useBrowser((s) => s.setDevice);
  const toggleLandscape = useBrowser((s) => s.toggleLandscape);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[0];

  return (
    <div className="br-device-menu" ref={ref}>
      <button
        className={cls('icon-btn', device.width > 0 && 'icon-btn-on')}
        title={`Viewport — ${device.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <IconSmartphone size={13} />
      </button>
      {open && (
        <div className="dropdown br-device-dropdown">
          <div className="dropdown-label">Viewport</div>
          {DEVICES.map((d) => (
            <button
              key={d.id}
              className={cls('dropdown-item', d.id === deviceId && 'dropdown-item-on')}
              onClick={() => {
                setDevice(d.id);
                setOpen(false);
              }}
            >
              <span>{d.label}</span>
              {d.width > 0 && (
                <span className="br-device-dims">
                  {d.width}×{d.height}
                </span>
              )}
            </button>
          ))}
          <button
            className="dropdown-item"
            disabled={device.width === 0}
            onClick={() => toggleLandscape()}
          >
            <IconRotate size={12} />
            <span>{landscape ? 'Portrait' : 'Landscape'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ── the page itself ──────────────────────────────────────────────────── */

/**
 * The webview is mounted only once the tab has somewhere to go. That is not a
 * cosmetic choice: the element captures its `src` on mount and never takes it
 * again, so mounting it against an empty start-page tab would leave a live
 * guest process parked on about:blank that no later navigation could reach.
 */
function TabView({ tab }: { tab: BrowserTab }) {
  if (!tab.url) return <StartPage tabId={tab.id} />;

  if (!canEmbedBrowser) {
    // Browser-served build: no Chromium of our own to embed, so this is a
    // plain iframe and inherits every X-Frame-Options refusal that implies.
    return (
      <iframe
        key={`${tab.url}#${tab.reloadSeq}`}
        className="br-frame"
        src={tab.url}
        title={tab.title || 'Page'}
      />
    );
  }

  return (
    <>
      <PageView tab={tab} />
      {/* Layered over the page rather than replacing it, so a failed load
          does not destroy the guest and take the back history with it. */}
      {tab.failure && <FailurePage tab={tab} />}
    </>
  );
}

function PageView({ tab }: { tab: BrowserTab }) {
  const patch = useBrowser((s) => s.patch);
  const addLog = useBrowser((s) => s.addLog);
  const ref = useRef<WebviewTag | null>(null);
  // Set once. Re-applying src on every render would re-navigate the page out
  // from under any link the user followed inside it.
  const [initialSrc] = useState(tab.url);

  const syncHistory = useCallback(() => {
    patch(tab.id, readHistory(tab.id));
  }, [patch, tab.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerWebview(tab.id, el);

    // `dom-ready` too, not just `did-attach`: the attach event is the one that
    // would be missed if the guest beat this effect to it, and marking twice
    // is free.
    const onAttach = () => markAttached(tab.id);
    const onStart = () => patch(tab.id, { loading: true });
    const onStop = () => {
      patch(tab.id, { loading: false, title: el.getTitle() || '' });
      syncHistory();
    };
    const onNavigate = (e: Event) => {
      const { url } = e as WebviewNavigateEvent;
      // Same rule as a browser with "preserve log" off: a new document gets a
      // new console, so the problems you are looking at are this page's.
      patch(tab.id, { url, failure: null, logs: [], favicon: null });
      syncHistory();
    };
    const onNavigateInPage = (e: Event) => {
      const ev = e as WebviewNavigateEvent;
      if (ev.isMainFrame === false) return;
      patch(tab.id, { url: ev.url });
      syncHistory();
    };
    const onTitle = (e: Event) => patch(tab.id, { title: (e as WebviewTitleEvent).title });
    const onFavicon = (e: Event) => {
      const icons = (e as WebviewFaviconEvent).favicons;
      if (icons?.length) patch(tab.id, { favicon: icons[0] });
    };
    const onFail = (e: Event) => {
      const ev = e as WebviewFailLoadEvent;
      // -3 is ERR_ABORTED: a load the user or the page replaced on purpose.
      if (!ev.isMainFrame || ev.errorCode === -3) return;
      patch(tab.id, {
        loading: false,
        failure: {
          code: ev.errorCode,
          description: ev.errorDescription,
          url: ev.validatedURL || tab.url,
        },
      });
    };
    const onConsole = (e: Event) => {
      const ev = e as WebviewConsoleEvent;
      addLog(tab.id, {
        level: ev.level,
        message: ev.message,
        sourceId: ev.sourceId,
        line: ev.line,
      });
    };
    const onCrash = () => {
      patch(tab.id, {
        loading: false,
        failure: { code: 0, description: 'The page crashed', url: tab.url },
      });
    };
    const onNewWindow = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      // A page opening a popup gets its own top-level tab, same as any other
      // "new browser tab" — not a second tab hidden inside this one.
      if (url) useWorkspaces.getState().openBrowserTab(url);
    };

    el.addEventListener('did-attach', onAttach);
    el.addEventListener('dom-ready', onAttach);
    el.addEventListener('did-start-loading', onStart);
    el.addEventListener('did-stop-loading', onStop);
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigateInPage);
    el.addEventListener('page-title-updated', onTitle);
    el.addEventListener('page-favicon-updated', onFavicon);
    el.addEventListener('did-fail-load', onFail);
    el.addEventListener('console-message', onConsole);
    el.addEventListener('render-process-gone', onCrash);
    el.addEventListener('new-window', onNewWindow);

    return () => {
      el.removeEventListener('did-attach', onAttach);
      el.removeEventListener('dom-ready', onAttach);
      el.removeEventListener('did-start-loading', onStart);
      el.removeEventListener('did-stop-loading', onStop);
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigateInPage);
      el.removeEventListener('page-title-updated', onTitle);
      el.removeEventListener('page-favicon-updated', onFavicon);
      el.removeEventListener('did-fail-load', onFail);
      el.removeEventListener('console-message', onConsole);
      el.removeEventListener('render-process-gone', onCrash);
      el.removeEventListener('new-window', onNewWindow);
      registerWebview(tab.id, null);
    };
  }, [tab.id, patch, addLog, syncHistory]);

  return (
    <webview
      // React types the element as an inert HTMLWebViewElement; the methods
      // and events the panel uses arrive at runtime, so the ref is widened
      // here in the one place that touches the DOM node.
      ref={(el: HTMLElement | null) => {
        ref.current = el as WebviewTag | null;
      }}
      src={initialSrc}
      partition={PARTITION}
      allowpopups
      useragent={GUEST_UA}
    />
  );
}

/* ── start page, failures, console ────────────────────────────────────── */

function StartPage({ tabId }: { tabId: string }) {
  const servers = useBrowser((s) => s.servers);
  const scanning = useBrowser((s) => s.scanning);
  const recents = useBrowser((s) => s.recents);
  const go = useBrowser((s) => s.go);

  return (
    <div className="br-start">
      <div className="br-start-head">
        <IconGlobe size={22} />
        <h3>Test your product here</h3>
        <p>
          {canEmbedBrowser
            ? 'A real Chromium page with its own devtools and its own logged-in session.'
            : 'Running in a browser tab, so this pane is an iframe — open the desktop app for the full browser.'}
        </p>
      </div>

      <div className="br-start-section">
        <div className="br-start-label">
          <span>Running on this machine</span>
          <button
            className="icon-btn"
            title="Scan again"
            onClick={() => useBrowser.getState().scanServers()}
          >
            <IconRefresh size={12} />
          </button>
        </div>
        {scanning && !servers.length && <div className="br-start-empty">Scanning ports…</div>}
        {!scanning && !servers.length && (
          <div className="br-start-empty">
            No dev server found. Start one in a pane, then scan again.
          </div>
        )}
        <div className="br-server-list">
          {servers.map((s) => (
            <button key={s.port} className="br-server" onClick={() => go(s.url, tabId)}>
              <span className="br-server-port">:{s.port}</span>
              <span className="br-server-title">{s.title || s.url}</span>
            </button>
          ))}
        </div>
      </div>

      {recents.length > 0 && (
        <div className="br-start-section">
          <div className="br-start-label">
            <span>Recent</span>
          </div>
          <div className="br-recent-list">
            {recents.map((url) => (
              <button key={url} className="chip" onClick={() => go(url, tabId)}>
                {prettyUrl(url)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FailurePage({ tab }: { tab: BrowserTab }) {
  const go = useBrowser((s) => s.go);
  const scanServers = useBrowser((s) => s.scanServers);
  const refused = tab.failure?.description === 'ERR_CONNECTION_REFUSED';

  return (
    <div className="br-failure">
      <h3>{refused ? 'Nothing is listening there' : "This page didn't load"}</h3>
      <code>{tab.failure?.description}</code>
      <p className="br-failure-url">{tab.url}</p>
      {refused && (
        <p className="br-failure-hint">
          Start the dev server in one of your panes, then retry — or scan for one that is
          already up.
        </p>
      )}
      <div className="br-failure-actions">
        <button className="btn btn-sm btn-accent" onClick={() => go(tab.url, tab.id)}>
          <IconRefresh size={12} /> Retry
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            scanServers();
            useBrowser.getState().patch(tab.id, { url: '', failure: null });
          }}
        >
          Find a dev server
        </button>
      </div>
    </div>
  );
}

function ConsoleDrawer({ tab }: { tab: BrowserTab }) {
  const clearLogs = useBrowser((s) => s.clearLogs);
  const setShowConsole = useBrowser((s) => s.setShowConsole);
  const toast = useUi((s) => s.toast);
  const [errorsOnly, setErrorsOnly] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(
    () => (errorsOnly ? problemsOf(tab) : tab.logs),
    [tab.logs, errorsOnly],
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const problems = problemsOf(tab);

  const handOff = () => {
    if (!problems.length) {
      toast('No errors or warnings on this page', 'info');
      return;
    }
    const sent = sendToActiveAgent(promptFor(tab.url, problems));
    if (sent) toast(`Sent ${problems.length} browser problem(s) to the focused agent`, 'success');
    else toast('Focus an agent pane first — that is where the prompt goes', 'error');
  };

  return (
    <div className="br-console">
      <div className="br-console-bar">
        <span className="br-console-title">
          Console
          {problems.length > 0 && <em>{problems.length} problem{problems.length === 1 ? '' : 's'}</em>}
        </span>
        <button
          className={cls('chip', errorsOnly && 'chip-on')}
          onClick={() => setErrorsOnly((v) => !v)}
        >
          {errorsOnly ? 'Problems' : 'All'}
        </button>
        <button className="btn btn-sm" onClick={handOff} title="Type these errors into the focused agent pane">
          <IconTerminal size={12} /> Send to agent
        </button>
        <button className="icon-btn" title="Clear" onClick={() => clearLogs(tab.id)}>
          <IconTrash size={12} />
        </button>
        <button className="icon-btn" title="Hide console" onClick={() => setShowConsole(false)}>
          <IconX size={12} />
        </button>
      </div>
      <div className="br-console-list" ref={listRef}>
        {!shown.length && (
          <div className="br-console-empty">
            {errorsOnly ? 'No errors or warnings.' : 'Nothing logged yet.'}
          </div>
        )}
        {shown.map((entry) => (
          <div key={entry.id} className={cls('br-log', `br-log-${entry.level}`)}>
            <span className="br-log-msg">{entry.message}</span>
            {entry.source && (
              <span className="br-log-src">
                {shortSource(entry.source)}
                {entry.line ? `:${entry.line}` : ''}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function shortSource(source: string): string {
  try {
    return new URL(source).pathname.split('/').filter(Boolean).pop() ?? source;
  } catch {
    return source.split('/').pop() ?? source;
  }
}

/**
 * One line, because spawnSession's rule applies here too: a CLI reads the
 * first newline as "submit", so a multi-line prompt would run as several
 * commands. Numbered items keep it readable anyway.
 */
function promptFor(url: string, problems: ConsoleEntry[]): string {
  const items = problems
    .slice(-15)
    .map((p, i) => {
      const where = p.source ? ` (${shortSource(p.source)}${p.line ? `:${p.line}` : ''})` : '';
      return `${i + 1}. [${p.level}] ${p.message.replace(/\s+/g, ' ').slice(0, 300)}${where}`;
    })
    .join('  ');
  return `The page at ${url} is reporting these browser console problems — find the cause in this repo and fix it: ${items}`;
}
