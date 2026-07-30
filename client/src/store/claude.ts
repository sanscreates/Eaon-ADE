import { create } from 'zustand';
import { api } from '../lib/api';
import { useSettings } from './settings';

export interface ClaudeAccount {
  slug: string;
  name: string;
  isSystem: boolean;
  configDir: string;
  hasCredentials: boolean;
  subscriptionType?: string;
  rateLimitTier?: string;
  /** ms until the stored access token expires; null when unknown. */
  expiresInMs?: number | null;
  expired?: boolean;
}

export interface UsageWindow {
  utilization: number | null;
  resets_at: string | null;
}

/**
 * One live limit as the API now reports it. Preferred over the flat
 * `five_hour`/`seven_day` fields because it carries severity, an active flag,
 * and per-model scope — a weekly Opus cap has no flat field to live in.
 */
export interface UsageLimit {
  kind: string;
  group?: string | null;
  percent: number | null;
  severity?: string | null;
  resets_at: string | null;
  is_active?: boolean;
  scope?: { model?: { id?: string | null; display_name?: string | null } | null } | null;
}

export interface ClaudeUsage {
  five_hour?: UsageWindow | null;
  seven_day?: UsageWindow | null;
  seven_day_opus?: UsageWindow | null;
  seven_day_sonnet?: UsageWindow | null;
  limits?: UsageLimit[] | null;
  spend?: { percent?: number | null; enabled?: boolean } | null;
  account?: {
    slug: string;
    name: string;
    subscriptionType?: string;
    rateLimitTier?: string;
    expiresInMs?: number | null;
  };
  fetchedAt: number;
}

/** Rows to render, newest API shape first, legacy fields as the fallback. */
export function usageRows(u: ClaudeUsage | null): { label: string; percent: number | null; resets_at: string | null }[] {
  if (!u) return [];
  const limits = (u.limits ?? []).filter((l) => l.percent != null);
  if (limits.length > 0) {
    return limits.map((l) => ({
      label: labelForLimit(l),
      percent: l.percent,
      resets_at: l.resets_at,
    }));
  }
  const legacy: { label: string; w: UsageWindow | null | undefined }[] = [
    { label: 'Current session', w: u.five_hour },
    { label: 'This week', w: u.seven_day },
    { label: 'Opus · week', w: u.seven_day_opus },
    { label: 'Sonnet · week', w: u.seven_day_sonnet },
  ];
  return legacy
    .filter((r) => r.w?.utilization != null)
    .map((r) => ({ label: r.label, percent: r.w!.utilization, resets_at: r.w!.resets_at }));
}

function labelForLimit(l: UsageLimit): string {
  const model = l.scope?.model?.display_name;
  if (l.kind === 'session') return 'Current session';
  if (l.kind === 'weekly_all') return 'This week';
  if (l.kind === 'weekly_scoped') return model ? `${model} · week` : 'This week · scoped';
  return l.kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** The number the pill shows: the session limit, or the highest live one. */
export function headlinePercent(u: ClaudeUsage | null): number | null {
  if (!u) return null;
  const session = (u.limits ?? []).find((l) => l.kind === 'session');
  if (session?.percent != null) return Math.round(session.percent);
  if (u.five_hour?.utilization != null) return Math.round(u.five_hour.utilization);
  const live = (u.limits ?? []).filter((l) => l.percent != null).map((l) => l.percent as number);
  return live.length ? Math.round(Math.max(...live)) : null;
}

interface ClaudeState {
  accounts: ClaudeAccount[];
  accountsLoaded: boolean;
  usage: ClaudeUsage | null;
  usageLoading: boolean;
  usageError: { code: string; error: string } | null;

  loadAccounts: (force?: boolean) => Promise<void>;
  addAccount: (name: string) => Promise<ClaudeAccount>;
  loadUsage: (force?: boolean) => Promise<void>;
  /** Poll until a fresh profile finishes its /login (creds land on disk). */
  watchForLogin: (slug: string) => void;
}

/** The account new Claude sessions sign in with (and whose usage shows). */
export function activeClaudeSlug(): string {
  return useSettings.getState().claudeAccountSlug ?? 'system';
}

export const useClaude = create<ClaudeState>((set, get) => ({
  accounts: [],
  accountsLoaded: false,
  usage: null,
  usageLoading: false,
  usageError: null,

  loadAccounts: async (force) => {
    if (get().accountsLoaded && !force) return;
    try {
      const res = await api.get<{ accounts: ClaudeAccount[] }>('/api/claude/accounts');
      set({ accounts: res.accounts, accountsLoaded: true });
    } catch {
      // server unreachable — bootstrap's connection dot already says so
    }
  },

  addAccount: async (name) => {
    const res = await api.post<{ account: ClaudeAccount }>('/api/claude/accounts', { name });
    set((s) => ({ accounts: [...s.accounts, res.account] }));
    return res.account;
  },

  loadUsage: async (force) => {
    const slug = activeClaudeSlug();
    if (get().usageLoading && !force) return;
    set({ usageLoading: true });
    try {
      const usage = await api.get<ClaudeUsage>(`/api/claude/usage?slug=${encodeURIComponent(slug)}`);
      // A slow response can land after the user switched accounts; only apply
      // it if it still describes the active one.
      if (usage.account?.slug === slug || !usage.account) {
        set({ usage, usageError: null, usageLoading: false });
      } else {
        set({ usageLoading: false });
      }
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).replace(/\s*\(\d+\)$/, '');
      const code = /not signed in/.test(msg)
        ? 'no-credentials'
        : /expired/.test(msg)
          ? 'auth-expired'
          : /reach Anthropic/.test(msg)
            ? 'network'
            : 'error';
      set({ usageError: { code, error: msg }, usageLoading: false });
    }
  },

  watchForLogin: (slug) => {
    let tries = 0;
    const tick = setInterval(async () => {
      tries++;
      await get().loadAccounts(true);
      const found = get().accounts.find((a) => a.slug === slug);
      if (found?.hasCredentials || tries >= 36) {
        clearInterval(tick);
        if (found?.hasCredentials) void get().loadUsage(true);
      }
    }, 5_000);
  },
}));

/* ------------------------------------------------------------------ */
/* polling — live only while the pill is visible                        */

let timer: ReturnType<typeof setInterval> | null = null;
let onFocus: (() => void) | null = null;

function refreshNow(): void {
  void useClaude.getState().loadAccounts(true);
  void useClaude.getState().loadUsage(true);
}

export function startUsagePolling(): void {
  if (timer) return;
  refreshNow();
  timer = setInterval(refreshNow, 60_000);

  /*
   * Also refresh whenever the window comes back to the front. The common way
   * this feature looked broken was: laptop sleeps for hours, the stored token
   * expires, the interval keeps failing against the dead token, and the pill
   * stays stuck on an error until the app is restarted. Waking is exactly the
   * moment Claude Code is likely to have refreshed the token, so re-check
   * then rather than waiting out the next tick.
   */
  onFocus = () => {
    const u = useClaude.getState();
    const stale = !u.usage || Date.now() - u.usage.fetchedAt > 30_000;
    if (u.usageError || stale) refreshNow();
  };
  window.addEventListener('focus', onFocus);
}

export function stopUsagePolling(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (onFocus) window.removeEventListener('focus', onFocus);
  onFocus = null;
}

/**
 * Called when a Claude pane exits. Running Claude Code refreshes its stored
 * token, so a session ending is a strong hint that a previously-expired
 * credential is now good again.
 */
export function noteClaudeSessionEnded(): void {
  if (!timer) return;
  setTimeout(refreshNow, 1_500);
}

// Follow the toggle and the chosen account without any component wiring.
let lastShow = useSettings.getState().showClaudeUsage;
let lastSlug = useSettings.getState().claudeAccountSlug;
useSettings.subscribe((s) => {
  if (s.showClaudeUsage !== lastShow) {
    lastShow = s.showClaudeUsage;
    if (lastShow) startUsagePolling();
    else stopUsagePolling();
  }
  if (s.claudeAccountSlug !== lastSlug) {
    lastSlug = s.claudeAccountSlug;
    useClaude.setState({ usage: null, usageError: null });
    if (lastShow) void useClaude.getState().loadUsage(true);
  }
});
if (lastShow) startUsagePolling();
