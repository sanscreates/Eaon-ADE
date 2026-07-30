import { useMemo, useRef, useState } from 'react';
import { useBoard } from '../../store/board';
import { useProjects } from '../../store/projects';
import { useAgents } from '../../store/agents';
import { useSessions } from '../../store/sessions';
import { useSettings } from '../../store/settings';
import { useSwarm } from '../../store/swarm';
import { useUi } from '../../store/ui';
import { spawnAgent } from '../../lib/spawn';
import { cls } from '../../lib/utils';
import type { BoardCard } from '../../lib/types';
import { AgentLogo, hasAgentLogo } from '../AgentLogos';
import { PortalMenu } from '../PortalMenu';
import { ContextMenu, MenuHeader, MenuItem, MenuSep, useContextMenu } from '../ContextMenu';
import { IconChevronDown, IconCopy, IconPlus, IconRocket, IconSwarm, IconTrash } from '../Icons';

export function BoardPanel() {
  const board = useBoard((s) => s.board);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);

  if (!active) {
    return <div className="panel-empty">Add a project to use the board.</div>;
  }

  // No columns means the fetch failed — the server was restarting, most
  // likely. Say so and offer the retry, rather than showing a blank panel
  // that looks identical to a broken app.
  if (board.columns.length === 0) {
    return (
      <div className="panel-empty">
        <p>Couldn’t load this project’s board.</p>
        <p className="panel-empty-hint">
          <a onClick={() => useBoard.getState().load(active.path)}>Try again</a>
        </p>
      </div>
    );
  }

  return (
    <div className="board">
      {board.columns.map((col) => (
        <BoardColumn key={col.id} id={col.id} title={col.title} />
      ))}
    </div>
  );
}

function BoardColumn({ id, title }: { id: string; title: string }) {
  const allCards = useBoard((s) => s.board.cards);
  const cards = useMemo(() => allCards.filter((c) => c.columnId === id), [allCards, id]);
  const moveCard = useBoard((s) => s.moveCard);
  const addCard = useBoard((s) => s.addCard);
  const [adding, setAdding] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={cls('board-col', dragOver && 'board-col-over')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const cardId = e.dataTransfer.getData('text/eaon-card');
        if (cardId) moveCard(cardId, id);
      }}
    >
      <div className="board-col-head">
        <span className="board-col-title">{title}</span>
        <span className="board-col-count">{cards.length}</span>
      </div>
      <div className="board-cards">
        {cards.map((card) => (
          <Card key={card.id} card={card} />
        ))}
        {adding ? (
          <input
            className="board-add-input"
            placeholder="Task title…"
            autoFocus
            onKeyDown={(e) => {
              const value = (e.target as HTMLInputElement).value.trim();
              if (e.key === 'Enter' && value) {
                addCard(id, value);
                setAdding(false);
              }
              if (e.key === 'Escape') setAdding(false);
            }}
            onBlur={() => setAdding(false)}
          />
        ) : (
          <button className="board-add" onClick={() => setAdding(true)}>
            <IconPlus size={12} /> Add card
          </button>
        )}
      </div>
    </div>
  );
}

function Card({ card }: { card: BoardCard }) {
  const moveCard = useBoard((s) => s.moveCard);
  const updateCard = useBoard((s) => s.updateCard);
  const removeCard = useBoard((s) => s.removeCard);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const agents = useAgents((s) => s.agents);
  const installed = useMemo(() => agents.filter((a) => a.installed), [agents]);
  const byId = useAgents((s) => s.byId);
  const sessionStatus = useSessions((s) => (card.sessionId ? s.status[card.sessionId] : undefined));
  const toast = useUi((s) => s.toast);
  const askConfirm = useUi((s) => s.askConfirm);
  const defaultDispatchId = useSettings((s) => s.boardDispatchAgentId);
  const autoProgress = useSettings((s) => s.boardAutoProgress);
  const swarmRoles = useSwarm((s) => s.config.roles);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const menu = useContextMenu();
  const dispatchRef = useRef<HTMLDivElement>(null);

  const agent = byId(card.agentId);

  // A configured default turns the rocket into a one-click dispatch; the
  // chevron beside it still opens the picker for the off-default cases.
  const defaultAgent = defaultDispatchId ? byId(defaultDispatchId) : null;
  const defaultInstalled = defaultAgent?.installed ?? false;

  /** The card as a single instruction — what any agent actually receives. */
  const taskText = card.description ? `${card.title}\n\n${card.description}` : card.title;

  const dispatch = (agentId: string) => {
    setDispatchOpen(false);
    if (!active) return;
    const preset = byId(agentId);
    if (!preset || !preset.installed) {
      toast('Agent not available', 'error');
      return;
    }
    // spawnAgent, not spawnSession: a custom agent's args, env and standing
    // system prompt would otherwise be silently dropped on this path.
    const sessionId = spawnAgent(preset, {
      cwd: active.path,
      projectId: active.id,
      title: card.title.length > 42 ? card.title.slice(0, 42) + '…' : card.title,
      task: taskText,
      systemText: preset.systemPrompt,
      placement: 'split',
    });
    updateCard(card.id, {
      agentId: preset.id,
      sessionId,
      ...(autoProgress ? { columnId: 'in-progress' } : {}),
    });
    toast(`Dispatched to ${preset.name}`, 'success');
  };

  /**
   * Hand the card to the whole swarm instead of one agent. The coordinator is
   * the default target because a card is usually a goal, not an instruction —
   * splitting it up is exactly that role's job.
   */
  const sendToSwarm = (roleId?: string) => {
    setDispatchOpen(false);
    const swarm = useSwarm.getState();
    const targets = swarm.config.members.filter(
      (m) => m.enabled && (!roleId || m.roleId === roleId),
    );
    if (targets.length === 0) {
      toast(roleId ? 'No enabled seat for that role' : 'No enabled swarm seats', 'error');
      return;
    }
    const reached = swarm.dispatch(taskText, targets.map((m) => m.id));
    if (reached === 0) {
      toast('Could not reach any agent — check they are installed', 'error');
      return;
    }
    if (autoProgress) updateCard(card.id, { columnId: 'in-progress' });
    toast(`Sent to ${reached} agent${reached === 1 ? '' : 's'}`, 'success');
  };

  // Always asks. Deleting is only reachable from the right-click menu now, so
  // the old "skip the dialog" setting would just reintroduce the one-gesture
  // delete the menu exists to prevent.
  const onDelete = () => {
    menu.close();
    askConfirm({
      title: 'Delete card?',
      body: `“${card.title}” will be removed from the board. This can't be undone.`,
      confirmLabel: 'Delete card',
      danger: true,
      onConfirm: () => removeCard(card.id),
    });
  };

  return (
    <div
      className="board-card"
      draggable
      onContextMenu={menu.onContextMenu}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/eaon-card', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = e.dataTransfer.getData('text/eaon-card');
        if (draggedId && draggedId !== card.id) moveCard(draggedId, card.columnId, card.id);
      }}
    >
      <div className="board-card-title">{card.title}</div>
      {card.description && <div className="board-card-desc">{card.description}</div>}
      <div className="board-card-foot">
        <div className="board-card-meta">
          {agent && (
            <span className="agent-badge agent-badge-sm" style={{ background: agent.color }} title={agent.name}>
              {hasAgentLogo(agent.id) ? <AgentLogo agentId={agent.id} size={10} /> : agent.name[0]}
            </span>
          )}
          {sessionStatus && <span className={cls('status-dot', `st-${sessionStatus}`)} title={sessionStatus} />}
        </div>
        <div className="board-card-actions">
          <div className="dispatch-wrap" ref={dispatchRef}>
            <button
              className="icon-btn"
              title={
                defaultAgent && defaultInstalled
                  ? `Dispatch to ${defaultAgent.name}`
                  : 'Dispatch to agent'
              }
              onClick={() => {
                if (defaultAgent && defaultInstalled) dispatch(defaultAgent.id);
                else setDispatchOpen((v) => !v);
              }}
            >
              <IconRocket size={13} />
            </button>
            {defaultAgent && defaultInstalled && (
              <button
                className="icon-btn dispatch-more"
                title="Choose another agent"
                onClick={() => setDispatchOpen((v) => !v)}
              >
                <IconChevronDown size={11} />
              </button>
            )}
            <PortalMenu
              anchorRef={dispatchRef}
              open={dispatchOpen}
              onClose={() => setDispatchOpen(false)}
              prefer="above"
            >
                {swarmRoles.length > 0 && (
                  <>
                    <div className="dropdown-label">Send to the swarm…</div>
                    <button className="dropdown-item" onClick={() => sendToSwarm()}>
                      <span className="wt-new-icon"><IconSwarm size={12} /></span>
                      Everyone
                    </button>
                    {swarmRoles.map((role) => (
                      <button
                        key={role.id}
                        className="dropdown-item"
                        onClick={() => sendToSwarm(role.id)}
                      >
                        <span className="wt-new-icon"><IconSwarm size={12} /></span>
                        {role.name}
                      </button>
                    ))}
                  </>
                )}
                <div className="dropdown-label">Dispatch to one agent…</div>
                {installed.length === 0 && <div className="dropdown-item dropdown-disabled">No agents installed</div>}
                {installed.map((a) => (
                  <button key={a.id} className="dropdown-item" onClick={() => dispatch(a.id)}>
                    <span className="agent-badge agent-badge-sm" style={{ background: a.color }}>
                      {hasAgentLogo(a.id) ? <AgentLogo agentId={a.id} size={10} /> : a.name[0]}
                    </span>
                    {a.name}
                  </button>
                ))}
            </PortalMenu>
          </div>
        </div>
      </div>

      <ContextMenu point={menu.point} onClose={menu.close}>
        <MenuHeader>Card</MenuHeader>
        <MenuItem
          icon={<IconRocket size={12} />}
          disabled={!active || installed.length === 0}
          onClick={() => {
            menu.close();
            setDispatchOpen(true);
          }}
        >
          Dispatch to agent…
        </MenuItem>
        <MenuItem
          icon={<IconCopy size={12} />}
          onClick={() => {
            menu.close();
            void navigator.clipboard.writeText(taskText);
            toast('Card copied', 'success');
          }}
        >
          Copy text
        </MenuItem>
        <MenuSep />
        <MenuItem danger icon={<IconTrash size={12} />} onClick={onDelete}>
          Delete card
        </MenuItem>
      </ContextMenu>
    </div>
  );
}
