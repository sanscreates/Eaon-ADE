import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { useUi } from '../../store/ui';
import { useAgents } from '../../store/agents';
import { useProjects } from '../../store/projects';
import { useGit } from '../../store/git';
import { useSettings } from '../../store/settings';
import { useClaude } from '../../store/claude';
import { api } from '../../lib/api';
import { spawnAgent, spawnSession } from '../../lib/spawn';
import { cls, baseName } from '../../lib/utils';
import { AgentLogo, hasAgentLogo } from '../AgentLogos';
import { IconPlus } from '../Icons';

export function NewSessionDialog() {
  const open = useUi((s) => s.newSessionOpen);
  const prefill = useUi((s) => s.sessionPrefill);
  const close = useUi((s) => s.closeNewSession);
  if (!open) return null;
  return <NewSessionModal key={JSON.stringify(prefill ?? {})} prefill={prefill} onClose={close} />;
}

function NewSessionModal({
  prefill,
  onClose,
}: {
  prefill: { agentId?: string; cwd?: string; prompt?: string } | null;
  onClose: () => void;
}) {
  const agents = useAgents((s) => s.agents);
  const defaultAgent = useAgents((s) => s.defaultAgent);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const git = useGit((s) => s.status);
  const toast = useUi((s) => s.toast);
  const bumpWorktrees = useUi((s) => s.bumpWorktrees);

  const settingsDefault = useSettings((s) => s.defaultAgentId);
  const [agentId, setAgentId] = useState(
    prefill?.agentId ??
      (settingsDefault && agents.some((a) => a.id === settingsDefault && a.installed)
        ? settingsDefault
        : null) ??
      defaultAgent()?.id ??
      'shell',
  );
  const [cwd, setCwd] = useState(prefill?.cwd ?? active?.path ?? '~');
  const [prompt, setPrompt] = useState(prefill?.prompt ?? '');
  const [useWorktree, setUseWorktree] = useState(false);
  const [branch, setBranch] = useState('');
  const [customCmd, setCustomCmd] = useState('');
  const [accountChoice, setAccountChoice] = useState<string>('global');
  const [busy, setBusy] = useState(false);

  const claudeAccounts = useClaude((s) => s.accounts);
  const globalSlug = useSettings((s) => s.claudeAccountSlug);
  useEffect(() => {
    void useClaude.getState().loadAccounts();
  }, []);

  // Only offer what this machine can actually run — a card you can't launch
  // is noise, not information. Custom CLI stays: any command goes there.
  const installed = useMemo(() => agents.filter((a) => a.installed), [agents]);

  const isCustom = agentId === 'custom';
  const preset = agents.find((a) => a.id === agentId);
  const isClaude = preset?.id === 'claude';
  const canWorktree = !prefill?.cwd && git?.isRepo && active;

  // Resolve which profile this launch should use: an explicit per-session
  // choice, otherwise the global default from Settings.
  const effectiveSlug = accountChoice === 'global' ? (globalSlug ?? 'system') : accountChoice;
  const effectiveAccount = claudeAccounts.find((a) => a.slug === effectiveSlug);

  const launch = async () => {
    if (busy) return;
    let command = '';
    let args: string[] = [];
    if (isCustom) {
      const parts = customCmd.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        toast('Enter a command to run', 'error');
        return;
      }
      command = parts[0];
      args = parts.slice(1);
    } else if (preset) {
      command = preset.command;
    } else {
      return;
    }

    setBusy(true);
    let targetCwd = cwd.trim() || '~';
    if (useWorktree && branch.trim() && active) {
      try {
        const res = await api.post<{ path: string }>('/api/git/worktree', {
          repoPath: active.path,
          name: branch.trim(),
        });
        targetCwd = res.path;
        bumpWorktrees();
        toast(`Worktree ready at ${res.path}`, 'success');
      } catch (err) {
        toast(String(err), 'error');
        setBusy(false);
        return;
      }
    }

    // A typed-in command is exactly what the user wrote and nothing else. A
    // chosen preset goes through spawnAgent so its args, env and standing
    // system prompt come along — the dialog used to drop all three.
    const accountEnv =
      isClaude && effectiveAccount && !effectiveAccount.isSystem
        ? { CLAUDE_CONFIG_DIR: effectiveAccount.configDir }
        : undefined;

    if (isCustom || !preset) {
      spawnSession({
        command,
        args,
        cwd: targetCwd,
        title: baseName(command),
        projectId: active?.id,
        prompt: prompt.trim() || undefined,
        promptMode: 'type',
        env: accountEnv,
      });
    } else {
      spawnAgent(preset, {
        cwd: targetCwd,
        projectId: active?.id,
        task: prompt.trim() || undefined,
        systemText: preset.systemPrompt,
        env: accountEnv,
      });
    }
    setBusy(false);
    onClose();
  };

  return (
    <Modal title="New agent session" onClose={onClose} width={560}>
      <div className="agent-grid">
        {installed.map((a) => (
          <button
            key={a.id}
            className={cls('agent-card', agentId === a.id && 'agent-card-active')}
            onClick={() => setAgentId(a.id)}
            title={a.resolvedPath ?? a.command}
          >
            <span className="agent-badge" style={{ background: a.color }}>
              {hasAgentLogo(a.id) ? <AgentLogo agentId={a.id} size={13} /> : a.name[0]}
            </span>
            <span className="agent-card-name">{a.name}</span>
            <span className="agent-card-desc">{a.description}</span>
          </button>
        ))}
        <button
          className={cls('agent-card', isCustom && 'agent-card-active')}
          onClick={() => setAgentId('custom')}
        >
          <span className="agent-badge agent-badge-custom"><IconPlus size={13} /></span>
          <span className="agent-card-name">Custom CLI</span>
          <span className="agent-card-desc">any agent command</span>
        </button>
      </div>

      {isCustom && (
        <label className="field">
          <span className="field-label">Command</span>
          <input
            className="field-input"
            placeholder="e.g. claude --dangerously-skip-permissions"
            value={customCmd}
            onChange={(e) => setCustomCmd(e.target.value)}
            autoFocus
          />
        </label>
      )}

      {isClaude && (
        <label className="field">
          <span className="field-label">Claude account</span>
          <select className="field-input" value={accountChoice} onChange={(e) => setAccountChoice(e.target.value)}>
            <option value="global">
              Default — {claudeAccounts.find((a) => a.slug === (globalSlug ?? 'system'))?.name ?? 'Default'}
            </option>
            {claudeAccounts.map((a) => (
              <option key={a.slug} value={a.slug} disabled={!a.hasCredentials}>
                {a.name}{a.hasCredentials ? '' : ' — not signed in'}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span className="field-label">Working directory</span>
        <input
          className="field-input"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          disabled={useWorktree}
          spellCheck={false}
        />
      </label>

      {canWorktree && (
        <div className="field-row">
          <label className="field-check">
            <input
              type="checkbox"
              checked={useWorktree}
              onChange={(e) => setUseWorktree(e.target.checked)}
            />
            <span>Run in a new git worktree</span>
          </label>
          {useWorktree && (
            <input
              className="field-input"
              placeholder="branch name, e.g. feat/login-fix"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>
      )}

      {!isCustom && agentId !== 'shell' && (
        <label className="field">
          <span className="field-label">Initial prompt <em>(optional)</em></span>
          <textarea
            className="field-input field-textarea"
            rows={3}
            placeholder="Kick the agent off with a task…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-accent"
          onClick={launch}
          disabled={busy || (useWorktree && !branch.trim())}
        >
          {busy ? 'Preparing…' : 'Launch agent'}
        </button>
      </div>
    </Modal>
  );
}
