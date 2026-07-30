import { useEffect, useRef, useState } from 'react';
import {
  useClaude,
  headlinePercent,
  usageRows,
  type ClaudeAccount,
  type UsageWindow,
} from '../store/claude';
import { useSettings } from '../store/settings';
import { useAgents } from '../store/agents';
import { useProjects } from '../store/projects';
import { useUi } from '../store/ui';
import { spawnSession } from '../lib/spawn';
import { cls } from '../lib/utils';
import { AgentLogo } from './AgentLogos';
import { IconCheck, IconChevronDown, IconPlus, IconRefresh, IconX } from './Icons';

/* Thresholds follow the app's colour philosophy: neutral until it needs you,
   amber at 70% ("keep an eye on it"), red at 90% ("act"). */
function levelOf(p: number | null): '' | 'cu-warn' | 'cu-danger' {
  if (p === null) return '';
  if (p >= 90) return 'cu-danger';
  if (p >= 70) return 'cu-warn';
  return '';
}

function pctOf(w: UsageWindow | null | undefined): number | null {
  return w?.utilization == null ? null : Math.round(w.utilization);
}

function fmtResetIn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'any moment';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export function prettySubscription(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.replace(/^claude[_-]/i, '').replace(/_/g, ' ');
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Sign-in runs the real `claude /login` flow in a pane, pointed at the chosen
 * profile through CLAUDE_CONFIG_DIR. Eaon deliberately does not mint tokens
 * itself: that would mean presenting Claude Code's OAuth client identity to
 * Anthropic from a different application. Letting Claude Code own the dance
 * means Eaon only ever reads credentials that Claude Code wrote.
 */
export function signInToClaude(account: { name: string; configDir: string; slug: string; isSystem: boolean }): boolean {
  const agents = useAgents.getState();
  const claude = agents.byId('claude');
  const shell = agents.byId('shell');
  const projects = useProjects.getState();
  const active = projects.projects.find((p) => p.id === projects.activeId) ?? null;
  // The system account is Claude Code's own default, so it needs no override.
  const env = account.isSystem ? undefined : { CLAUDE_CONFIG_DIR: account.configDir };
  const title = `Claude sign-in — ${account.name}`;

  if (claude?.installed) {
    spawnSession({
      command: claude.command,
      args: ['/login'],
      cwd: active?.path ?? '~',
      title,
      agentId: 'claude',
      projectId: active?.id,
      env,
    });
  } else if (shell?.installed) {
    spawnSession({
      command: shell.command,
      args: ['-l'],
      cwd: active?.path ?? '~',
      title,
      agentId: 'shell',
      projectId: active?.id,
      env,
      prompt: 'claude /login',
      promptMode: 'type',
    });
  } else {
    return false;
  }
  useClaude.getState().watchForLogin(account.slug);
  return true;
}

export function ClaudeUsagePill() {
  const show = useSettings((s) => s.showClaudeUsage);
  if (!show) return null;
  return <Pill />;
}

function Pill() {
  const usage = useClaude((s) => s.usage);
  const usageError = useClaude((s) => s.usageError);
  const mode = useSettings((s) => s.usageMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const used = headlinePercent(usage);
  const level = levelOf(used);
  const frac = Math.min(1, (used ?? 0) / 100);
  const C = 2 * Math.PI * 7;
  const rows = usageRows(usage);
  const week = rows.find((r) => r.label === 'This week')?.percent ?? null;
  // "Remaining" inverts the number but never the ring: the ring always shows
  // consumption, so a filling ring means the same thing in either mode.
  const shown = used === null ? null : mode === 'remaining' ? 100 - used : used;

  return (
    <div className="template-menu" ref={ref}>
      <button
        className={cls('btn btn-sm cu-pill', level, usageError && 'cu-err-pill')}
        onClick={() => setOpen((v) => !v)}
        title={
          usageError
            ? `Claude usage — ${usageError.error}`
            : `Claude usage — session ${used ?? '…'}% used${week != null ? ` · week ${Math.round(week)}%` : ''}`
        }
      >
        <svg className="cu-ring" width="16" height="16" viewBox="0 0 18 18" aria-hidden>
          <circle className="cu-ring-track" cx="9" cy="9" r="7" />
          <circle
            className="cu-ring-fill"
            cx="9"
            cy="9"
            r="7"
            strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`}
            transform="rotate(-90 9 9)"
          />
        </svg>
        <span className="cu-pill-pct">{usageError ? '!' : shown === null ? '…' : `${shown}%`}</span>
      </button>
      {open && <UsagePanel close={() => setOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function UsagePanel({ close }: { close: () => void }) {
  const usage = useClaude((s) => s.usage);
  const loading = useClaude((s) => s.usageLoading);
  const usageError = useClaude((s) => s.usageError);
  const accounts = useClaude((s) => s.accounts);
  const loadUsage = useClaude((s) => s.loadUsage);
  const slug = useSettings((s) => s.claudeAccountSlug) ?? 'system';
  const mode = useSettings((s) => s.usageMode);
  const [switching, setSwitching] = useState(false);
  const account = accounts.find((a) => a.slug === slug);
  const rows = usageRows(usage);
  const badge = prettySubscription(account?.subscriptionType ?? usage?.account?.subscriptionType);

  return (
    <div className="dropdown cu-panel">
      <div className="cu-head">
        <button className="cu-account" onClick={() => setSwitching((v) => !v)} title="Switch Claude account">
          <AgentLogo agentId="claude" size={15} />
          <span className="cu-account-name">{account?.name ?? 'Claude'}</span>
          {badge && <span className="cu-badge">{badge}</span>}
          <IconChevronDown size={12} />
        </button>
        <button
          className={cls('icon-btn icon-btn-sm', loading && 'cu-spin')}
          onClick={() => void loadUsage(true)}
          title="Refresh usage"
          disabled={loading}
        >
          <IconRefresh size={13} />
        </button>
      </div>

      {switching && <AccountSwitcher onDone={() => setSwitching(false)} />}

      <div className="cu-body">
        {usageError ? (
          <SignInPrompt account={account} error={usageError} />
        ) : !usage ? (
          <div className="cu-skel" aria-hidden>
            <i /><i />
          </div>
        ) : (
          <>
            {rows.length === 0 && <div className="cu-note-text">No limits reported for this plan.</div>}
            {rows.map((r) => (
              <UsageRow key={r.label} label={r.label} percent={r.percent} resetsAt={r.resets_at} mode={mode} />
            ))}
            <div className="cu-foot">Updated {fmtAgo(usage.fetchedAt)}</div>
          </>
        )}
      </div>
    </div>
  );
}

function UsageRow({
  label,
  percent,
  resetsAt,
  mode,
}: {
  label: string;
  percent: number | null;
  resetsAt: string | null;
  mode: 'used' | 'remaining';
}) {
  const used = percent === null ? null : Math.round(percent);
  const reset = fmtResetIn(resetsAt);
  const level = levelOf(used);
  // The bar always shows consumption; only the number follows the preference.
  const shown = used === null ? null : mode === 'remaining' ? 100 - used : used;
  return (
    <div className="cu-row">
      <div className="cu-row-head">
        <span className="cu-row-label">{label}</span>
        <span className={cls('cu-row-pct', level)}>{shown === null ? '—' : `${shown}%`}</span>
      </div>
      <div className="cu-track">
        <div className={cls('cu-fill', level)} style={{ width: `${Math.min(100, used ?? 0)}%` }} />
      </div>
      {reset && <div className="cu-row-sub">Resets in {reset}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The failure state, made actionable. Both real causes — never signed in, and
 * a token that has aged out — are fixed by the same one click, so offer it
 * instead of telling the reader to go run a command themselves.
 */
function SignInPrompt({
  account,
  error,
}: {
  account: ClaudeAccount | undefined;
  error: { code: string; error: string };
}) {
  const toast = useUi((s) => s.toast);
  const loadUsage = useClaude((s) => s.loadUsage);
  const recoverable = error.code === 'no-credentials' || error.code === 'auth-expired';

  const title =
    error.code === 'no-credentials'
      ? 'Not signed in to Claude'
      : error.code === 'auth-expired'
        ? 'Claude sign-in expired'
        : 'Usage unavailable';

  return (
    <div className="cu-note cu-note-err">
      <div className="cu-note-title">{title}</div>
      <div className="cu-note-text">
        {recoverable
          ? 'Signing in opens a Claude pane and finishes in your browser. Usage starts updating on its own once it completes.'
          : error.error}
      </div>
      <div className="cu-note-actions">
        {recoverable && account && (
          <button
            className="btn btn-accent btn-sm"
            onClick={() => {
              if (signInToClaude(account)) {
                toast('Finish signing in to Claude in the new pane', 'success');
              } else {
                toast('Claude Code is not installed — install it and try again', 'error');
              }
            }}
          >
            <AgentLogo agentId="claude" size={13} /> Sign in with Claude
          </button>
        )}
        <button className="btn btn-sm" onClick={() => void loadUsage(true)}>
          <IconRefresh size={12} /> Retry
        </button>
      </div>
    </div>
  );
}

function AccountSwitcher({ onDone }: { onDone: () => void }) {
  const accounts = useClaude((s) => s.accounts);
  const slug = useSettings((s) => s.claudeAccountSlug) ?? 'system';
  const setClaudeAccount = useSettings((s) => s.setClaudeAccount);
  const [adding, setAdding] = useState(false);

  return (
    <div className="cu-switch">
      <div className="dropdown-label">New Claude sessions use</div>
      {accounts.map((a) => (
        <button
          key={a.slug}
          className="dropdown-item"
          onClick={() => {
            setClaudeAccount(a.isSystem ? null : a.slug);
            onDone();
          }}
        >
          <span className={cls('cu-check', slug === a.slug && 'cu-check-on')}>
            {slug === a.slug && <IconCheck size={11} />}
          </span>
          <span className="cu-switch-name">{a.name}</span>
          {!a.hasCredentials && <span className="cu-dim">not signed in</span>}
          {a.isSystem && <span className="cu-dim">~/.claude</span>}
        </button>
      ))}
      {adding ? (
        <AddAccountForm onDone={onDone} onCancel={() => setAdding(false)} />
      ) : (
        <button className="dropdown-item" onClick={() => setAdding(true)}>
          <span className="cu-check"><IconPlus size={11} /></span>
          <span className="cu-switch-name">Add account…</span>
        </button>
      )}
    </div>
  );
}

export function AddAccountForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const addAccount = useClaude((s) => s.addAccount);
  const watchForLogin = useClaude((s) => s.watchForLogin);
  const toast = useUi((s) => s.toast);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const account = await addAccount(trimmed);
      const claude = useAgents.getState().byId('claude');
      const shell = useAgents.getState().byId('shell');
      // Signing in is an interactive OAuth dance, so it happens in a real
      // pane pointed at the new profile via CLAUDE_CONFIG_DIR.
      if (claude?.installed) {
        spawnSession({
          command: claude.command,
          args: ['/login'],
          cwd: active?.path ?? '~',
          title: `Claude login — ${account.name}`,
          agentId: 'claude',
          projectId: active?.id,
          env: { CLAUDE_CONFIG_DIR: account.configDir },
        });
      } else if (shell?.installed) {
        spawnSession({
          command: shell.command,
          args: ['-l'],
          cwd: active?.path ?? '~',
          title: `Claude login — ${account.name}`,
          agentId: 'shell',
          projectId: active?.id,
          env: { CLAUDE_CONFIG_DIR: account.configDir },
          prompt: 'claude /login',
          promptMode: 'type',
        });
      }
      watchForLogin(account.slug);
      toast(`Finish signing in as "${account.name}" in the new pane`, 'success');
      onDone();
    } catch (err) {
      toast(String(err instanceof Error ? err.message : err), 'error');
      setBusy(false);
    }
  };

  return (
    <div className="cu-add">
      <input
        className="field-input"
        placeholder="Account name, e.g. Work"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') onCancel?.();
        }}
        autoFocus
        maxLength={40}
        spellCheck={false}
      />
      <button className="btn btn-accent btn-sm" onClick={() => void submit()} disabled={!name.trim() || busy}>
        {busy ? '…' : 'Add'}
      </button>
      {onCancel && (
        <button className="icon-btn icon-btn-sm" onClick={onCancel} title="Cancel">
          <IconX size={13} />
        </button>
      )}
    </div>
  );
}
