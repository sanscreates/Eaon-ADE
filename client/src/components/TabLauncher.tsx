import { useMemo } from 'react';
import { useAgents } from '../store/agents';
import { useProjects } from '../store/projects';
import { useSessions } from '../store/sessions';
import { useWorkspaces } from '../store/workspaces';
import { useUi } from '../store/ui';
import { spawnAgent } from '../lib/spawn';
import { AgentLogo, hasAgentLogo } from './AgentLogos';
import { IconPlus } from './Icons';

/**
 * A fresh tab is a launcher, not a blank pane: pick an agent and it spawns
 * straight into the tab's grid. Running sessions that no tab owns can be
 * attached from the row below. This is also the project's onboarding surface,
 * so the no-projects case collapses to a single "add a project" call.
 */
export function TabLauncher() {
  const agents = useAgents((s) => s.agents);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const hasProjects = useProjects((s) => s.projects.length > 0);
  const setAddProjectOpen = useUi((s) => s.setAddProjectOpen);
  const openNewSession = useUi((s) => s.openNewSession);
  const sessions = useSessions((s) => s.sessions);
  const order = useSessions((s) => s.order);
  const owners = useWorkspaces((s) => s.owners);
  const activeTabId = useWorkspaces((s) => s.activeId);
  const claim = useWorkspaces((s) => s.claim);
  const reconcileActive = useWorkspaces((s) => s.reconcileActive);

  const tiles = useMemo(() => {
    const installed = agents.filter((a) => a.installed);
    const missing = agents.filter((a) => !a.installed);
    return [...installed, ...missing].slice(0, 12);
  }, [agents]);

  const attachable = order.filter(
    (id) => sessions[id] && (!owners[id] || owners[id] === activeTabId),
  );

  if (!hasProjects) {
    return (
      <div className="launcher">
        <div className="launcher-head">
          <div className="launcher-eyebrow">Eaon ADE</div>
          <h1 className="launcher-title">Add a project to begin</h1>
          <p className="launcher-sub">Your agents work inside project folders. Point one at a repo and spawn away.</p>
          <button className="btn btn-accent" onClick={() => setAddProjectOpen(true)}>
            <IconPlus size={14} /> Add your first project
          </button>
        </div>
      </div>
    );
  }

  const spawn = (agentId: string) => {
    const preset = agents.find((a) => a.id === agentId);
    if (!preset || !active) return;
    // spawnAgent carries the agent's own args, env, standing system prompt and
    // the globally selected Claude profile — all of which a bare spawnSession
    // would drop, which is how a custom agent used to launch without its flags.
    spawnAgent(preset, {
      cwd: active.path,
      projectId: active.id,
      systemText: preset.systemPrompt,
    });
  };

  return (
    <div className="launcher">
      <div className="launcher-head">
        <div className="launcher-eyebrow">New tab{active ? ` · ${active.name}` : ''}</div>
        <h1 className="launcher-title">What do you want to open?</h1>
      </div>

      <div className="launcher-grid">
        {tiles.map((a, i) => (
          <button
            key={a.id}
            className={a.installed ? 'launcher-tile' : 'launcher-tile launcher-tile-dim'}
            style={{ animationDelay: `${i * 18}ms` }}
            disabled={!active}
            onClick={() => spawn(a.id)}
            title={a.installed ? `New ${a.name} session` : `${a.name} — not installed`}
          >
            <span className="launcher-tile-icon">
              {hasAgentLogo(a.id) ? (
                <AgentLogo agentId={a.id} size={26} />
              ) : (
                <span className="launcher-letter" style={{ background: a.color }}>
                  {a.name[0]}
                </span>
              )}
            </span>
            <span className="launcher-tile-name">{a.name}</span>
            {!a.installed && <span className="launcher-tile-tag">not installed</span>}
          </button>
        ))}
        <button
          className="launcher-tile launcher-tile-custom"
          style={{ animationDelay: `${tiles.length * 18}ms` }}
          onClick={() => openNewSession()}
          title="Custom command, env and cwd (⌥T)"
        >
          <span className="launcher-tile-icon launcher-plus">
            <IconPlus size={18} />
          </span>
          <span className="launcher-tile-name">Custom CLI</span>
          <span className="launcher-tile-tag">⌥T</span>
        </button>
      </div>

      {attachable.length > 0 && (
        <div className="launcher-attach">
          <span className="launcher-attach-label">Attach running</span>
          {attachable.map((id) => (
            <button
              key={id}
              className="chip"
              onClick={() => {
                claim(id);
                reconcileActive(order);
              }}
            >
              {sessions[id].title}
            </button>
          ))}
        </div>
      )}

      <div className="launcher-hints">
        <span><kbd>⌘T</kbd> new tab</span>
        <span><kbd>⌥T</kbd> more options</span>
        <span><kbd>⌘\</kbd> split</span>
      </div>
    </div>
  );
}
