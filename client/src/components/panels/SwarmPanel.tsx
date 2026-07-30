import { useEffect, useMemo, useRef, useState } from 'react';
import { useSwarm, resolveAgentId } from '../../store/swarm';
import { useAgents } from '../../store/agents';
import { useProjects } from '../../store/projects';
import { useSessions } from '../../store/sessions';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { useWorkspaces } from '../../store/workspaces';
import { focusTerminal } from '../../lib/terminals';
import { cls, timeAgo } from '../../lib/utils';
import type { SwarmMember, SwarmRole } from '../../lib/types';
import { AgentLogo, hasAgentLogo } from '../AgentLogos';
import { ContextMenu, MenuHeader, MenuItem, MenuSep, useContextMenu } from '../ContextMenu';
import {
  IconCheck,
  IconChevronDown,
  IconEdit,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconStop,
  IconSwarm,
  IconTerminal,
  IconTrash,
  IconX,
} from '../Icons';

/* ═══════════════════════════════════════════════════════════════════════════
   The swarm console.

   One screen that answers three questions: who is on the team, what are they
   each briefed to do, and what should they all do next. Everything it does
   ends up as text typed into a real terminal — there is no hidden channel, so
   whatever an agent was told is visible in its own pane.
   ═══════════════════════════════════════════════════════════════════════════ */

export function SwarmPanel() {
  const project = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const loaded = useSwarm((s) => s.loaded);
  const roles = useSwarm((s) => s.config.roles);
  const members = useSwarm((s) => s.config.members);

  if (!project) {
    return <div className="panel-empty">Add a project to run a swarm.</div>;
  }
  if (!loaded) {
    return <div className="panel-empty">Loading the roster…</div>;
  }
  if (roles.length === 0) {
    return (
      <div className="panel-empty">
        <p>Couldn’t load this project’s swarm.</p>
        <p className="panel-empty-hint">
          <a onClick={() => useSwarm.getState().load(project.path, project.id)}>Try again</a>
        </p>
      </div>
    );
  }

  return (
    <div className="swarm">
      <SwarmHeader />
      <div className="swarm-body">
        <div className="swarm-roster">
          {roles.map((role) => (
            <RoleGroup key={role.id} role={role} members={members.filter((m) => m.roleId === role.id)} />
          ))}
        </div>
        <TaskConsole />
      </div>
    </div>
  );
}

/* ── header ───────────────────────────────────────────────────────────────── */

function SwarmHeader() {
  const members = useSwarm((s) => s.config.members);
  const bindings = useSwarm((s) => s.bindings);
  const sessions = useSessions((s) => s.sessions);
  const askConfirm = useUi((s) => s.askConfirm);
  const toast = useUi((s) => s.toast);
  const openSettings = useSettings((s) => s.openSettings);

  // Recomputed from bindings + sessions so a pane closed by hand is reflected
  // here without the console having to be told.
  const running = useMemo(
    () => members.filter((m) => {
      const id = bindings[m.id];
      return id && sessions[id] && sessions[id].exitCode === undefined;
    }).length,
    [members, bindings, sessions],
  );
  const enabled = members.filter((m) => m.enabled).length;

  return (
    <div className="swarm-head">
      <div className="swarm-head-main">
        <span className="swarm-head-icon"><IconSwarm size={16} /></span>
        <div>
          <div className="swarm-head-title">Swarm</div>
          <div className="swarm-head-sub">
            {running} of {enabled} running
          </div>
        </div>
      </div>
      <div className="swarm-head-actions">
        <button
          className="btn btn-sm"
          onClick={() => {
            const started = useSwarm.getState().startAll();
            toast(started ? `Started ${started} agent${started === 1 ? '' : 's'}` : 'Everything enabled is already running', started ? 'success' : 'info');
          }}
        >
          <IconPlay size={12} /> Start all
        </button>
        <button
          className="btn btn-sm"
          disabled={running === 0}
          onClick={() =>
            askConfirm({
              title: 'Stop the swarm?',
              body: `${running} running agent${running === 1 ? '' : 's'} will be killed and their panes closed.`,
              confirmLabel: 'Stop all',
              danger: true,
              onConfirm: () => {
                const stopped = useSwarm.getState().stopAll();
                toast(`Stopped ${stopped} agent${stopped === 1 ? '' : 's'}`, 'info');
              },
            })
          }
        >
          <IconStop size={12} /> Stop all
        </button>
        <button className="icon-btn" title="Agent settings" onClick={() => openSettings('agents')}>
          <IconSettings size={14} />
        </button>
      </div>
    </div>
  );
}

/* ── roster ───────────────────────────────────────────────────────────────── */

function RoleGroup({ role, members }: { role: SwarmRole; members: SwarmMember[] }) {
  const addMember = useSwarm((s) => s.addMember);
  const [editing, setEditing] = useState(false);

  return (
    <section className="swarm-role">
      <div className="swarm-role-head">
        <span className="swarm-role-name">{role.name}</span>
        <span className="swarm-role-count">{members.length}</span>
        <button
          className="icon-btn"
          title={editing ? 'Done' : 'Edit charter'}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? <IconCheck size={12} /> : <IconEdit size={12} />}
        </button>
        <button className="icon-btn" title={`Add another ${role.name}`} onClick={() => addMember(role.id)}>
          <IconPlus size={12} />
        </button>
      </div>

      {editing ? <CharterEditor role={role} onDone={() => setEditing(false)} /> : (
        <p className="swarm-charter" title={role.charter}>{role.charter}</p>
      )}

      <div className="swarm-members">
        {members.length === 0 && (
          <button className="swarm-add-seat" onClick={() => addMember(role.id)}>
            <IconPlus size={12} /> Add a {role.name.toLowerCase()}
          </button>
        )}
        {members.map((member) => (
          <MemberRow key={member.id} member={member} role={role} />
        ))}
      </div>
    </section>
  );
}

function CharterEditor({ role, onDone }: { role: SwarmRole; onDone: () => void }) {
  const setRoleCharter = useSwarm((s) => s.setRoleCharter);
  const resetRoles = useSwarm((s) => s.resetRoles);
  const [text, setText] = useState(role.charter);

  return (
    <div className="swarm-charter-edit">
      <textarea
        className="swarm-charter-input"
        value={text}
        rows={5}
        spellCheck={false}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        placeholder={`What every ${role.name.toLowerCase()} should always do…`}
      />
      <div className="swarm-charter-actions">
        <span className="swarm-hint">Sent as the standing instruction for this role.</span>
        <button className="btn btn-sm" onClick={() => void resetRoles()}>
          <IconRefresh size={11} /> Defaults
        </button>
        <button
          className="btn btn-sm btn-accent"
          onClick={() => {
            setRoleCharter(role.id, text);
            onDone();
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function MemberRow({ member, role }: { member: SwarmMember; role: SwarmRole }) {
  const agents = useAgents((s) => s.agents);
  const bindings = useSwarm((s) => s.bindings);
  const sessions = useSessions((s) => s.sessions);
  const statuses = useSessions((s) => s.status);
  const setMemberAgent = useSwarm((s) => s.setMemberAgent);
  const setMemberEnabled = useSwarm((s) => s.setMemberEnabled);
  const removeMember = useSwarm((s) => s.removeMember);
  const [notesOpen, setNotesOpen] = useState(false);

  const agentId = member.agentId || resolveAgentId(member);
  const preset = agents.find((a) => a.id === agentId) ?? null;
  const sessionId = bindings[member.id];
  const live = sessionId && sessions[sessionId] && sessions[sessionId].exitCode === undefined;
  const status = live ? statuses[sessionId] ?? 'idle' : null;

  const installable = agents.filter((a) => !a.hidden);

  const focusPane = () => {
    if (!sessionId) return;
    // Jump to the pane holding this member — the console is a control surface,
    // and "show me what it's doing" has to be one click from here.
    useWorkspaces.getState().revealSession(sessionId);
    focusTerminal(sessionId);
  };

  const menu = useContextMenu();

  const confirmRemove = () => {
    menu.close();
    useUi.getState().askConfirm({
      title: 'Remove seat?',
      body: live
        ? `This seat's agent is still running. Removing it stops the agent and takes the seat out of the swarm.`
        : `This seat will be taken out of the swarm.`,
      confirmLabel: 'Remove seat',
      danger: true,
      onConfirm: () => removeMember(member.id),
    });
  };

  return (
    <div
      className={cls('swarm-member', !member.enabled && 'swarm-member-off')}
      onContextMenu={menu.onContextMenu}
    >
      <button
        className={cls('swarm-toggle', member.enabled && 'swarm-toggle-on')}
        title={member.enabled ? 'Enabled — included in Start all and broadcasts' : 'Disabled'}
        onClick={() => setMemberEnabled(member.id, !member.enabled)}
        role="switch"
        aria-checked={member.enabled}
      />

      <span className="swarm-member-agent">
        {preset && hasAgentLogo(preset.id) ? (
          <AgentLogo agentId={preset.id} size={13} />
        ) : (
          <span className="agent-badge agent-badge-sm" style={{ background: preset?.color ?? 'var(--n-500)' }}>
            {(preset?.name ?? '?')[0]}
          </span>
        )}
      </span>

      <select
        className="swarm-agent-select"
        value={member.agentId}
        onChange={(e) => setMemberAgent(member.id, e.target.value)}
        aria-label={`Agent for ${role.name}`}
      >
        <option value="">Default ({preset?.name ?? 'none installed'})</option>
        {installable.map((a) => (
          <option key={a.id} value={a.id} disabled={!a.installed}>
            {a.name}{a.installed ? '' : ' — not installed'}
          </option>
        ))}
      </select>

      {status && <span className={cls('status-dot', `st-${status}`)} title={status} />}

      <div className="swarm-member-actions">
        <button
          className={cls('icon-btn', member.notes && 'icon-btn-on')}
          title={member.notes ? `Note: ${member.notes}` : 'Add a note for this seat'}
          onClick={() => setNotesOpen((v) => !v)}
        >
          <IconEdit size={12} />
        </button>
        {live ? (
          <>
            <button className="icon-btn" title="Show this agent's pane" onClick={focusPane}>
              <IconTerminal size={12} />
            </button>
            <button
              className="icon-btn"
              title="Stop this agent"
              onClick={() => useSwarm.getState().stop(member.id)}
            >
              <IconStop size={12} />
            </button>
          </>
        ) : (
          <button
            className="icon-btn"
            title={preset?.installed ? 'Start this agent' : 'Agent not installed'}
            disabled={!preset?.installed}
            onClick={() => useSwarm.getState().start(member.id)}
          >
            <IconPlay size={12} />
          </button>
        )}
      </div>

      {notesOpen && (
        <NotesEditor member={member} onDone={() => setNotesOpen(false)} />
      )}

      <ContextMenu point={menu.point} onClose={menu.close}>
        <MenuHeader>Seat</MenuHeader>
        {live ? (
          <>
            <MenuItem icon={<IconTerminal size={12} />} onClick={() => { menu.close(); focusPane(); }}>
              Show pane
            </MenuItem>
            <MenuItem
              icon={<IconStop size={12} />}
              onClick={() => {
                menu.close();
                useSwarm.getState().stop(member.id);
              }}
            >
              Stop agent
            </MenuItem>
          </>
        ) : (
          <MenuItem
            icon={<IconPlay size={12} />}
            disabled={!preset?.installed}
            onClick={() => {
              menu.close();
              useSwarm.getState().start(member.id);
            }}
          >
            Start agent
          </MenuItem>
        )}
        <MenuItem
          icon={<IconEdit size={12} />}
          onClick={() => {
            menu.close();
            setNotesOpen(true);
          }}
        >
          {member.notes ? 'Edit note…' : 'Add note…'}
        </MenuItem>
        <MenuSep />
        <MenuItem danger icon={<IconTrash size={12} />} onClick={confirmRemove}>
          Remove seat
        </MenuItem>
      </ContextMenu>
    </div>
  );
}

function NotesEditor({ member, onDone }: { member: SwarmMember; onDone: () => void }) {
  const setMemberNotes = useSwarm((s) => s.setMemberNotes);
  const [text, setText] = useState(member.notes);

  return (
    <div className="swarm-notes">
      <input
        className="swarm-notes-input"
        value={text}
        autoFocus
        spellCheck={false}
        placeholder="Extra instruction for this seat only…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setMemberNotes(member.id, text.trim());
            onDone();
          } else if (e.key === 'Escape') onDone();
        }}
      />
      <button
        className="icon-btn"
        title="Save"
        onClick={() => {
          setMemberNotes(member.id, text.trim());
          onDone();
        }}
      >
        <IconCheck size={12} />
      </button>
      <button className="icon-btn" title="Cancel" onClick={onDone}>
        <IconX size={12} />
      </button>
    </div>
  );
}

/* ── task console ─────────────────────────────────────────────────────────── */

export function TaskConsole() {
  const roles = useSwarm((s) => s.config.roles);
  const members = useSwarm((s) => s.config.members);
  const log = useSwarm((s) => s.log);
  const toast = useUi((s) => s.toast);
  const [task, setTask] = useState('');
  const [targetRoles, setTargetRoles] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // null means "everyone enabled" — the common case, and it stays correct as
  // seats are added rather than silently excluding them.
  const targetedMembers = useMemo(() => {
    const enabled = members.filter((m) => m.enabled);
    if (!targetRoles) return enabled;
    return enabled.filter((m) => targetRoles.includes(m.roleId));
  }, [members, targetRoles]);

  const send = () => {
    const text = task.trim();
    if (!text) return;
    if (targetedMembers.length === 0) {
      toast('No enabled seats match that target', 'error');
      return;
    }
    const reached = useSwarm.getState().dispatch(text, targetedMembers.map((m) => m.id));
    if (reached === 0) {
      toast('Could not reach any agent — check they are installed', 'error');
      return;
    }
    setTask('');
    toast(`Task sent to ${reached} agent${reached === 1 ? '' : 's'}`, 'success');
  };

  const toggleRole = (roleId: string) => {
    setTargetRoles((current) => {
      if (!current) return [roleId];
      const next = current.includes(roleId) ? current.filter((r) => r !== roleId) : [...current, roleId];
      return next.length === 0 ? null : next;
    });
  };

  return (
    <div className="swarm-console">
      <div className="swarm-targets">
        <span className="swarm-targets-label">Send to</span>
        <button
          className={cls('chip', !targetRoles && 'chip-on')}
          onClick={() => setTargetRoles(null)}
        >
          Everyone
        </button>
        {roles.map((role) => {
          const count = members.filter((m) => m.roleId === role.id && m.enabled).length;
          return (
            <button
              key={role.id}
              className={cls('chip', targetRoles?.includes(role.id) && 'chip-on')}
              disabled={count === 0}
              onClick={() => toggleRole(role.id)}
              title={count === 0 ? `No enabled ${role.name.toLowerCase()}` : `${count} ${role.name.toLowerCase()}`}
            >
              {role.name}
            </button>
          );
        })}
      </div>

      <div className="swarm-compose">
        <textarea
          ref={inputRef}
          className="swarm-task-input"
          value={task}
          rows={3}
          spellCheck={false}
          placeholder="Describe the task. It is typed into each targeted agent's terminal — ⌘↵ to send."
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="swarm-compose-foot">
          <span className="swarm-hint">
            {targetedMembers.length === 0
              ? 'No seats targeted'
              : `${targetedMembers.length} seat${targetedMembers.length === 1 ? '' : 's'} · agents not running will be started`}
          </span>
          <button className="btn btn-sm btn-accent" disabled={!task.trim()} onClick={send}>
            Send task <kbd>⌘↵</kbd>
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="swarm-log">
          <div className="swarm-log-head">
            <span>Recent</span>
            <button className="icon-btn" title="Clear" onClick={() => useSwarm.getState().clearLog()}>
              <IconTrash size={11} />
            </button>
          </div>
          {log.slice(0, 8).map((entry) => (
            <div key={entry.id} className="swarm-log-row">
              <span className="swarm-log-targets">{[...new Set(entry.targets)].join(', ')}</span>
              <span className="swarm-log-task" title={entry.task}>{entry.task}</span>
              <span className="swarm-log-time">{timeAgo(entry.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
