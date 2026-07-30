import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('eaonDesktop', {
  isApp: true,
  platform: process.platform,
  /** The real bundle version, so About can't drift from what shipped. */
  appVersion: process.env.EAON_APP_VERSION || null,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },

  /**
   * Update checking. The app is unsigned, so this finds a new release and
   * hands off the download — it never replaces the running app itself.
   */
  updates: {
    check: (opts) => ipcRenderer.invoke('eaon:update-check', opts),
    state: () => ipcRenderer.invoke('eaon:update-state'),
    download: () => ipcRenderer.invoke('eaon:update-download'),
    openPage: () => ipcRenderer.invoke('eaon:update-open-page'),
    skip: () => ipcRenderer.invoke('eaon:update-skip'),
    dismiss: () => ipcRenderer.invoke('eaon:update-dismiss'),
    setAutoCheck: (on) => ipcRenderer.invoke('eaon:update-set-auto', on),
    /** Pushed whenever the check changes state. Returns an unsubscribe. */
    onState(handler) {
      const listener = (_event, state) => handler(state);
      ipcRenderer.on('eaon:update-state', listener);
      return () => ipcRenderer.off('eaon:update-state', listener);
    },
  },
  /**
   * The window enables the <webview> tag, so the browser panel can run a real
   * Chromium page. The browser-served build has no such thing and falls back
   * to an iframe — this is how it knows which one it is.
   */
  webviewEnabled: true,
  /**
   * Window-level state the renderer cannot observe on its own: whether the
   * window is focused and whether it is full screen. Returns an unsubscribe.
   */
  onWindowState(handler) {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('eaon:window-state', listener);
    return () => ipcRenderer.off('eaon:window-state', listener);
  },
  /** Commands chosen from the native menu bar. Returns an unsubscribe. */
  onMenuCommand(handler) {
    const listener = (_event, command) => handler(command);
    ipcRenderer.on('eaon:menu', listener);
    return () => ipcRenderer.off('eaon:menu', listener);
  },
  /**
   * A URL a page in the browser panel tried to open in a new window. The main
   * process denies the window and forwards the URL here so it becomes a tab.
   * Returns an unsubscribe.
   */
  onBrowserOpenTab(handler) {
    const listener = (_event, url) => handler(url);
    ipcRenderer.on('eaon:browser-open-tab', listener);
    return () => ipcRenderer.off('eaon:browser-open-tab', listener);
  },
});
