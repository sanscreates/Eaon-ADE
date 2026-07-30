import { useEffect, useState } from 'react';
import { useAgents } from '../store/agents';
import { useUi } from '../store/ui';
import { api } from '../lib/api';
import { cls } from '../lib/utils';
import type { AgentPreset } from '../lib/types';
import { AgentLogo, hasAgentLogo } from './AgentLogos';
import { IconChevronDown, IconChevronRight, IconPlus, IconRefresh, IconTrash, IconX } from './Icons';

/* ═══════════════════════════════════════════════════════════════════════════
   Agent configuration.

   Two things live here that the detection list alone could never express: a
   standing system prompt per agent, and agents the app has never heard of.
   Both write to ~/.eaon/agents.json — machine-local, because which CLIs exist
   and where they are is a property of this laptop, not of the repo.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Split a command line into argv, honouring quotes. Good enough for flags. */
export function parseArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    out.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return out;
}

/** Re-quote argv for display, so a round trip through the field is stable. */
export function formatArgs(args: string[] | undefined): string {
  return (args ?? []).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="ae-field">
      <span className="ae-field-label">{label}</span>
      {children}
      {hint && <span className="ae-field-hint">{hint}</span>}
    </label>
  );
}

export function AgentEditor() {
  const agents = useAgents((s) => s.agents);
  const loaded = useAgents((s) => s.loaded);
  const configLoaded = useAgents((s) => s.configLoaded);
  const saving = useAgents((s) => s.saving);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!configLoaded) void useAgents.getState().loadConfig();
  }, [configLoaded]);

  const visible = agents.filter((a) => !a.hidden);
  const hidden = agents.filter((a) => a.hidden);

  return (
    <>
      <div className="st-group-label">
        Agents{saving ? ' · saving…' : ''}
      </div>
      <div className="st-group ae-list">
        {!loaded && <div className="st-agent-row"><span className="st-agent-cmd">Detecting…</span></div>}
        {visible.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            open={openId === agent.id}
            onToggle={() => setOpenId((id) => (id === agent.id ? null : agent.id))}
          />
        ))}
      </div>

      {hidden.length > 0 && (
        <>
          <div className="st-group-label">Hidden</div>
          <div className="st-group">
            {hidden.map((agent) => (
              <div key={agent.id} className="st-agent-row">
                <span className="agent-badge" style={{ background: agent.color }}>
                  {agent.name[0]}
                </span>
                <div className="st-agent-main">
                  <div className="st-agent-name">{agent.name}</div>
                  <div className="st-agent-cmd">{agent.command}</div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => void useAgents.getState().setOverride(agent.id, { hidden: false })}
                >
                  Show
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="st-group-label">Add your own</div>
      <div className="st-group">
        {adding ? (
          <NewAgentForm onDone={() => setAdding(false)} />
        ) : (
          <button className="ae-add" onClick={() => setAdding(true)}>
            <IconPlus size={13} /> Add a custom agent…
          </button>
        )}
      </div>
    </>
  );
}

function AgentRow({
  agent,
  open,
  onToggle,
}: {
  agent: AgentPreset;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={cls('ae-row', open && 'ae-row-open')}>
      <button className="ae-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="ae-chev">{open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}</span>
        <span className="agent-badge" style={{ background: agent.color }}>
          {hasAgentLogo(agent.id) ? <AgentLogo agentId={agent.id} size={13} /> : agent.name[0]}
        </span>
        <span className="ae-row-main">
          <span className="ae-row-name">
            {agent.name}
            {!agent.builtin && <em className="ae-tag">custom</em>}
            {agent.systemPrompt.trim() && <em className="ae-tag ae-tag-accent">prompt</em>}
          </span>
          <span className="ae-row-cmd">{agent.resolvedPath ?? agent.command}</span>
        </span>
        <span className={cls('st-agent-status', agent.installed ? 'st-agent-ok' : 'st-agent-missing')}>
          {agent.installed ? 'installed' : 'not found'}
        </span>
      </button>
      {open && <AgentForm agent={agent} />}
    </div>
  );
}

function AgentForm({ agent }: { agent: AgentPreset }) {
  const toast = useUi((s) => s.toast);
  const [command, setCommand] = useState(agent.command);
  const [args, setArgs] = useState(formatArgs(agent.args));
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [promptFlag, setPromptFlag] = useState(agent.systemPromptFlag);
  const [probe, setProbe] = useState<string | null | undefined>(undefined);

  // Re-seed when the agent object changes underneath us (a save round-trip).
  useEffect(() => {
    setCommand(agent.command);
    setArgs(formatArgs(agent.args));
    setSystemPrompt(agent.systemPrompt);
    setPromptFlag(agent.systemPromptFlag);
  }, [agent.command, agent.systemPrompt, agent.systemPromptFlag, agent.args]);

  // Live "does this exist" check, debounced so typing a path is not a flood.
  useEffect(() => {
    const value = command.trim();
    if (!value) {
      setProbe(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ resolved: string | null }>(`/api/agents/probe?command=${encodeURIComponent(value)}`)
        .then((r) => setProbe(r.resolved))
        .catch(() => setProbe(undefined));
    }, 300);
    return () => clearTimeout(timer);
  }, [command]);

  const dirty =
    command !== agent.command ||
    args !== formatArgs(agent.args) ||
    systemPrompt !== agent.systemPrompt ||
    promptFlag !== agent.systemPromptFlag;

  const save = async () => {
    const store = useAgents.getState();
    const patch = {
      command: command.trim(),
      args: parseArgs(args),
      systemPrompt,
      systemPromptFlag: promptFlag.trim(),
    };
    if (agent.builtin) await store.setOverride(agent.id, patch);
    else await store.updateCustom(agent.id, patch);
    toast(`${agent.name} updated`, 'success');
  };

  return (
    <div className="ae-form">
      <Field label="Command" hint={
        probe === undefined
          ? 'Checking…'
          : probe
            ? `Resolves to ${probe}`
            : 'Not found on PATH — the agent will fail to start'
      }>
        <input
          className="ae-input"
          value={command}
          spellCheck={false}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="claude"
        />
      </Field>

      <Field label="Arguments" hint="Passed before any task. Quote values containing spaces.">
        <input
          className="ae-input ae-mono"
          value={args}
          spellCheck={false}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="--model opus"
        />
      </Field>

      <Field
        label="System prompt"
        hint="Standing instruction sent with every task this agent is given, on top of any swarm role charter."
      >
        <textarea
          className="ae-input ae-textarea"
          value={systemPrompt}
          rows={4}
          spellCheck={false}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Always run the test suite before saying you are done."
        />
      </Field>

      <Field
        label="System prompt flag"
        hint={
          promptFlag.trim()
            ? 'Passed as a flag at launch, so it never costs a message.'
            : 'Empty: the instruction is folded into the first message instead. Works with every CLI.'
        }
      >
        <input
          className="ae-input ae-mono"
          value={promptFlag}
          spellCheck={false}
          onChange={(e) => setPromptFlag(e.target.value)}
          placeholder="--append-system-prompt"
        />
      </Field>

      <div className="ae-actions">
        {agent.builtin ? (
          <button
            className="btn btn-sm"
            onClick={() => void useAgents.getState().setOverride(agent.id, { hidden: true })}
          >
            Hide
          </button>
        ) : (
          <button
            className="btn btn-sm btn-danger"
            onClick={() =>
              useUi.getState().askConfirm({
                title: `Delete ${agent.name}?`,
                body: 'The custom agent is removed. Swarm seats using it fall back to the default agent.',
                confirmLabel: 'Delete',
                danger: true,
                onConfirm: () => void useAgents.getState().removeCustom(agent.id),
              })
            }
          >
            <IconTrash size={12} /> Delete
          </button>
        )}
        {agent.builtin && (
          <button
            className="btn btn-sm"
            onClick={() => void useAgents.getState().clearOverride(agent.id)}
            title="Forget every change made to this built-in"
          >
            <IconRefresh size={12} /> Reset
          </button>
        )}
        <span className="ae-spacer" />
        <button className="btn btn-sm btn-accent" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}

function NewAgentForm({ onDone }: { onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptMode, setPromptMode] = useState<'arg' | 'type'>('type');

  const canSave = name.trim().length > 0 && command.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    await useAgents.getState().addCustom({
      name: name.trim(),
      command: command.trim(),
      args: parseArgs(args),
      systemPrompt,
      promptMode,
      description: 'Custom agent',
    });
    toast(`Added ${name.trim()}`, 'success');
    onDone();
  };

  return (
    <div className="ae-form ae-form-new">
      <Field label="Name">
        <input
          className="ae-input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="My Agent"
        />
      </Field>
      <Field label="Command" hint="Anything on PATH, or an absolute path to a script.">
        <input
          className="ae-input ae-mono"
          value={command}
          spellCheck={false}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="/usr/local/bin/my-agent"
        />
      </Field>
      <Field label="Arguments">
        <input
          className="ae-input ae-mono"
          value={args}
          spellCheck={false}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="--interactive"
        />
      </Field>
      <Field
        label="How it takes a first prompt"
        hint={
          promptMode === 'arg'
            ? 'Appended to the command line, like `my-agent "do the thing"`.'
            : 'Typed into the terminal once it is up. The safe default.'
        }
      >
        <div className="ap-seg" role="group">
          {(['type', 'arg'] as const).map((mode) => (
            <button
              key={mode}
              className={cls('ap-seg-item', promptMode === mode && 'ap-seg-item-active')}
              onClick={() => setPromptMode(mode)}
              aria-pressed={promptMode === mode}
            >
              {mode === 'type' ? 'Typed' : 'Argument'}
            </button>
          ))}
        </div>
      </Field>
      <Field label="System prompt" hint="Optional. Sent with every task this agent is given.">
        <textarea
          className="ae-input ae-textarea"
          value={systemPrompt}
          rows={3}
          spellCheck={false}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </Field>
      <div className="ae-actions">
        <button className="btn btn-sm" onClick={onDone}>
          <IconX size={12} /> Cancel
        </button>
        <span className="ae-spacer" />
        <button className="btn btn-sm btn-accent" disabled={!canSave} onClick={() => void save()}>
          Add agent
        </button>
      </div>
    </div>
  );
}
