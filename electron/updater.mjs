import { app, ipcMain, shell, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* ═══════════════════════════════════════════════════════════════════════════
   Update checking.

   This app is not signed with an Apple Developer ID, and macOS will not let an
   unsigned app replace itself — Squirrel validates the signature before the
   swap, so a "silent" auto-update would download perfectly and then fail at
   the last step, which is worse than not offering it. So this checks for new
   releases and hands the download off to the user, who installs it the normal
   way once.

   The whole thing is one fetch against the GitHub Releases API, which is why
   there is no dependency here: electron-updater exists to do the swap we
   cannot do. When a Developer ID does show up, `INSTALL_MODE` below is the
   seam where the download becomes an install.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Where releases live. Override per-build without touching this file. */
const REPO = process.env.EAON_UPDATE_REPO || 'sanscreates/Eaon-ADE';

/** Re-check this often while the app stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Let the app finish starting before spending anything on the network. */
const FIRST_CHECK_DELAY_MS = 8_000;

const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/**
 * `notify` hands the user a download; `install` would swap the app in place.
 * Only `notify` is honest for an unsigned build — see the header.
 */
const INSTALL_MODE = 'notify';

/* ── persisted state ──────────────────────────────────────────────────────
   Small enough that a JSON file beats a dependency. Lives beside the app's
   other user data so uninstalling takes it too. */

let statePath = null;
let prefs = { autoCheck: true, skippedVersion: null, lastCheckedAt: 0 };

function loadPrefs() {
  try {
    statePath = path.join(app.getPath('userData'), 'updates.json');
    prefs = { ...prefs, ...JSON.parse(readFileSync(statePath, 'utf8')) };
  } catch {
    // First run, or unreadable — the defaults above are fine.
  }
}

function savePrefs() {
  try {
    if (statePath) writeFileSync(statePath, JSON.stringify(prefs, null, 2));
  } catch {
    // A read-only home directory costs us the preference, nothing more.
  }
}

/* ── version comparison ───────────────────────────────────────────────────
   Enough semver to answer "is the release newer than what is running": the
   numeric triple decides it, and a prerelease loses to the same triple
   released. Build metadata is ignored, which is what the spec says too. */

function parseVersion(raw) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(raw ?? '').trim());
  if (!m) return null;
  return {
    parts: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ?? null,
  };
}

/** > 0 when `a` is newer than `b`. Returns 0 when equal or unparseable. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) {
    if (x.parts[i] !== y.parts[i]) return x.parts[i] > y.parts[i] ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  // 1.0.0 beats 1.0.0-beta.1; between two prereleases, compare them plainly.
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/* ── the check ────────────────────────────────────────────────────────────── */

/**
 * The installer a human should double-click. Prefers a .dmg built for this
 * machine's architecture; the .zip alongside it is what an auto-updater would
 * consume, and handing that to a person is just a worse .dmg.
 */
function pickAsset(assets) {
  const dmgs = assets.filter((a) => a.name?.toLowerCase().endsWith('.dmg'));
  if (!dmgs.length) return null;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return dmgs.find((a) => a.name.toLowerCase().includes(arch)) ?? dmgs[0];
}

let state = { status: 'idle' };
let timer = null;

function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send('eaon:update-state', publicState());
  }
}

function publicState() {
  return {
    ...state,
    current: app.getVersion(),
    autoCheck: prefs.autoCheck,
    lastCheckedAt: prefs.lastCheckedAt || null,
    releasesUrl: RELEASES_PAGE,
    installMode: INSTALL_MODE,
  };
}

function setState(next) {
  state = next;
  broadcast();
}

/**
 * Ask GitHub what the latest release is. `silent` suppresses the "you are up
 * to date" and error states, so a scheduled check never interrupts to say
 * nothing happened — only a real update, or a check the user asked for, is
 * allowed to be visible.
 */
export async function checkForUpdates({ silent = false } = {}) {
  if (state.status === 'checking') return publicState();
  setState({ status: 'checking' });

  try {
    const res = await fetch(API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `EaonADE/${app.getVersion()}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    prefs.lastCheckedAt = Date.now();
    savePrefs();

    if (res.status === 404) {
      // No releases yet, or the repo is private and we have no token. Either
      // way there is nothing to offer — say so precisely rather than "failed".
      setState(silent ? { status: 'idle' } : { status: 'up-to-date', note: 'No published releases yet.' });
      return publicState();
    }
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);

    const release = await res.json();
    if (release.draft) {
      setState(silent ? { status: 'idle' } : { status: 'up-to-date' });
      return publicState();
    }

    const latest = release.tag_name ?? release.name;
    const current = app.getVersion();

    if (compareVersions(latest, current) <= 0) {
      setState(silent ? { status: 'idle' } : { status: 'up-to-date' });
      return publicState();
    }

    const asset = pickAsset(release.assets ?? []);
    const version = String(latest).replace(/^v/, '');

    // A skipped version stays skipped until something newer than it ships.
    if (silent && prefs.skippedVersion && compareVersions(version, prefs.skippedVersion) <= 0) {
      setState({ status: 'idle' });
      return publicState();
    }

    setState({
      status: 'available',
      version,
      notes: typeof release.body === 'string' ? release.body.trim().slice(0, 4000) : '',
      publishedAt: release.published_at ?? null,
      downloadUrl: asset?.browser_download_url ?? RELEASES_PAGE,
      downloadName: asset?.name ?? null,
      downloadSize: asset?.size ?? null,
      pageUrl: release.html_url ?? RELEASES_PAGE,
    });
    return publicState();
  } catch (err) {
    const message = err?.name === 'TimeoutError' ? 'The update check timed out.' : String(err?.message ?? err);
    setState(silent ? { status: 'idle' } : { status: 'error', message });
    return publicState();
  }
}

/* ── wiring ───────────────────────────────────────────────────────────────── */

export function registerUpdater() {
  loadPrefs();

  ipcMain.handle('eaon:update-check', (_e, opts) => checkForUpdates(opts ?? {}));
  ipcMain.handle('eaon:update-state', () => publicState());

  ipcMain.handle('eaon:update-download', () => {
    const url = state.status === 'available' ? state.downloadUrl : RELEASES_PAGE;
    shell.openExternal(url);
    return publicState();
  });

  ipcMain.handle('eaon:update-open-page', () => {
    shell.openExternal(state.status === 'available' ? state.pageUrl : RELEASES_PAGE);
    return publicState();
  });

  ipcMain.handle('eaon:update-skip', () => {
    if (state.status === 'available') {
      prefs.skippedVersion = state.version;
      savePrefs();
    }
    setState({ status: 'idle' });
    return publicState();
  });

  ipcMain.handle('eaon:update-dismiss', () => {
    setState({ status: 'idle' });
    return publicState();
  });

  ipcMain.handle('eaon:update-set-auto', (_e, on) => {
    prefs.autoCheck = !!on;
    savePrefs();
    schedule();
    return publicState();
  });

  schedule();
}

function schedule() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Checking from a dev build would report the packaged version as newer than
  // whatever is running and nag on every launch, so it stays off.
  if (!prefs.autoCheck || !app.isPackaged) return;
  setTimeout(() => void checkForUpdates({ silent: true }), FIRST_CHECK_DELAY_MS);
  timer = setInterval(() => void checkForUpdates({ silent: true }), CHECK_INTERVAL_MS);
}

/** The menu's "Check for Updates…" — always visible, never silent. */
export async function checkForUpdatesFromMenu() {
  await checkForUpdates({ silent: false });
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win && !win.webContents.isDestroyed()) win.webContents.send('eaon:menu', 'updates:show');
}
