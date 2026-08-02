import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { PtyManager } from './pty-manager'
import { Store } from './store'
import * as fsapi from './fsapi'
import * as git from './git'
import { listResumable, sessionCountFor } from './sessions'
import * as browser from './browser'
import * as models from './stt/models'
import { SttHost } from './stt/host'
import { Updater } from './updater'
import { getTheme } from '../shared/themes'
import { STT_MODELS } from '../shared/stt'
import { AGENTS, type PersistedState, type SpawnRequest } from '../shared/types'

const run = promisify(execFile)

let mainWindow: BrowserWindow | null = null
let store: Store
const ptys = new PtyManager()
const stt = new SttHost()
const updater = new Updater()

// Set before the app is ready so the user-data folder is ours alone and never
// collides with another project that happens to share the package name.
app.setName('Eaon ADE')
app.setPath('userData', path.join(app.getPath('appData'), 'Eaon ADE'))

// Each terminal draws on its own GPU context. The browser default caps live
// contexts at 16 and silently drops the oldest past that, which would blank a
// pane in a twelve-up grid.
app.commandLine.appendSwitch('max-active-webgl-contexts', '32')

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

  // A page that wants a new window gets the user's real browser, not a second
  // preview with no address bar and no way out.
  win.webContents.on('did-attach-webview', (_e, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
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
  // on a destroyed webContents.
  win.on('close', () => ptys.killAll())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

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
  ipcMain.handle('pty:spawn', (_e, req: SpawnRequest) => ptys.spawn(req))
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

app.on('before-quit', () => {
  updater.dispose()
  ptys.killAll()
  stt.stop()
  store?.flush()
})

// Shut down cleanly when something outside the app asks us to stop, so the
// PTY threads are gone before the process starts tearing itself down.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    ptys.killAll()
    stt.stop()
    store?.flush()
    app.quit()
  })
}

// A stray rejection in a filesystem or git call must never surface as a crash
// dialog while a dozen agents are mid-run.
process.on('unhandledRejection', (reason) => {
  console.error('[eaon] unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[eaon] uncaught exception:', err)
})
