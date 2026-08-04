import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { PtyManager } from './pty-manager'
import { Store } from './store'
import * as fsapi from './fsapi'
import * as git from './git'
import { launchCommand, listResumable, sessionCountFor } from './sessions'
import { PaneSessions } from './pane-sessions'
import { SessionWatch } from './session-watch'
import { collectStats } from './stats'
import { anthropicUsage, localUsage, resetUsageCache } from './usage'
import * as browser from './browser'
import * as models from './stt/models'
import * as speech from './speech'
import { SttHost } from './stt/host'
import { Updater } from './updater'
import { BrainStore } from './brain/store'
import { isRegistered, registerWorkspace } from './brain/register'
import { getTheme } from '../shared/themes'
import { STT_MODELS } from '../shared/stt'
import { AGENTS, type PersistedState, type SpawnRequest } from '../shared/types'

const run = promisify(execFile)

let mainWindow: BrowserWindow | null = null
let store: Store
/** What each pane was last seen running, so it can be reopened. */
let paneSessions: PaneSessions
let sessionWatch: SessionWatch
const ptys = new PtyManager()
const stt = new SttHost()
const updater = new Updater()
const brain = new BrainStore()

// Set before the app is ready so the user-data folder is ours alone and never
// collides with another project that happens to share the package name.
//
// The unpackaged build takes a different name, and so a different folder. Both
// builds otherwise land on the same state.json — which holds your workspaces,
// panes and settings — and the last one to write it wins. That is how a
// development instance run alongside the installed app silently ate the user's
// open workspaces. Neither --user-data-dir nor a redirected HOME prevents it:
// this path is set explicitly, and macOS resolves appData through the OS.
const APP_NAME = app.isPackaged ? 'Eaon ADE' : 'Eaon ADE (dev)'
app.setName(APP_NAME)
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME))

// Each terminal draws on its own GPU context. The browser default caps live
// contexts at 16 and silently drops the oldest past that, which would blank a
// pane in a twelve-up grid.
app.commandLine.appendSwitch('max-active-webgl-contexts', '32')

/**
 * Chords the preview panel owns, by the key that produces them.
 *
 * Only these are taken from a page. Everything else a web app binds to the
 * Command key — and editors on the web bind a great many — is left alone.
 */
const BROWSER_CHORDS: Record<string, string> = {
  l: 'address',
  r: 'reload',
  f: 'find',
  '[': 'back',
  ']': 'forward',
  arrowleft: 'back',
  arrowright: 'forward',
  '=': 'zoom-in',
  '+': 'zoom-in',
  '-': 'zoom-out',
  '0': 'zoom-reset'
}

function createWindow(): BrowserWindow {
  // Paint the window in the saved theme's backdrop so a cold start does not
  // flash the wrong colour before the renderer boots.
  const theme = getTheme(store?.load().settings.themeId)

  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: theme.tokens.ink000,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : { color: theme.tokens.ink100, symbolColor: theme.tokens.textMid, height: 44 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // The preview panel embeds a <webview>. It is the only element that
      // renders somebody else's page, and it is locked down below.
      webviewTag: true
    }
  })

  win.on('ready-to-show', () => win.show())

  /*
   * Everything the preview panel loads is untrusted by definition — it is the
   * open web, plus whatever a dev server happens to be serving. The guest is
   * stripped back to an ordinary sandboxed page before it is allowed to attach:
   * no Node, no preload of ours, no reaching back into the app.
   */
  win.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    params.allowpopups = 'false'
  })

  win.webContents.on('did-attach-webview', (_e, guest) => {
    /*
     * A link asking for a new window gets this one.
     *
     * Sending them to the user's real browser used to be the only sensible
     * answer, because the panel had no address bar and no history — a page
     * opened there would have been a dead end. It has both now, so opening in
     * place is both what a browser does and what keeps you inside the preview
     * you were testing.
     */
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void guest.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })

    /*
     * Browser shortcuts pressed while the page has focus.
     *
     * Keystrokes inside a <webview> are delivered to the guest's own process
     * and never reach our renderer, so ⌘L would open the address bar right up
     * until you clicked the page and then silently stop. Catching them here,
     * before the guest sees them, is the only place that works.
     */
    guest.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const mod = process.platform === 'darwin' ? input.meta : input.control
      if (!mod || input.alt) return

      const key = input.key.toLowerCase()
      const chord = BROWSER_CHORDS[key]
      if (!chord) return

      event.preventDefault()
      const wc = win.webContents
      if (!wc.isDestroyed()) wc.send('browser:key', input.shift ? `${chord}+shift` : chord)
    })
  })

  // Dictation needs the microphone. Everything else a web page might ask for is
  // refused — this app has no use for location, sensors or notifications.
  const ALLOWED = new Set(['media', 'fullscreen', 'clipboard-sanitized-write'])
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED.has(permission))
  })
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission))

  // Tear the shells down before the renderer goes away, so no PTY read lands
  // on a destroyed webContents. The watch stops first: an agent going away is
  // otherwise read as one you closed, and every agent goes away here at once.
  win.on('close', () => {
    sessionWatch?.stop()
    ptys.killAll()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  /*
   * A renderer that dies takes the entire UI with it and leaves the window
   * painted in the theme's backdrop — a black rectangle over the whole app,
   * with no way back short of quitting. Electron does nothing about this on its
   * own, so bring the window back rather than leaving somebody staring at it.
   *
   * The shells go first: their panes no longer exist as far as the new renderer
   * is concerned, and it will ask for fresh ones by the same pane ids.
   */
  let recoveries = 0
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[eaon] renderer gone: ${details.reason} (exit ${details.exitCode})`)
    if (details.reason === 'clean-exit' || win.isDestroyed()) return

    recoveries += 1
    if (recoveries > 3) {
      dialog.showErrorBox(
        'Eaon ADE stopped responding',
        'The window crashed repeatedly and could not be recovered. Quit and open it again.'
      )
      return
    }

    ptys.killAll()
    setTimeout(() => {
      if (win.isDestroyed()) return
      ptys.unmute()
      win.reload()
    }, 300 * recoveries)
  })

  // Long enough to be reported, but a busy repaint across a dozen panes can
  // look like this too, so it is worth a line in the log and nothing more.
  win.webContents.on('unresponsive', () => console.error('[eaon] renderer unresponsive'))
  win.webContents.on('responsive', () => console.error('[eaon] renderer responsive again'))

  ptys.unmute()
  // Idempotent, and here for a window being opened a second time.
  sessionWatch?.start()

  // Anything that wants a new window opens in the user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const notifyFullscreen = () => win.webContents.send('win:fullscreen', win.isFullScreen())
  win.on('enter-full-screen', notifyFullscreen)
  win.on('leave-full-screen', notifyFullscreen)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** Resolve a binary through a login shell so PATH matches the user's terminal. */
async function which(bin: string): Promise<string | null> {
  if (!bin) return null
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('where', [bin])
      return stdout.split('\n')[0].trim() || null
    }
    const { stdout } = await run(shell, ['-lic', `command -v ${bin}`], { timeout: 6000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function registerIpc(): void {
  // ---- terminals -------------------------------------------------------
  ipcMain.handle('pty:spawn', (_e, req: SpawnRequest) =>
    // The session flags are decided here, where the transcripts are, rather
    // than in the renderer where they would only be a guess — and where what
    // the pane was last seen running is known, which the renderer never learns.
    ptys.spawn({
      ...req,
      command: launchCommand({ ...req, observed: paneSessions?.get(req.paneId) })
    })
  )
  ipcMain.on('pty:write', (_e, paneId: string, data: string) => ptys.write(paneId, data))
  ipcMain.on('pty:resize', (_e, paneId: string, cols: number, rows: number) =>
    ptys.resize(paneId, cols, rows)
  )
  ipcMain.on('pty:kill', (_e, paneId: string) => ptys.kill(paneId))
  ipcMain.handle('pty:alive', (_e, paneId: string) => ptys.has(paneId))

  // ---- persisted state -------------------------------------------------
  ipcMain.handle('state:load', () => store.load())
  ipcMain.on('state:save', (_e, next: PersistedState) => store.save(next))
  ipcMain.handle('state:reset', () => store.reset())
  ipcMain.handle('state:path', () => store.path)

  // ---- filesystem ------------------------------------------------------
  ipcMain.handle('fs:list', (_e, dir: string) => fsapi.listDir(dir))
  ipcMain.handle('fs:read', (_e, file: string) => fsapi.readFile(file))
  ipcMain.handle('fs:write', (_e, file: string, text: string) => fsapi.writeFile(file, text))
  ipcMain.handle('fs:search', (_e, root: string, q: string) => fsapi.searchFiles(root, q))
  ipcMain.handle('fs:isDir', (_e, target: string) => fsapi.isDirectory(target))
  ipcMain.handle('fs:saveDropped', (_e, name: string, bytes: Uint8Array) =>
    fsapi.saveDropped(name, bytes)
  )

  ipcMain.handle('dialog:pickFolder', async (_e, startIn?: string) => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: startIn || os.homedir(),
      buttonLabel: 'Use this folder'
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // ---- git -------------------------------------------------------------
  ipcMain.handle('git:status', (_e, cwd: string) => git.status(cwd))
  ipcMain.handle('git:branch', (_e, cwd: string) => git.branchOf(cwd))
  ipcMain.handle('git:diff', (_e, cwd: string, file: string, staged: boolean) =>
    git.diff(cwd, file, staged)
  )
  ipcMain.handle('git:stage', (_e, cwd: string, file: string) => git.stage(cwd, file))
  ipcMain.handle('git:unstage', (_e, cwd: string, file: string) => git.unstage(cwd, file))
  ipcMain.handle('git:stageAll', (_e, cwd: string) => git.stageAll(cwd))
  ipcMain.handle('git:commit', (_e, cwd: string, msg: string) => git.commit(cwd, msg))
  ipcMain.handle('git:log', (_e, cwd: string) => git.log(cwd))

  // ---- agents & sessions ----------------------------------------------
  ipcMain.handle('agents:detect', async () => {
    const results = await Promise.all(
      AGENTS.map(async (a) => ({
        ...a,
        available: a.bin ? Boolean(await which(a.bin)) : true
      }))
    )
    return results
  })
  ipcMain.handle('sessions:resumable', () => listResumable())
  ipcMain.handle('sessions:countFor', (_e, cwd: string) => sessionCountFor(cwd))

  // Stats: null counts every folder you have worked in.
  ipcMain.handle('stats:get', (_e, folder: string | null) => collectStats(folder))

  // ---- plan usage ------------------------------------------------------
  ipcMain.handle(
    'usage:read',
    (_e, opts: { fromAnthropic?: boolean; session?: number; week?: number }) => {
      const limits = {
        ...(opts?.session ? { session: opts.session } : {}),
        ...(opts?.week ? { week: opts.week } : {})
      }
      return opts?.fromAnthropic ? anthropicUsage() : localUsage(limits)
    }
  )
  ipcMain.on('usage:forget', () => resetUsageCache())

  // ---- preview browser -------------------------------------------------
  ipcMain.handle('browser:devPorts', () => browser.devPorts())

  // ---- voice dictation -------------------------------------------------
  ipcMain.handle('stt:catalog', () => STT_MODELS)
  ipcMain.handle('stt:installed', () => models.listInstalled())
  ipcMain.handle('stt:usage', () => models.usage())
  ipcMain.handle('stt:dir', () => models.modelsDir())
  ipcMain.handle('stt:state', () => stt.current())

  ipcMain.handle('stt:download', async (_e, modelId: string) => {
    try {
      await models.download(modelId, (p) => {
        const wc = mainWindow?.webContents
        if (wc && !wc.isDestroyed()) wc.send('stt:progress', p)
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })
  ipcMain.on('stt:cancel', (_e, modelId: string) => models.cancel(modelId))
  ipcMain.handle('stt:remove', (_e, modelId: string) => {
    // Unloading first means the files are not still open when they are deleted.
    stt.stop()
    models.remove(modelId)
    return models.listInstalled()
  })

  ipcMain.handle('stt:load', async (_e, modelId: string) => {
    try {
      await stt.load(modelId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })
  ipcMain.handle(
    'stt:transcribe',
    async (_e, modelId: string, audio: Float32Array, language: string) => {
      try {
        const text = await stt.transcribe(modelId, audio, language)
        return { ok: true, text }
      } catch (err) {
        return { ok: false, error: String(err instanceof Error ? err.message : err) }
      }
    }
  )
  ipcMain.on('stt:stop', () => stt.stop())

  // ---- spoken alerts ---------------------------------------------------
  ipcMain.handle('speech:support', () => speech.support())
  ipcMain.handle('speech:voices', () => speech.voices())
  ipcMain.handle('speech:refresh', () => {
    // Called when the settings panel is reopened, so a voice downloaded from
    // System Settings a moment ago turns up without restarting the app.
    speech.refreshVoices()
    return speech.voices()
  })
  ipcMain.on(
    'speech:speak',
    (_e, text: string, opts: { voice?: string; rate?: number; volume?: number }) => {
      speech.speak(text, opts ?? {})
    }
  )
  ipcMain.on('speech:stop', () => speech.stop())
  ipcMain.on('speech:openVoiceSettings', () => speech.openVoiceSettings())

  // ---- project memory --------------------------------------------------
  ipcMain.handle('brain:open', (_e, cwd: string | null) => {
    brain.setWorkspace(cwd)
    // Registering here means any agent started in this workspace from now on
    // finds the memory tools already wired up.
    const registration = cwd ? registerWorkspace(cwd) : null
    return { stats: brain.stats(), registered: cwd ? isRegistered(cwd) : false, registration }
  })
  ipcMain.handle('brain:list', () => brain.list())
  ipcMain.handle('brain:get', (_e, slug: string) => brain.get(slug))
  ipcMain.handle('brain:write', (_e, input: { title: string; content: string; tags?: string[]; slug?: string }) =>
    brain.write(input)
  )
  ipcMain.handle('brain:remove', (_e, slug: string) => brain.remove(slug))
  ipcMain.handle('brain:search', (_e, q: string) => brain.search(q))
  ipcMain.handle('brain:related', (_e, slug: string) => brain.related(slug))
  ipcMain.handle('brain:graph', () => brain.graph())
  ipcMain.handle('brain:stats', () => brain.stats())

  // ---- auto update -----------------------------------------------------
  ipcMain.handle('update:state', () => updater.current())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.on('update:install', () => updater.install())

  // ---- system ----------------------------------------------------------
  ipcMain.handle('sys:home', () => os.homedir())
  ipcMain.handle('sys:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    shell: process.env.SHELL || '',
    home: os.homedir()
  }))
  ipcMain.on('sys:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  ipcMain.on('sys:reveal', (_e, target: string) => shell.showItemInFolder(target))

  // ---- window ----------------------------------------------------------
  ipcMain.on('win:minimize', () => mainWindow?.minimize())
  ipcMain.on('win:toggleMaximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('win:close', () => mainWindow?.close())
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'

  // Wear the brand in the Dock during development too, not Electron's default.
  if (process.platform === 'darwin' && app.dock) {
    const icon = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'resources', 'icon.png')
    try {
      app.dock.setIcon(icon)
    } catch {
      /* a missing icon is not worth failing startup over */
    }
  }

  store = new Store()
  paneSessions = new PaneSessions()
  // Watches for the agents nobody told the app about — the ones you start by
  // typing `claude` into a shell — so those panes come back too.
  sessionWatch = new SessionWatch(() => ptys.pids(), paneSessions)
  sessionWatch.start()
  // Before anything asks which models are installed.
  models.migrateFromPreviousName()

  // Resolved at send time, so a recreated window never leaves the PTY layer
  // holding a stale reference.
  ptys.setSender((channel, payload) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    const wc = win.webContents
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, payload)
  })

  stt.onState((state) => {
    const wc = mainWindow?.webContents
    if (wc && !wc.isDestroyed()) wc.send('stt:state', state)
  })

  updater.setSender((channel, payload) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    const wc = win.webContents
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, payload)
  })

  registerIpc()
  mainWindow = createWindow()
  updater.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// The GPU process taking every WebGL context down with it is survivable — each
// terminal falls back to its DOM renderer — but it is worth knowing about when
// somebody reports that panes went slow.
app.on('child-process-gone', (_e, details) => {
  if (details.reason === 'clean-exit') return
  console.error(`[eaon] ${details.type} process gone: ${details.reason}`)
})

let quitting = false

/**
 * Stops everything the app owns, then leaves without unwinding Node.
 *
 * The order matters. `ptys.shutdown()` waits for every shell to be reaped
 * while the JavaScript environment is still intact, because node-pty reports
 * exits through a thread-safe function and one arriving mid-teardown aborts
 * the process outright — the SIGABRT this app used to die with. Once they are
 * gone there is nothing left worth unwinding, so exit rather than hand control
 * back and give a straggler another chance to land at the wrong moment.
 */
async function shutdownAndExit(): Promise<void> {
  if (quitting) return
  quitting = true

  // Nothing below may hang the quit. If it does, leave anyway.
  const failsafe = setTimeout(() => app.exit(0), 5000)
  failsafe.unref()

  try {
    updater.dispose()
  } catch {
    /* nothing here is worth blocking a quit */
  }
  try {
    stt.stop()
  } catch {
    /* nothing here is worth blocking a quit */
  }
  try {
    // Nobody wants the app to carry on talking after they have closed it.
    speech.stop()
  } catch {
    /* nothing here is worth blocking a quit */
  }
  try {
    store?.flush()
  } catch {
    /* nothing here is worth blocking a quit */
  }
  try {
    /*
     * Before the shells are reaped, and in this order.
     *
     * The watch reads a missing agent as one you closed and forgets its
     * conversation. Every agent is about to disappear at once, so leaving it
     * running through the shutdown would erase precisely the record the next
     * launch is meant to read — the sessions would be forgotten by the act of
     * quitting, which is the one moment they have to survive.
     */
    sessionWatch?.stop()
    paneSessions?.flush()
  } catch {
    /* nothing here is worth blocking a quit */
  }
  try {
    await ptys.shutdown()
  } catch {
    /* nothing here is worth blocking a quit */
  }

  clearTimeout(failsafe)
  app.exit(0)
}

app.on('before-quit', (e) => {
  if (quitting) return
  // Held open only long enough to reap the shells; `shutdownAndExit` bounds
  // itself and then exits on its own.
  e.preventDefault()
  void shutdownAndExit()
})

// Shut down the same way when something outside the app asks us to stop, so
// the PTY threads are gone before the process starts tearing itself down.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => void shutdownAndExit())
}

// A stray rejection in a filesystem or git call must never surface as a crash
// dialog while a dozen agents are mid-run.
process.on('unhandledRejection', (reason) => {
  console.error('[eaon] unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[eaon] uncaught exception:', err)
})
