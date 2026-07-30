import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi } from '../store/ui';
import { useAgents } from '../store/agents';
import { useProjects } from '../store/projects';
import { useLayout } from '../store/layout';
import { useWorkspaces, type WorkspaceTabKind } from '../store/workspaces';
import { leaves } from '../lib/layoutTree';
import { applyPaneTemplate, killSession, spawnAgent } from '../lib/spawn';
import { runMenuCommand } from '../lib/shortcuts';
import { useSettings } from '../store/settings';
import { cls } from '../lib/utils';
import { IconCommand } from './Icons';

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const TEMPLATES = [1, 2, 4, 6, 8, 9, 12, 16];

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  if (!open) return null;
  return <PaletteInner />;
}

function PaletteInner() {
  const setOpen = useUi((s) => s.setPaletteOpen);
  const ui = useUi.getState();
  const agents = useAgents((s) => s.agents);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const layout = useLayout.getState();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];
    const cwd = active?.path ?? '~';
    const projectId = active?.id;

    list.push({ id: 'new', label: 'New agent session…', hint: '⌥T', run: () => ui.openNewSession() });

    for (const a of agents.filter((x) => x.installed && x.id !== 'shell')) {
      list.push({
        id: `spawn-${a.id}`,
        label: `Spawn ${a.name}`,
        run: () => spawnAgent(a, { cwd, projectId, systemText: a.systemPrompt }),
      });
    }
    const shell = agents.find((a) => a.id === 'shell');
    if (shell?.installed) {
      list.push({
        id: 'spawn-shell',
        label: 'Spawn shell',
        run: () => spawnAgent(shell, { cwd, projectId, title: 'shell' }),
      });
    }

    const activeLeaf = layout.activeLeafId;
    if (activeLeaf) {
      list.push({
        id: 'split-right',
        label: 'Split pane right',
        hint: '⌘\\',
        run: () => useLayout.getState().split(activeLeaf, 'row', null),
      });
      list.push({
        id: 'split-down',
        label: 'Split pane down',
        hint: '⌘⇧\\',
        run: () => useLayout.getState().split(activeLeaf, 'column', null),
      });
      list.push({
        id: 'close-pane',
        label: 'Close active pane',
        hint: '⌥W',
        run: () => {
          const leaf = leaves(useLayout.getState().root).find((l) => l.id === activeLeaf);
          if (leaf?.sessionId) killSession(leaf.sessionId);
          else useLayout.getState().close(activeLeaf);
        },
      });
    }

    list.push({ id: 'sidebar', label: 'Toggle sidebar', hint: '⌘B', run: () => ui.toggleSidebar() });

    const tabs: [Exclude<WorkspaceTabKind, 'grid'>, string][] = [
      ['board', 'Board'],
      ['files', 'Files'],
      ['editor', 'Editor'],
      ['git', 'Git'],
      ['pulls', 'Pull requests'],
      ['browser', 'Browser'],
      ['swarm', 'Swarm'],
      ['memory', 'Memory'],
    ];
    tabs.forEach(([id, label], i) => {
      list.push({
        id: `tab-${id}`,
        label: `Show ${label} tab`,
        hint: `⌥${i + 1}`,
        run: () => useWorkspaces.getState().openPanelKind(id),
      });
    });

    // Routed through the same handler the menu bar uses, so a browser action
    // means one thing whether it came from ⌘K, the menu or a click.
    const browserCommands: [string, string][] = [
      ['new-tab', 'Browser: new tab'],
      ['reload', 'Browser: reload page'],
      ['hard-reload', 'Browser: reload ignoring cache'],
      ['back', 'Browser: back'],
      ['forward', 'Browser: forward'],
      ['devtools', 'Browser: open page DevTools'],
      ['console', 'Browser: toggle console'],
      ['scan', 'Browser: scan for dev servers'],
      ['external', 'Browser: open page in default browser'],
    ];
    for (const [action, label] of browserCommands) {
      list.push({ id: `browser-${action}`, label, run: () => runMenuCommand(`browser:${action}`) });
    }

    if (active) {
      for (const n of TEMPLATES) {
        list.push({
          id: `template-${n}`,
          label: `Layout: ${n} ${n === 1 ? 'pane' : 'panes'}`,
          run: () =>
            applyPaneTemplate(n, {
              cwd: active.path,
              projectId: active.id,
              shellCommand: shell?.command ?? '/bin/zsh',
            }),
        });
      }
      list.push({ id: 'worktree', label: 'New git worktree…', run: () => ui.setNewWorktreeOpen(true) });
    }
    list.push({ id: 'add-project', label: 'Add project…', run: () => ui.setAddProjectOpen(true) });
    list.push({
      id: 'settings',
      label: 'Open Settings',
      hint: '⌘,',
      run: () => useSettings.getState().openSettings(),
    });

    return list;
  }, [agents, active?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('.palette-item-active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const runAndClose = (cmd: Cmd) => {
    setOpen(false);
    cmd.run();
  };

  return (
    <div className="palette-overlay" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <IconCommand size={14} />
          <input
            className="palette-input"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = filtered[index];
                if (cmd) runAndClose(cmd);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="side-empty">No matching commands</div>}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={cls('palette-item', i === index && 'palette-item-active')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runAndClose(cmd)}
            >
              <span>{cmd.label}</span>
              {cmd.hint && <kbd>{cmd.hint}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
