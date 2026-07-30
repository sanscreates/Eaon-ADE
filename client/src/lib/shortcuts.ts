import { useEffect } from 'react';
import { useUi } from '../store/ui';
import { useLayout } from '../store/layout';
import { useProjects } from '../store/projects';
import { useAgents } from '../store/agents';
import { useWorkspaces, kindOf, type WorkspaceTabKind } from '../store/workspaces';
import { leaves } from './layoutTree';
import { applyPaneTemplate, requestCloseSession } from './spawn';
import { adjustTerminalFontSize } from './terminals';
import { useSettings } from '../store/settings';
import { useBrowser } from '../store/browser';
import { webviewOps } from './webviews';
import { desktop } from './desktop';

const TAB_ORDER: Exclude<WorkspaceTabKind, 'grid'>[] = [
  'board', 'files', 'editor', 'git', 'pulls', 'browser', 'swarm', 'memory',
];

/** The browser-store tab backing the active workspace tab, if it is one. */
function activeBrowserTabId(): string | null {
  const { tabs, activeId } = useWorkspaces.getState();
  const tab = tabs.find((t) => t.id === activeId);
  return tab && kindOf(tab) === 'browser' ? (tab.browserTabId ?? null) : null;
}

/**
 * Browser actions only mean anything while a browser tab is the one on
 * screen, and the menu fires its accelerators window-wide. Surfacing the
 * browser first is the friendly reading of "reload the page" pressed from a
 * terminal — the first press shows it, a second press acts on it.
 */
function runBrowserCommand(action: string): void {
  const workspaces = useWorkspaces.getState();
  const browser = useBrowser.getState();
  if (action === 'new-tab') {
    workspaces.openBrowserTab();
    return;
  }
  const tabId = activeBrowserTabId();
  if (!tabId) {
    workspaces.openPanelKind('browser');
    return;
  }
  const tab = browser.tab(tabId);
  if (!tab) return;
  switch (action) {
    case 'reload': return webviewOps.reload(tab.id);
    case 'hard-reload': return webviewOps.hardReload(tab.id);
    case 'back': return webviewOps.back(tab.id);
    case 'forward': return webviewOps.forward(tab.id);
    case 'devtools': return webviewOps.devTools(tab.id);
    case 'console': return browser.setShowConsole(!browser.showConsole);
    case 'scan': return void browser.scanServers();
    case 'external': {
      if (tab.url) window.open(tab.url, '_blank');
      return;
    }
  }
}

/** Split the active pane, or do nothing if there is no grid yet. */
function splitActive(dir: 'row' | 'column'): void {
  const { activeLeafId, split } = useLayout.getState();
  if (activeLeafId) split(activeLeafId, dir, null);
}

function closeActivePane(): void {
  const layout = useLayout.getState();
  const activeId = layout.activeLeafId;
  if (!activeId) return;
  const leaf = leaves(layout.root).find((l) => l.id === activeId);
  if (leaf?.sessionId) requestCloseSession(leaf.sessionId);
  else layout.close(activeId);
}

/**
 * Menu-bar commands, routed to the same actions the keyboard uses. Electron's
 * accelerators consume the keystroke before it reaches the page, so the
 * keydown handler below stays as the path for the browser-served build.
 */
export function runMenuCommand(command: string): void {
  const ui = useUi.getState();

  if (command.startsWith('panel:')) {
    // The Electron menu still sends the pre-tabs wire name for this slot.
    const raw = command.slice(6);
    useWorkspaces.getState().openPanelKind((raw === 'preview' ? 'browser' : raw) as Exclude<WorkspaceTabKind, 'grid'>);
    return;
  }
  if (command.startsWith('browser:')) {
    runBrowserCommand(command.slice(8));
    return;
  }
  if (command.startsWith('layout:')) {
    const active = useProjects.getState().projects.find((p) => p.id === useProjects.getState().activeId);
    if (!active) return;
    applyPaneTemplate(Number(command.slice(7)), {
      cwd: active.path,
      projectId: active.id,
      shellCommand: useAgents.getState().byId('shell')?.command ?? '/bin/zsh',
    });
    return;
  }

  switch (command) {
    case 'new-session': return ui.openNewSession();
    case 'new-worktree': return ui.setNewWorktreeOpen(true);
    case 'add-project': return ui.setAddProjectOpen(true);
    case 'palette': return ui.setPaletteOpen(!ui.paletteOpen);
    case 'sidebar': return ui.toggleSidebar();
    case 'split-right': return splitActive('row');
    case 'split-down': return splitActive('column');
    case 'close-pane': return closeActivePane();
    case 'font:up': return adjustTerminalFontSize(1);
    case 'font:down': return adjustTerminalFontSize(-1);
    case 'font:reset': return adjustTerminalFontSize('reset');
    case 'settings': return useSettings.getState().toggleSettings();
    // Fired after the menu's "Check for Updates…" has already run the check,
    // so About opens showing the answer rather than an idle "Check now".
    case 'updates:show': return useSettings.getState().openSettings('about');
  }
}

/** True inside the Electron shell, where the menu bar owns its accelerators. */
const inDesktopApp = !!desktop?.isApp;

/**
 * Everything the native menu declares an accelerator for. In the app the menu
 * fires those, so handling them here too would double-fire — ⌘\ would split
 * twice, ⌥W would close two panes. ⌘S has no menu item, so it stays ours.
 */
function ownedByMenu(e: KeyboardEvent): boolean {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && ['KeyK', 'KeyB', 'Comma', 'Backslash', 'Equal', 'Minus', 'Digit0'].includes(e.code)) {
    return true;
  }
  return e.altKey && (e.code === 'KeyT' || e.code === 'KeyW' || /^Digit[1-8]$/.test(e.code));
}

function onKeyDown(e: KeyboardEvent): void {
  if (inDesktopApp && ownedByMenu(e)) return;

  const ui = useUi.getState();
  const layout = useLayout.getState();
  const meta = e.metaKey || e.ctrlKey;

  if (meta && e.code === 'KeyK') {
    e.preventDefault();
    ui.setPaletteOpen(!ui.paletteOpen);
    return;
  }
  if (meta && e.code === 'Comma') {
    e.preventDefault();
    useSettings.getState().toggleSettings();
    return;
  }
  if (meta && !e.shiftKey && e.code === 'KeyB') {
    e.preventDefault();
    ui.toggleSidebar();
    return;
  }
  if (meta && e.code === 'KeyS') {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('eaon:save-file'));
    return;
  }
  if (e.altKey && e.code === 'KeyT') {
    e.preventDefault();
    ui.openNewSession();
    return;
  }
  // Browser-tab muscle memory: ⌘T opens a workspace tab, Ctrl+Tab cycles.
  if (meta && !e.shiftKey && !e.altKey && e.code === 'KeyT') {
    e.preventDefault();
    useWorkspaces.getState().addTab();
    return;
  }
  if (e.ctrlKey && e.code === 'Tab') {
    e.preventDefault();
    useWorkspaces.getState().cycleTab(e.shiftKey ? -1 : 1);
    return;
  }
  if (meta && e.code === 'Backslash') {
    e.preventDefault();
    splitActive(e.shiftKey ? 'column' : 'row');
    return;
  }
  if (e.altKey && e.code === 'KeyW') {
    e.preventDefault();
    closeActivePane();
    return;
  }
  if (meta && (e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0')) {
    e.preventDefault();
    adjustTerminalFontSize(
      e.code === 'Digit0' ? 'reset' : e.code === 'Equal' ? 1 : -1,
    );
    return;
  }
  if (e.altKey && /^Digit[1-8]$/.test(e.code)) {
    e.preventDefault();
    const idx = Number(e.code.slice(5)) - 1;
    useWorkspaces.getState().openPanelKind(TAB_ORDER[idx]);
    return;
  }
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown, true);
    const offMenu = desktop?.onMenuCommand(runMenuCommand);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      offMenu?.();
    };
  }, []);
}
