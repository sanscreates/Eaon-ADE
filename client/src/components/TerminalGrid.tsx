import { Fragment, useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { LayoutNode, LeafNode, leaves } from '../lib/layoutTree';
import { useLayout } from '../store/layout';
import { useSessions } from '../store/sessions';
import { useWorkspaces } from '../store/workspaces';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import {
  attachTerminal,
  fitTerminal,
  focusTerminal,
  shouldRequestReplay,
} from '../lib/terminals';
import { wsClient } from '../lib/ws';
import { requestCloseSession, restartSession } from '../lib/spawn';
import { cls } from '../lib/utils';
import { TabLauncher } from './TabLauncher';
import { ContextMenu, MenuHeader, MenuItem, MenuSep, useContextMenu } from './ContextMenu';
import {
  IconPlus,
  IconRefresh,
  IconSplitDown,
  IconSplitRight,
  IconTerminal,
  IconTrash,
} from './Icons';

export function TerminalGrid() {
  const root = useLayout((s) => s.root);
  // A tab with no live sessions is a launcher, not a blank pane — that
  // includes the single empty starter leaf the layout keeps on fresh tabs.
  const hasSession = root && leaves(root).some((l) => l.sessionId);
  if (!hasSession) return <TabLauncher />;
  return (
    <div className="grid-root">
      <NodeView node={root} />
    </div>
  );
}

function NodeView({ node }: { node: LayoutNode }) {
  const updateSizes = useLayout((s) => s.updateSizes);

  if (node.kind === 'leaf') {
    return <TerminalPane leaf={node} />;
  }

  return (
    <PanelGroup
      key={node.id}
      direction={node.dir === 'row' ? 'horizontal' : 'vertical'}
      onLayout={(sizes) => updateSizes(node.id, sizes)}
      className="panel-group"
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          <Panel id={child.id} order={i} defaultSize={node.sizes[i]} minSize={6} className="panel">
            <NodeView node={child} />
          </Panel>
          {i < node.children.length - 1 && (
            <PanelResizeHandle
              className={cls('resize-handle', node.dir === 'row' ? 'rh-col' : 'rh-row')}
            />
          )}
        </Fragment>
      ))}
    </PanelGroup>
  );
}

function TerminalPane({ leaf }: { leaf: LeafNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const active = useLayout((s) => s.activeLeafId === leaf.id);
  const setActive = useLayout((s) => s.setActive);
  const split = useLayout((s) => s.split);
  const close = useLayout((s) => s.close);
  const meta = useSessions((s) => (leaf.sessionId ? s.sessions[leaf.sessionId] : undefined));
  const status = useSessions((s) =>
    leaf.sessionId ? s.status[leaf.sessionId] ?? 'spawning' : 'idle',
  );

  const sessionId = leaf.sessionId;
  const menu = useContextMenu();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId) return;

    attachTerminal(sessionId, container);
    if (useSettings.getState().replayScrollback && shouldRequestReplay(sessionId)) {
      wsClient.send({ t: 'attach', id: sessionId });
    }

    const observer = new ResizeObserver(() => {
      fitTerminal(sessionId);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [sessionId]);

  /*
   * No header, no footer — the terminal is the whole pane.
   *
   * Every agent CLI already prints its own name, version and working
   * directory on the first line, and the sidebar carries the session title,
   * agent mark and live status. A chrome bar per pane repeated all of that
   * and cost a row of vertical space in every one of up to sixteen panes.
   *
   * The pane controls survive as an overlay in the top-right corner, shown
   * on hover or while the pane is focused, so they cost nothing until you
   * reach for them.
   */
  return (
    <div
      className={cls('leaf', active && 'leaf-active')}
      onMouseDown={() => {
        setActive(leaf.id);
        if (sessionId) focusTerminal(sessionId);
      }}
      onContextMenu={menu.onContextMenu}
    >
      {sessionId ? (
        <div className="term-host" ref={containerRef} />
      ) : (
        <EmptyPane leafId={leaf.id} />
      )}

      <div className="leaf-controls" onMouseDown={(e) => e.stopPropagation()}>
        {status === 'exited' && sessionId && (
          <button
            className="leaf-ctl"
            title="Restart session"
            onClick={() => restartSession(sessionId)}
          >
            <IconRefresh size={13} />
          </button>
        )}
        <button
          className="leaf-ctl leaf-split-right"
          title="Split right (⌘\)"
          onClick={() => split(leaf.id, 'row', null)}
        >
          <IconSplitRight size={13} />
        </button>
        <button
          className="leaf-ctl leaf-split-down"
          title="Split down (⌘⇧\)"
          onClick={() => split(leaf.id, 'column', null)}
        >
          <IconSplitDown size={13} />
        </button>
      </div>

      <ContextMenu point={menu.point} onClose={menu.close}>
        <MenuHeader>{meta?.title ?? 'Pane'}</MenuHeader>
        <MenuItem
          icon={<IconSplitRight size={12} />}
          hint="⌘\"
          onClick={() => {
            menu.close();
            split(leaf.id, 'row', null);
          }}
        >
          Split right
        </MenuItem>
        <MenuItem
          icon={<IconSplitDown size={12} />}
          hint="⌘⇧\"
          onClick={() => {
            menu.close();
            split(leaf.id, 'column', null);
          }}
        >
          Split down
        </MenuItem>
        {sessionId && (
          <MenuItem
            icon={<IconRefresh size={12} />}
            onClick={() => {
              menu.close();
              restartSession(sessionId);
            }}
          >
            Restart session
          </MenuItem>
        )}
        <MenuSep />
        <MenuItem
          danger
          icon={<IconTrash size={12} />}
          hint="⌥W"
          onClick={() => {
            menu.close();
            if (sessionId) requestCloseSession(sessionId);
            else close(leaf.id);
          }}
        >
          Close pane
        </MenuItem>
      </ContextMenu>
    </div>
  );
}

function EmptyPane({ leafId }: { leafId: string }) {
  const assign = useLayout((s) => s.assign);
  const root = useLayout((s) => s.root);
  const openNewSession = useUi((s) => s.openNewSession);
  const sessions = useSessions((s) => s.sessions);
  const order = useSessions((s) => s.order);
  const owners = useWorkspaces((s) => s.owners);
  const activeTabId = useWorkspaces((s) => s.activeId);

  const placed = new Set(
    leaves(root)
      .map((l) => l.sessionId)
      .filter(Boolean),
  );
  // Sessions owned by other tabs are not up for grabs here.
  const unassigned = order.filter(
    (id) => sessions[id] && !placed.has(id) && (!owners[id] || owners[id] === activeTabId),
  );

  return (
    <div className="empty-pane">
      <IconTerminal size={22} />
      <div className="empty-pane-title">Empty pane</div>
      <button className="btn btn-accent btn-sm" onClick={() => openNewSession()}>
        <IconPlus size={13} /> New session
      </button>
      {unassigned.length > 0 && (
        <div className="unassigned">
          <div className="unassigned-label">Attach a running session</div>
          {unassigned.map((id) => (
            <button key={id} className="chip" onClick={() => assign(leafId, id)}>
              {sessions[id].title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

