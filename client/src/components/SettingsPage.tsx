import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useSettings, SettingsSection, SessionPlacement } from '../store/settings';
import { useAgents } from '../store/agents';
import { useProjects } from '../store/projects';
import { useSessions } from '../store/sessions';
import { useUi } from '../store/ui';
import { useConnection } from '../lib/bootstrap';
import { useClaude } from '../store/claude';
import { buildXtermTheme } from '../lib/theme';
import { api } from '../lib/api';
import { requestCloseSession } from '../lib/spawn';
import {
  notificationPermission,
  playChime,
  requestNotificationPermission,
} from '../lib/notify';
import { AddAccountForm } from './ClaudeUsage';
import { AppearancePanel } from './AppearancePanel';
import { AgentEditor } from './AgentEditor';
import { AgentLogo, hasAgentLogo } from './AgentLogos';
import { useUpdates } from '../store/updates';
import { cls, timeAgo } from '../lib/utils';
import type { TerminalCursorStyle } from '../lib/terminals';
import {
  IconBell,
  IconBoard,
  IconChevronDown,
  IconCode,
  IconCpu,
  IconDatabase,
  IconGitBranch,
  IconInfo,
  IconKeyboard,
  IconMinus,
  IconPalette,
  IconPlus,
  IconSliders,
  IconStack,
  IconTerminal,
  IconVolume,
  IconX,
  Logo,
} from './Icons';

const APP_VERSION = '0.1.0';

export function SettingsPage() {
  const open = useSettings((s) => s.open);
  if (!open) return null;
  return <SettingsInner />;
}

function SettingsInner() {
  const section = useSettings((s) => s.section);
  const setSection = useSettings((s) => s.setSection);
  const close = useSettings((s) => s.closeSettings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A dialog or the palette sits above settings; let it take the Esc.
      if (document.querySelector('.modal-overlay, .palette-overlay')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const NAV: { id: SettingsSection; label: string; icon: ReactNode }[] = [
    { id: 'general', label: 'General', icon: <IconSliders size={15} /> },
    { id: 'appearance', label: 'Appearance', icon: <IconPalette size={15} /> },
    { id: 'terminal', label: 'Terminal', icon: <IconTerminal size={15} /> },
    { id: 'editor', label: 'Editor', icon: <IconCode size={15} /> },
    { id: 'agents', label: 'Agents', icon: <IconCpu size={15} /> },
    { id: 'sessions', label: 'Sessions', icon: <IconStack size={15} /> },
    { id: 'board', label: 'Board', icon: <IconBoard size={15} /> },
    { id: 'git', label: 'Git', icon: <IconGitBranch size={15} /> },
    { id: 'notifications', label: 'Notifications', icon: <IconBell size={15} /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <IconKeyboard size={15} /> },
    { id: 'data', label: 'Data & Storage', icon: <IconDatabase size={15} /> },
    { id: 'about', label: 'About', icon: <IconInfo size={15} /> },
  ];

  return (
    <div className="st-overlay" role="dialog" aria-label="Settings">
      <header className="st-head">
        <div className="st-title">Settings</div>
        <div className="st-head-right">
          <kbd>esc</kbd>
          <button className="icon-btn" onClick={close} aria-label="Close settings">
            <IconX size={16} />
          </button>
        </div>
      </header>
      <div className="st-shell">
        <nav className="st-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={cls('st-nav-item', section === item.id && 'st-nav-item-active')}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <div className="st-nav-foot">Eaon ADE v{APP_VERSION}</div>
        </nav>
        <div className="st-content">
          {section === 'general' && <GeneralSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'terminal' && <TerminalSection />}
          {section === 'editor' && <EditorSection />}
          {section === 'agents' && <AgentsSection />}
          {section === 'sessions' && <SessionsSection />}
          {section === 'board' && <BoardSection />}
          {section === 'git' && <GitSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'data' && <DataSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* controls                                                           */

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-text">
        <div className="st-row-label">{label}</div>
        {hint && <div className="st-row-hint">{hint}</div>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={cls('st-switch', on && 'st-switch-on')}
      onClick={() => onChange(!on)}
    />
  );
}

function Stepper({
  value,
  unit,
  min,
  max,
  step = 1,
  format,
  onChange,
  label,
}: {
  value: number;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="st-stepper" aria-label={label}>
      <button className="st-step-btn" disabled={value <= min} onClick={() => onChange(value - step)} aria-label="Decrease">
        <IconMinus size={12} />
      </button>
      <span className="st-step-val">{format ? format(value) : value}</span>
      {unit && <span className="st-step-unit">{unit}</span>}
      <button className="st-step-btn" disabled={value >= max} onClick={() => onChange(value + step)} aria-label="Increase">
        <IconPlus size={12} />
      </button>
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="ap-seg" role="group">
      {options.map((o) => (
        <button
          key={o.id}
          className={cls('ap-seg-item', value === o.id && 'ap-seg-item-active')}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="st-select-wrap">
      <select className="st-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {children}
      </select>
      <IconChevronDown size={13} />
    </span>
  );
}

/** The 0–100 volume slider: accent fill up to the thumb, track after it. */
function Slider({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className={cls('st-slider-wrap', disabled && 'st-slider-disabled')}>
      <input
        type="range"
        className="st-slider"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        style={{
          background: `linear-gradient(to right, var(--accent) ${value}%, var(--surface-active) ${value}%)`,
        }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="st-slider-val">{value}%</span>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* general                                                            */

function GeneralSection() {
  const sessionPlacement = useSettings((s) => s.sessionPlacement);
  const setSessionPlacement = useSettings((s) => s.setSessionPlacement);

  return (
    <>
      <h2 className="st-section-head">General</h2>
      <p className="st-section-sub">How panes and sessions behave across the whole app.</p>
      <div className="st-group-label">Panes</div>
      <div className="st-group">
        <Row
          label="New session placement"
          hint="Smart reuses an empty pane before splitting; Always split gives every new session its own pane."
        >
          <Seg<SessionPlacement>
            value={sessionPlacement}
            options={[
              { id: 'smart', label: 'Smart' },
              { id: 'split', label: 'Always split' },
            ]}
            onChange={setSessionPlacement}
          />
        </Row>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* appearance                                                         */

function AppearanceSection() {
  return (
    <AppearancePanel>
      <ClaudeGroup />
    </AppearancePanel>
  );
}

/* ---------------------------------------------------------------- */
/* claude                                                             */

function ClaudeGroup() {
  const showClaudeUsage = useSettings((s) => s.showClaudeUsage);
  const setShowClaudeUsage = useSettings((s) => s.setShowClaudeUsage);
  const claudeAccountSlug = useSettings((s) => s.claudeAccountSlug);
  const setClaudeAccount = useSettings((s) => s.setClaudeAccount);
  const accounts = useClaude((s) => s.accounts);
  const loadAccounts = useClaude((s) => s.loadAccounts);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  return (
    <section className="ap-card">
      <div className="ap-card-head ap-card-head-static">
        <span className="ap-card-icon"><IconCpu size={14} /></span>
        <span className="ap-card-title">Claude</span>
      </div>
      <div className="ap-card-body">
        <div className="ap-row">
          <div className="ap-row-text">
            <div className="ap-row-label">Show Claude token usage</div>
            <div className="ap-row-hint">Live rate-limit bars in the top bar — current session and weekly, straight from your account.</div>
          </div>
          <div className="ap-row-control">
            <Switch on={showClaudeUsage} onChange={setShowClaudeUsage} label="Toggle Claude token usage" />
          </div>
        </div>
        <div className="ap-row">
          <div className="ap-row-text">
            <div className="ap-row-label">Claude account</div>
            <div className="ap-row-hint">New Claude sessions sign in with this account; the usage bars follow it too.</div>
          </div>
          <div className="ap-row-control">
            <Select
              value={claudeAccountSlug ?? 'system'}
              onChange={(v) => setClaudeAccount(v === 'system' ? null : v)}
              label="Claude account"
            >
              {accounts.length === 0 && <option value="system">Default</option>}
              {accounts.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name}{a.isSystem ? ' (~/.claude)' : ''}{a.hasCredentials ? '' : ' — not signed in'}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {adding ? (
          <div className="cu-add-account">
            <AddAccountForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
          </div>
        ) : (
          <button className="cu-add-account-btn" onClick={() => setAdding(true)}>
            <IconPlus size={12} /> Add a Claude account…
          </button>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* terminal                                                           */

function TerminalSection() {
  const fontSize = useSettings((s) => s.terminalFontSize);
  const setFontSize = useSettings((s) => s.setTerminalFontSize);
  const cursorStyle = useSettings((s) => s.terminalCursorStyle);
  const setCursorStyle = useSettings((s) => s.setTerminalCursorStyle);
  const cursorBlink = useSettings((s) => s.terminalCursorBlink);
  const setCursorBlink = useSettings((s) => s.setTerminalCursorBlink);
  const scrollback = useSettings((s) => s.terminalScrollback);
  const setScrollback = useSettings((s) => s.setTerminalScrollback);
  const theme = useSettings((s) => s.theme);
  const ansi = useMemo(() => buildXtermTheme(), [theme]);

  return (
    <>
      <h2 className="st-section-head">Terminal</h2>
      <p className="st-section-sub">Applies to every pane, live — no restart needed.</p>
      <div className="st-group">
        <Row label="Font size" hint="Zoom shortcuts work anywhere: ⌘+ larger, ⌘− smaller, ⌘0 reset.">
          <Stepper value={fontSize} unit="px" min={9} max={24} onChange={setFontSize} label="Terminal font size" />
        </Row>
        <Row label="Cursor style" hint="The caret shape in every terminal.">
          <Seg<TerminalCursorStyle>
            value={cursorStyle}
            options={[
              { id: 'bar', label: 'Bar' },
              { id: 'block', label: 'Block' },
              { id: 'underline', label: 'Underline' },
            ]}
            onChange={setCursorStyle}
          />
        </Row>
        <Row label="Cursor blink" hint="A steady caret is easier on the eyes during long reads.">
          <Switch on={cursorBlink} onChange={setCursorBlink} label="Toggle cursor blink" />
        </Row>
        <Row
          label="Scrollback"
          hint="Lines kept above the fold per pane. Lowering this trims the oldest lines immediately."
        >
          <Stepper
            value={scrollback}
            min={1000}
            max={20000}
            step={1000}
            format={(v) => `${v / 1000}k`}
            onChange={setScrollback}
            label="Terminal scrollback lines"
          />
        </Row>
        <Row label="Colours" hint="The ANSI palette follows the app theme, so agent output always matches the chrome.">
          <span />
        </Row>
        <div className="st-ansi" aria-hidden>
          {[ansi.red, ansi.green, ansi.yellow, ansi.blue, ansi.magenta, ansi.cyan].map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
          {[ansi.brightRed, ansi.brightGreen, ansi.brightYellow, ansi.brightBlue, ansi.brightMagenta, ansi.brightCyan].map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* editor                                                             */

function EditorSection() {
  const fontSize = useSettings((s) => s.editorFontSize);
  const setFontSize = useSettings((s) => s.setEditorFontSize);
  const minimap = useSettings((s) => s.editorMinimap);
  const setMinimap = useSettings((s) => s.setEditorMinimap);
  const wordWrap = useSettings((s) => s.editorWordWrap);
  const setWordWrap = useSettings((s) => s.setEditorWordWrap);

  return (
    <>
      <h2 className="st-section-head">Editor</h2>
      <p className="st-section-sub">The Monaco editor in the right panel, including the diff view.</p>
      <div className="st-group">
        <Row label="Font size">
          <Stepper value={fontSize} unit="px" min={10} max={20} onChange={setFontSize} label="Editor font size" />
        </Row>
        <Row label="Minimap" hint="A compressed overview of the file along the right edge.">
          <Switch on={minimap} onChange={setMinimap} label="Toggle minimap" />
        </Row>
        <Row label="Word wrap" hint="Wrap long lines instead of scrolling horizontally.">
          <Switch on={wordWrap} onChange={setWordWrap} label="Toggle word wrap" />
        </Row>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* agents                                                             */

function AgentsSection() {
  const agents = useAgents((s) => s.agents);
  const defaultAgentId = useSettings((s) => s.defaultAgentId);
  const setDefaultAgent = useSettings((s) => s.setDefaultAgent);
  const installed = agents.filter((a) => a.installed && !a.hidden && a.id !== 'shell');

  return (
    <>
      <h2 className="st-section-head">Agents</h2>
      <p className="st-section-sub">
        Which CLIs this machine has, how each one launches, and what standing instruction it
        carries. Expand an agent to give it a system prompt or point it somewhere else.
      </p>
      <div className="st-group">
        <Row label="Default agent" hint="Used when you press ⌥T, click New Agent, or leave a swarm seat on Default.">
          <Select
            value={defaultAgentId ?? 'auto'}
            onChange={(v) => setDefaultAgent(v === 'auto' ? null : v)}
            label="Default agent"
          >
            <option value="auto">Auto</option>
            {installed.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Row>
      </div>
      <AgentEditor />
    </>
  );
}

/* ---------------------------------------------------------------- */
/* sessions                                                           */

const SESSION_STATUS_LABEL: Record<string, string> = {
  spawning: 'starting',
  working: 'working',
  waiting: 'waiting',
  idle: 'idle',
  exited: 'exited',
};

function SessionsSection() {
  const replayScrollback = useSettings((s) => s.replayScrollback);
  const setReplayScrollback = useSettings((s) => s.setReplayScrollback);
  const sessions = useSessions((s) => s.sessions);
  const status = useSessions((s) => s.status);
  const order = useSessions((s) => s.order);
  const byId = useAgents((s) => s.byId);
  const askConfirm = useUi((s) => s.askConfirm);
  const toast = useUi((s) => s.toast);

  const live = order.filter((id) => status[id] && status[id] !== 'exited');
  const exited = order.filter((id) => status[id] === 'exited');

  const closeAll = () => {
    if (order.length === 0) return;
    askConfirm({
      title: 'Close all sessions?',
      body: `Every running session (${live.length}) and its scrollback will be torn down. Panes close too.`,
      confirmLabel: 'Close all',
      danger: true,
      onConfirm: async () => {
        try {
          const res = await api.post<{ closed: number }>('/api/sessions/close-all');
          toast(`Closed ${res.closed} session${res.closed === 1 ? '' : 's'}`, 'success');
        } catch {
          toast('Could not reach the server', 'error');
        }
      },
    });
  };

  return (
    <>
      <h2 className="st-section-head">Sessions</h2>
      <p className="st-section-sub">
        Sessions live on the local server, not this window — refresh or reopen and they keep running.
      </p>
      <div className="st-group">
        <Row
          label="Replay scrollback when re-attaching"
          hint="Reopening a pane replays what the agent printed while you were away. Turn off for a clean screen on every attach."
        >
          <Switch on={replayScrollback} onChange={setReplayScrollback} label="Replay scrollback when re-attaching" />
        </Row>
      </div>

      <div className="st-group-label">
        Running{order.length > 0 && ` · ${live.length} live, ${exited.length} exited`}
      </div>
      <div className="st-group">
        {order.length === 0 && (
          <div className="st-agent-row"><span className="st-agent-cmd">No sessions yet — spawn one with ⌥T.</span></div>
        )}
        {order.map((id) => {
          const meta = sessions[id];
          if (!meta) return null;
          const st = status[id] ?? 'idle';
          const preset = meta.agentId ? byId(meta.agentId) : null;
          return (
            <div key={id} className="st-agent-row">
              <span className="agent-badge" style={{ background: preset?.color ?? 'var(--n-500)' }}>
                {preset && hasAgentLogo(preset.id) ? (
                  <AgentLogo agentId={preset.id} size={13} />
                ) : (
                  (preset?.name ?? meta.title)[0]
                )}
              </span>
              <div className="st-agent-main">
                <div className="st-agent-name">{meta.title}</div>
                <div className="st-agent-cmd">{meta.command}{meta.args.length > 0 ? ` ${meta.args.join(' ')}` : ''}</div>
              </div>
              <span
                className={cls(
                  'st-agent-status',
                  st === 'working' && 'st-agent-default',
                  st === 'waiting' && 'st-pill-waiting',
                  (st === 'idle' || st === 'spawning') && 'st-agent-missing',
                  st === 'exited' && 'st-pill-exited',
                )}
              >
                {SESSION_STATUS_LABEL[st] ?? st}
              </span>
              <button className="icon-btn" title="Close session" onClick={() => requestCloseSession(id)}>
                <IconX size={13} />
              </button>
            </div>
          );
        })}
        {order.length > 0 && (
          <div className="st-row">
            <div className="st-row-text">
              <div className="st-row-label">Close everything</div>
              <div className="st-row-hint">Kills every session on the server and closes their panes.</div>
            </div>
            <div className="st-row-control">
              <button className="btn btn-sm btn-danger" onClick={closeAll}>Close all sessions</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* board                                                              */

function BoardSection() {
  const agents = useAgents((s) => s.agents);
  const dispatchAgentId = useSettings((s) => s.boardDispatchAgentId);
  const setDispatchAgent = useSettings((s) => s.setBoardDispatchAgent);
  const autoProgress = useSettings((s) => s.boardAutoProgress);
  const setAutoProgress = useSettings((s) => s.setBoardAutoProgress);
  const installed = agents.filter((a) => a.installed && a.id !== 'shell');

  return (
    <>
      <h2 className="st-section-head">Board</h2>
      <p className="st-section-sub">The EaonBoard kanban in the right panel.</p>
      <div className="st-group">
        <Row
          label="Default dispatch agent"
          hint="With one picked, the rocket button on a card dispatches straight to it — the chevron beside it still offers every agent."
        >
          <Select
            value={dispatchAgentId ?? 'ask'}
            onChange={(v) => setDispatchAgent(v === 'ask' ? null : v)}
            label="Default dispatch agent"
          >
            <option value="ask">Ask every time</option>
            {installed.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Row>
        <Row
          label="Move card to In Progress on dispatch"
          hint="Turn off to dispatch work without leaving the column the card lives in."
        >
          <Switch on={autoProgress} onChange={setAutoProgress} label="Move card to In Progress on dispatch" />
        </Row>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* git                                                                */

function GitSection() {
  const autoRefresh = useSettings((s) => s.gitAutoRefresh);
  const setAutoRefresh = useSettings((s) => s.setGitAutoRefresh);
  const refreshSeconds = useSettings((s) => s.gitRefreshSeconds);
  const setRefreshSeconds = useSettings((s) => s.setGitRefreshSeconds);

  return (
    <>
      <h2 className="st-section-head">Git</h2>
      <p className="st-section-sub">Status polling for the Git panel and the status bar.</p>
      <div className="st-group">
        <Row
          label="Auto-refresh status"
          hint="Branch, ahead/behind and changed-file counts update on a timer. Turn off to refresh only on demand."
        >
          <Switch on={autoRefresh} onChange={setAutoRefresh} label="Auto-refresh git status" />
        </Row>
        <Row
          label="Refresh interval"
          hint={autoRefresh ? 'How often the status re-polls.' : 'Takes effect when auto-refresh is back on.'}
        >
          <Seg
            value={String(refreshSeconds)}
            options={[
              { id: '5', label: '5s' },
              { id: '10', label: '10s' },
              { id: '30', label: '30s' },
              { id: '60', label: '1m' },
            ]}
            onChange={(v) => setRefreshSeconds(Number(v))}
          />
        </Row>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* notifications & sounds                                             */

function NotificationsSection() {
  const notifyEnabled = useSettings((s) => s.notifyEnabled);
  const setNotifyEnabled = useSettings((s) => s.setNotifyEnabled);
  const notifyWaiting = useSettings((s) => s.notifyWaiting);
  const setNotifyWaiting = useSettings((s) => s.setNotifyWaiting);
  const notifyExit = useSettings((s) => s.notifyExit);
  const setNotifyExit = useSettings((s) => s.setNotifyExit);
  const soundEnabled = useSettings((s) => s.soundEnabled);
  const setSoundEnabled = useSettings((s) => s.setSoundEnabled);
  const soundVolume = useSettings((s) => s.soundVolume);
  const setSoundVolume = useSettings((s) => s.setSoundVolume);
  const toast = useUi((s) => s.toast);

  const [perm, setPerm] = useState(notificationPermission());

  const onMasterToggle = async (on: boolean) => {
    setNotifyEnabled(on);
    // Toggling on is the moment the intent is clearest — ask for the OS
    // permission right then rather than waiting for the first event.
    if (on && notificationPermission() === 'default') {
      setPerm(await requestNotificationPermission());
    }
  };

  return (
    <>
      <h2 className="st-section-head">Notifications</h2>
      <p className="st-section-sub">Configure how and when you receive alerts.</p>

      <div className="st-group-label">Notifications</div>
      <div className="st-group">
        <Row label="System notifications" hint="Enable or disable all notifications from Eaon.">
          <Switch on={notifyEnabled} onChange={onMasterToggle} label="System notifications" />
        </Row>
        {perm !== 'unsupported' && notifyEnabled && perm !== 'granted' && (
          <Row
            label={perm === 'denied' ? 'Permission blocked' : 'Permission needed'}
            hint={
              perm === 'denied'
                ? 'macOS blocked notifications for this app — enable them in System Settings → Notifications.'
                : 'macOS will ask once whether Eaon may post notifications.'
            }
          >
            {perm === 'default' && (
              <button className="btn btn-sm" onClick={async () => setPerm(await requestNotificationPermission())}>
                Allow notifications
              </button>
            )}
          </Row>
        )}
        <div className={cls('st-subrows', !notifyEnabled && 'st-subrows-off')}>
          <Row label="When an agent needs input" hint="Fires while the window is in the background, so you never miss a blocked agent.">
            <Switch on={notifyWaiting && notifyEnabled} onChange={setNotifyWaiting} label="Notify when an agent needs input" />
          </Row>
          <Row label="When a session exits" hint="A process ending — clean or not — while you're elsewhere.">
            <Switch on={notifyExit && notifyEnabled} onChange={setNotifyExit} label="Notify when a session exits" />
          </Row>
        </div>
      </div>

      <div className="st-group-label">Sounds</div>
      <div className="st-group">
        <Row label="Play sounds" hint="Enable or disable all sounds from Eaon.">
          <Switch on={soundEnabled} onChange={setSoundEnabled} label="Play sounds" />
        </Row>
        <div className={cls('st-subrows', !soundEnabled && 'st-subrows-off')}>
          <Row label="Volume" hint="Applies to every alert sound.">
            <Slider value={soundVolume} onChange={setSoundVolume} label="Sound volume" disabled={!soundEnabled} />
          </Row>
        </div>
        <Row label="Preview" hint="The chime that plays when an agent needs input.">
          <button
            className="btn btn-sm"
            onClick={() => {
              playChime('waiting');
              if (!soundEnabled) toast('Sounds are off — the preview ignores that.', 'info');
            }}
          >
            <IconVolume size={13} /> Play a sound
          </button>
        </Row>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* shortcuts                                                          */

const SHORTCUTS: { group: string; rows: { label: string; keys: string[] }[] }[] = [
  {
    group: 'General',
    rows: [
      { label: 'Command palette', keys: ['⌘', 'K'] },
      { label: 'Settings', keys: ['⌘', ','] },
      { label: 'Toggle sidebar', keys: ['⌘', 'B'] },
      { label: 'Switch right panel', keys: ['⌥', '1 – 5'] },
    ],
  },
  {
    group: 'Panes',
    rows: [
      { label: 'New agent session', keys: ['⌥', 'T'] },
      { label: 'Split pane right', keys: ['⌘', '\\'] },
      { label: 'Split pane down', keys: ['⌘', '⇧', '\\'] },
      { label: 'Close pane', keys: ['⌥', 'W'] },
    ],
  },
  {
    group: 'Terminal & editor',
    rows: [
      { label: 'Terminal font larger', keys: ['⌘', '+'] },
      { label: 'Terminal font smaller', keys: ['⌘', '−'] },
      { label: 'Reset terminal font', keys: ['⌘', '0'] },
      { label: 'Save file', keys: ['⌘', 'S'] },
    ],
  },
];

function ShortcutsSection() {
  return (
    <>
      <h2 className="st-section-head">Shortcuts</h2>
      <p className="st-section-sub">Global keyboard commands. Customisable bindings are on the roadmap.</p>
      {SHORTCUTS.map((g) => (
        <div key={g.group}>
          <div className="st-group-label">{g.group}</div>
          <div className="st-group">
            {g.rows.map((r) => (
              <div key={r.label} className="st-krow">
                <span className="st-krow-label">{r.label}</span>
                <span className="st-keys">
                  {r.keys.map((k, i) =>
                    k === ' – ' ? <em key={i}>–</em> : <kbd key={i}>{k}</kbd>,
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- */
/* data & storage                                                     */

function DataSection() {
  const resetAll = useSettings((s) => s.resetAll);
  const askConfirm = useUi((s) => s.askConfirm);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);

  const onReset = () => {
    askConfirm({
      title: 'Reset all preferences?',
      body: 'Theme, zoom, terminal options and every toggle in this window return to their defaults. The app reloads immediately after. Projects, boards and sessions are not touched.',
      confirmLabel: 'Reset & reload',
      danger: true,
      onConfirm: () => resetAll(),
    });
  };

  return (
    <>
      <h2 className="st-section-head">Data & Storage</h2>
      <p className="st-section-sub">Everything Eaon writes, and where it lives. Nothing leaves this machine.</p>

      <div className="st-group-label">Storage</div>
      <div className="st-group">
        <div className="st-kv">
          <span className="st-kv-k">Preferences</span>
          <span className="st-kv-v">This window’s local storage</span>
        </div>
        <div className="st-kv">
          <span className="st-kv-k">Projects</span>
          <span className="st-kv-v"><code>~/.eaon/projects.json</code></span>
        </div>
        <div className="st-kv">
          <span className="st-kv-k">Kanban board</span>
          <span className="st-kv-v">
            <code>{active ? `${active.path}/.eaon/board.json` : '<project>/.eaon/board.json'}</code>
          </span>
        </div>
        <div className="st-kv">
          <span className="st-kv-k">Worktrees</span>
          <span className="st-kv-v"><code>{active ? `${active.path}/.eaon/worktrees/` : '<project>/.eaon/worktrees/'}</code></span>
        </div>
      </div>

      <div className="st-group-label">Reset</div>
      <div className="st-group st-danger">
        <Row
          label="Reset all preferences"
          hint="Every setting in this window back to its default, then a reload. Boards, projects and sessions survive."
        >
          <button className="btn btn-sm btn-danger" onClick={onReset}>Reset preferences…</button>
        </Row>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* about                                                              */

function AboutSection() {
  const connected = useConnection((s) => s.connected);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const desktop = (window as unknown as {
    eaonDesktop?: {
      isApp?: boolean;
      appVersion?: string | null;
      versions?: { electron?: string; node?: string };
    };
  }).eaonDesktop;
  // The bundle's own version wins: a constant in here would drift the moment
  // a release ships without someone remembering to bump it.
  const version = desktop?.appVersion || APP_VERSION;

  return (
    <>
      <h2 className="st-section-head">About</h2>
      <p className="st-section-sub">The agentic development environment for parallel CLI sessions.</p>
      <div className="st-group">
        <div className="st-about-hero">
          <Logo size={40} />
          <div>
            <div className="st-about-name">Eaon ADE</div>
            <div className="st-about-tag">Version {version}</div>
          </div>
        </div>
        <UpdateRow />
        <div className="st-kv">
          <span className="st-kv-k">Runtime</span>
          <span className="st-kv-v">
            {desktop?.isApp
              ? `Electron ${desktop.versions?.electron ?? ''} · Node ${desktop.versions?.node ?? ''}`
              : 'Browser build'}
          </span>
        </div>
        <div className="st-kv">
          <span className="st-kv-k">Server</span>
          <span className="st-kv-v">
            <span className={cls('conn-dot', connected ? 'conn-on' : 'conn-off')} />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        {active && (
          <div className="st-kv">
            <span className="st-kv-k">Active project</span>
            <span className="st-kv-v"><code>{active.path}</code></span>
          </div>
        )}
        <div className="st-kv">
          <span className="st-kv-k">Preferences</span>
          <span className="st-kv-v">Stored locally on this machine</span>
        </div>
      </div>
    </>
  );
}

/**
 * Updates, where someone goes to ask rather than be told. The banner covers
 * "there is a new version"; this covers "is there?", which is the question
 * you have when no banner is showing.
 */
function UpdateRow() {
  const state = useUpdates((s) => s.state);
  const check = useUpdates((s) => s.check);
  const download = useUpdates((s) => s.download);
  const setAutoCheck = useUpdates((s) => s.setAutoCheck);

  // Browser build: nothing to update, so nothing to say.
  if (!state) return null;

  const checking = state.status === 'checking';
  const available = state.status === 'available';

  let status = 'Never checked';
  if (checking) status = 'Checking…';
  else if (available) status = `Version ${state.version} is available`;
  else if (state.status === 'error') status = state.message ?? 'Check failed';
  else if (state.status === 'up-to-date') status = state.note ?? `Up to date — ${state.current} is the latest`;
  else if (state.lastCheckedAt) status = `Up to date as of ${timeAgo(state.lastCheckedAt)}`;

  return (
    <>
      <Row label="Updates" hint="Checked automatically every few hours while the app is open.">
        <div className="st-update-row">
          <span
            className={cls(
              'st-update-status',
              available && 'st-update-status-new',
              state.status === 'error' && 'st-update-status-err',
            )}
          >
            {status}
          </span>
          {available ? (
            <button className="btn btn-sm btn-accent" onClick={download}>
              Download
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => void check()} disabled={checking}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
          )}
        </div>
      </Row>
      <Row
        label="Check for updates automatically"
        hint="Only tells you when there is a newer version — it never installs anything on its own."
      >
        <Switch
          on={state.autoCheck}
          onChange={setAutoCheck}
          label="Check for updates automatically"
        />
      </Row>
    </>
  );
}
