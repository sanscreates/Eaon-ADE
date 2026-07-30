import { app, BrowserWindow, Menu, nativeImage, session, shell } from 'electron';
import { registerUpdater, checkForUpdatesFromMenu } from './updater.mjs';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const APP_URL = `http://127.0.0.1:${PORT}`;

const isPackaged = app.isPackaged;
const appRoot = isPackaged
  ? path.join(process.resourcesPath, 'app.asar')
  : path.join(__dirname, '..');

/**
 * The browser panel runs pages in this session, kept apart from the ADE's own
 * so a login you do while testing never touches — and is never confused with
 * — the app's storage. `persist:` means it survives a quit, which is the
 * point: signing back in on every launch is why people go to Chrome instead.
 */
const BROWSER_PARTITION = 'persist:eaon-browser';

/** @type {import('node:child_process').ChildProcess | null} */
let serverProcess = null;
let quitting = false;

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function startServer() {
  if (await portOpen(PORT)) {
    console.log('[eaon] reusing server already on :' + PORT);
    return;
  }

  if (isPackaged) {
    // Packaged: run the bundled server in the main process. node-pty is
    // rebuilt against Electron by electron-builder during packaging.
    process.env.NODE_ENV = 'production';
    const entry = path.join(appRoot, 'server', 'dist', 'index.js');
    await import(pathToFileURL(entry).href);
    console.log('[eaon] server started in-process');
    return;
  }

  // Dev: run the server with the system Node so node-pty's prebuilt
  // binaries (built for system Node's ABI) load correctly.
  const nodeBin = process.env.EAON_NODE || 'node';
  const entry = path.join(appRoot, 'server', 'dist', 'index.js');
  serverProcess = spawn(nodeBin, [entry], {
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!quitting) console.log('[eaon] server exited with code', code);
  });
  console.log('[eaon] server spawned (pid ' + serverProcess.pid + ')');
}

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await portOpen(PORT)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Eaon ADE',
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    // y centres the 12px lights in the 44px topbar (--h-topbar in styles.css).
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // Lets the browser panel host a real Chromium page instead of an
      // iframe. An iframe cannot go back, cannot open devtools, and is turned
      // away by anything that sends X-Frame-Options — which is most of what
      // you hit the moment your product has a login.
      webviewTag: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Feed window state to the renderer so the chrome can recede when the
  // window is not focused, and reclaim the traffic-light gutter in full
  // screen. A browser tab has no way to know either of these.
  const pushWindowState = () => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('eaon:window-state', {
      focused: win.isFocused(),
      fullScreen: win.isFullScreen(),
    });
  };
  for (const event of ['focus', 'blur', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, pushWindowState);
  }
  win.webContents.on('did-finish-load', pushWindowState);

  // Open target=_blank links in the system browser, not new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(APP_URL);
  return win;
}

/** localhost in any of its spellings — "the thing the user is building". */
function isLocalOrigin(url) {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1'
    );
  } catch {
    return false;
  }
}

/**
 * Anything an embedded page tries to open. http(s) becomes a tab in our own
 * browser — a page that pops a window during a test should stay inside the
 * app. mailto: and friends go to the OS. Everything else is dropped rather
 * than handed to whatever has registered that protocol.
 */
function routeGuestUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send('eaon:browser-open-tab', url);
    }
    return;
  }
  if (/^(mailto|tel|sms|facetime):/i.test(url)) shell.openExternal(url);
}

function wireGuestPages() {
  /* Permissions, for pages we did not write. Your own dev server gets
     whatever it asks for — you are testing a camera feature, you should be
     able to test it here. The open web gets nothing, silently: this window
     also owns your terminals. */
  const guest = session.fromPartition(BROWSER_PARTITION);
  guest.setPermissionRequestHandler((contents, _permission, callback) => {
    callback(isLocalOrigin(contents.getURL()));
  });
  guest.setPermissionCheckHandler((_contents, _permission, origin) => isLocalOrigin(origin));

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      routeGuestUrl(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (/^(https?|about|blob|data):/i.test(url)) return;
      event.preventDefault();
      routeGuestUrl(url);
    });
  });
}

/** Fire a command in the renderer from a menu item. */
function send(command) {
  return () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (win && !win.webContents.isDestroyed()) win.webContents.send('eaon:menu', command);
  };
}

function buildMenu() {
  const paneTemplates = [1, 2, 4, 6, 8, 9, 12, 16].map((n) => ({
    label: `${n} ${n === 1 ? 'Pane' : 'Panes'}`,
    click: send(`layout:${n}`),
  }));

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => void checkForUpdatesFromMenu() },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: send('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    // Every command the UI offers should also be findable in the menu bar —
    // that discoverability is most of what separates an app from a web page.
    {
      label: 'File',
      submenu: [
        { label: 'New Agent Session…', accelerator: 'Alt+T', click: send('new-session') },
        { label: 'New Git Worktree…', click: send('new-worktree') },
        { type: 'separator' },
        { label: 'Add Project…', click: send('add-project') },
        { type: 'separator' },
        { label: 'Close Pane', accelerator: 'Alt+W', click: send('close-pane') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CommandOrControl+K', click: send('palette') },
        { label: 'Toggle Sidebar', accelerator: 'CommandOrControl+B', click: send('sidebar') },
        { type: 'separator' },
        { label: 'Board', accelerator: 'Alt+1', click: send('panel:board') },
        { label: 'Files', accelerator: 'Alt+2', click: send('panel:files') },
        { label: 'Editor', accelerator: 'Alt+3', click: send('panel:editor') },
        { label: 'Git', accelerator: 'Alt+4', click: send('panel:git') },
        { label: 'Pull Requests', accelerator: 'Alt+5', click: send('panel:pulls') },
        { label: 'Browser', accelerator: 'Alt+6', click: send('panel:preview') },
        { label: 'Swarm', accelerator: 'Alt+7', click: send('panel:swarm') },
        { label: 'Memory', accelerator: 'Alt+8', click: send('panel:memory') },
        { type: 'separator' },
        // Terminal font size, not page zoom: rescaling the page throws off
        // xterm's glyph metrics and the fit addon's column maths.
        {
          label: 'Bigger Terminal Text',
          accelerator: 'CommandOrControl+Plus',
          click: send('font:up'),
        },
        {
          label: 'Smaller Terminal Text',
          accelerator: 'CommandOrControl+-',
          click: send('font:down'),
        },
        {
          label: 'Default Terminal Text',
          accelerator: 'CommandOrControl+0',
          click: send('font:reset'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Pane',
      submenu: [
        { label: 'Split Right', accelerator: 'CommandOrControl+\\', click: send('split-right') },
        {
          label: 'Split Down',
          accelerator: 'CommandOrControl+Shift+\\',
          click: send('split-down'),
        },
        { type: 'separator' },
        { label: 'Layout', submenu: paneTemplates },
      ],
    },
    // Only the panel toggle takes an accelerator. The obvious browser keys —
    // ⌘[, ⌘], ⌥← — are keys a shell or an agent CLI may want, and a menu
    // accelerator swallows the keystroke before the terminal ever sees it.
    {
      label: 'Browser',
      submenu: [
        { label: 'Show Browser', accelerator: 'Alt+6', click: send('panel:preview') },
        { label: 'New Tab', click: send('browser:new-tab') },
        { type: 'separator' },
        { label: 'Back', click: send('browser:back') },
        { label: 'Forward', click: send('browser:forward') },
        {
          label: 'Reload Page',
          accelerator: 'CommandOrControl+Shift+R',
          click: send('browser:reload'),
        },
        { label: 'Reload Ignoring Cache', click: send('browser:hard-reload') },
        { type: 'separator' },
        { label: 'Scan for Dev Servers', click: send('browser:scan') },
        { label: 'Toggle Page Console', click: send('browser:console') },
        { label: 'Page DevTools', click: send('browser:devtools') },
        { type: 'separator' },
        { label: 'Open in Default Browser', click: send('browser:external') },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setName('Eaon ADE');
    // Renderer processes inherit this, which is how preload reports the real
    // bundle version without a round trip before the first paint.
    process.env.EAON_APP_VERSION = app.getVersion();
    // Dev runs don't get the packaged icns; put the brand tile in the Dock
    // directly. Packaged builds skip this — their icon comes from the bundle.
    if (!isPackaged) {
      const iconPath = path.join(appRoot, 'build', 'ade-icon-src.png');
      if (existsSync(iconPath)) app.dock?.setIcon(nativeImage.createFromPath(iconPath));
    }
    buildMenu();
    wireGuestPages();
    // Before the window exists: the renderer asks for update state as it
    // mounts, and the handler has to already be there to answer.
    registerUpdater();

    try {
      await startServer();
    } catch (err) {
      console.error('[eaon] failed to start server:', err);
    }

    const up = await waitForServer();
    if (!up) {
      console.error('[eaon] server did not come up in time; opening window anyway');
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    }
  });
}
