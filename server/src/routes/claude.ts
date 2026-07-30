import { Router } from 'express';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const claudeRouter = Router();

/* Claude Code keeps a single signed-in account in ~/.claude/.credentials.json.
   Multi-account support here never touches that file: each extra account is a
   profile directory the ADE points sessions at through CLAUDE_CONFIG_DIR, the
   override Claude Code itself honours. The system account stays the default. */
const SYSTEM_DIR = join(homedir(), '.claude');
const PROFILES_ROOT = join(homedir(), '.eaon-ade', 'claude-accounts');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

interface OauthCreds {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
  rateLimitTier?: string;
}

interface CredentialsFile {
  claudeAiOauth?: OauthCreds;
}

/**
 * Claude Code stores its OAuth credentials in one of two places depending on
 * platform and version: a plaintext `.credentials.json` inside the config
 * directory, or the macOS login Keychain under "Claude Code-credentials".
 * Reading only the file misses every Keychain-only install, so try the file
 * first (it is per-profile, which the Keychain is not) and fall back.
 */
function readKeychainCreds(): CredentialsFile | null {
  if (process.platform !== 'darwin') return null;
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(raw) as CredentialsFile;
  } catch {
    // Locked keychain, no entry, or a version that does not use it.
    return null;
  }
}

interface AccountInfo {
  slug: string;
  name: string;
  isSystem: boolean;
  configDir: string;
  hasCredentials: boolean;
  subscriptionType?: string;
  rateLimitTier?: string;
  /** ms until the access token expires; null when unknown. */
  expiresInMs?: number | null;
  expired?: boolean;
}

function readCredentials(configDir: string): CredentialsFile | null {
  try {
    return JSON.parse(readFileSync(join(configDir, '.credentials.json'), 'utf8')) as CredentialsFile;
  } catch {
    // Only the system account can live in the Keychain — extra profiles are
    // directories, and the Keychain holds a single entry with no profile key.
    return configDir === SYSTEM_DIR ? readKeychainCreds() : null;
  }
}

function credsFor(configDir: string): OauthCreds | undefined {
  return readCredentials(configDir)?.claudeAiOauth;
}

/** Milliseconds until the access token expires; negative once it has. */
function expiryOf(oauth: OauthCreds | undefined): number | null {
  return typeof oauth?.expiresAt === 'number' ? oauth.expiresAt - Date.now() : null;
}

function accountFor(slug: string, name: string, isSystem: boolean, configDir: string): AccountInfo {
  const oauth = credsFor(configDir);
  const expiresInMs = expiryOf(oauth);
  return {
    slug,
    name,
    isSystem,
    configDir,
    hasCredentials: Boolean(oauth?.accessToken),
    subscriptionType: oauth?.subscriptionType,
    rateLimitTier: oauth?.rateLimitTier,
    expiresInMs,
    // Claude Code refreshes its own token on every run, so an expired one just
    // means it has not been run in a while — recoverable by signing in again.
    expired: expiresInMs !== null && expiresInMs <= 0,
  };
}

function titleCase(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function listAccounts(): AccountInfo[] {
  const accounts: AccountInfo[] = [accountFor('system', 'Default', true, SYSTEM_DIR)];
  if (existsSync(PROFILES_ROOT)) {
    for (const entry of readdirSync(PROFILES_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let name = titleCase(entry.name);
      try {
        const meta = JSON.parse(readFileSync(join(PROFILES_ROOT, entry.name, 'eaon-account.json'), 'utf8')) as { name?: string };
        if (meta.name) name = meta.name;
      } catch {
        // no metadata sidecar yet — fall back to the folder name
      }
      accounts.push(accountFor(entry.name, name, false, join(PROFILES_ROOT, entry.name)));
    }
  }
  return accounts;
}

function findAccount(slug: string): AccountInfo | undefined {
  return listAccounts().find((a) => a.slug === slug);
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'account';
  let slug = base;
  let n = 2;
  while (existsSync(join(PROFILES_ROOT, slug))) slug = `${base}-${n++}`;
  return slug;
}

claudeRouter.get('/accounts', (_req, res) => {
  res.json({ accounts: listAccounts() });
});

claudeRouter.post('/accounts', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'A name is required' });
  if (name.length > 40) return res.status(400).json({ error: 'Keep the name under 40 characters' });
  const slug = slugify(name);
  const dir = join(PROFILES_ROOT, slug);
  mkdirSync(dir, { recursive: true });
  // Sidecar metadata so the display name survives slugification; Claude Code
  // itself only ever writes .credentials.json into this directory.
  try {
    writeFileSync(join(dir, 'eaon-account.json'), JSON.stringify({ name, createdAt: Date.now() }));
  } catch {
    // cosmetic only
  }
  res.json({ account: accountFor(slug, name, false, dir) });
});

/* ------------------------------------------------------------------ */
/* usage                                                                */

interface UsageWindow {
  utilization: number | null;
  resets_at: string | null;
}

/**
 * The modern shape. `limits[]` is what the API now leads with — one entry per
 * live limit, already carrying its own severity and reset — and it covers
 * per-model weekly caps that the flat `seven_day_*` fields cannot express.
 * The legacy windows are still returned by the API, so keep both and let the
 * client prefer `limits` when present.
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

export interface UsageReport {
  five_hour?: UsageWindow | null;
  seven_day?: UsageWindow | null;
  seven_day_opus?: UsageWindow | null;
  seven_day_sonnet?: UsageWindow | null;
  limits?: UsageLimit[] | null;
  spend?: {
    used?: { amount_minor?: number; currency?: string; exponent?: number } | null;
    limit?: number | null;
    percent?: number | null;
    enabled?: boolean;
  } | null;
  extra_usage?: { is_enabled?: boolean; utilization?: number | null } | null;
}

const cache = new Map<string, { at: number; data?: UsageReport; error?: { status: number; code: string; error: string } }>();
const CACHE_OK_MS = 60_000;
const CACHE_ERR_MS = 20_000;

async function fetchUsage(token: string): Promise<UsageReport> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error('The stored Claude session has expired. Run claude once to refresh it.') as Error & { status?: number; code?: string };
      err.status = 401;
      err.code = 'auth-expired';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Anthropic returned ${res.status}`) as Error & { status?: number; code?: string };
      err.status = 502;
      err.code = 'upstream';
      throw err;
    }
    return (await res.json()) as UsageReport;
  } finally {
    clearTimeout(timer);
  }
}

claudeRouter.get('/usage', async (req, res) => {
  const slug = String(req.query.slug ?? 'system') || 'system';
  const account = findAccount(slug);
  if (!account) return res.status(404).json({ code: 'no-account', error: `Unknown account "${slug}"` });
  const oauth = credsFor(account.configDir);
  if (!oauth?.accessToken) {
    return res.status(404).json({
      code: 'no-credentials',
      error: `${account.name} is not signed in to Claude yet.`,
      configDir: account.configDir,
      isSystem: account.isSystem,
    });
  }

  // Don't spend a round trip on a token we already know is dead. Claude Code
  // refreshes its own token whenever it runs, so the fix is to sign in again —
  // which the client can offer as one click rather than a wall of prose.
  const expiresInMs = expiryOf(oauth);
  if (expiresInMs !== null && expiresInMs <= 0) {
    cache.delete(slug);
    return res.status(401).json({
      code: 'auth-expired',
      error: `${account.name}'s Claude sign-in has expired.`,
      configDir: account.configDir,
      isSystem: account.isSystem,
    });
  }

  const hit = cache.get(slug);
  const now = Date.now();
  if (hit && now - hit.at < (hit.data ? CACHE_OK_MS : CACHE_ERR_MS)) {
    if (hit.data) {
      return res.json({
        ...hit.data,
        account: {
          slug: account.slug,
          name: account.name,
          subscriptionType: account.subscriptionType,
          rateLimitTier: account.rateLimitTier,
          expiresInMs,
        },
        fetchedAt: hit.at,
      });
    }
    return res.status(hit.error!.status).json(hit.error);
  }

  try {
    const data = await fetchUsage(oauth.accessToken);
    cache.set(slug, { at: now, data });
    res.json({
      ...data,
      account: {
        slug: account.slug,
        name: account.name,
        subscriptionType: account.subscriptionType,
        rateLimitTier: account.rateLimitTier,
        expiresInMs,
      },
      fetchedAt: now,
    });
  } catch (err) {
    const e = err as Error & { status?: number; code?: string };
    const status = e.status ?? 502;
    const code = e.code ?? (e.name === 'AbortError' ? 'timeout' : 'network');
    const error = code === 'timeout' || code === 'network' ? 'Could not reach Anthropic right now.' : e.message;
    cache.set(slug, { at: now, error: { status, code, error } });
    res.status(status).json({ code, error });
  }
});
