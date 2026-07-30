import { create } from 'zustand';
import { api } from '../lib/api';

export type PullState = 'OPEN' | 'CLOSED' | 'MERGED';

export interface PullActor {
  login: string;
  name?: string;
  is_bot?: boolean;
}

export interface PullLabel {
  name: string;
  color: string;
  description?: string;
}

export interface PullCheck {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
  workflowName?: string;
}

export interface PullFile {
  path: string;
  additions: number;
  deletions: number;
  changeType?: string;
}

export interface PullComment {
  id: string;
  author?: PullActor;
  body: string;
  createdAt: string;
}

export interface PullSummary {
  number: number;
  title: string;
  state: PullState;
  isDraft: boolean;
  author?: PullActor;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision?: string;
  statusCheckRollup?: PullCheck[] | null;
  labels?: PullLabel[];
}

export interface PullDetail extends PullSummary {
  body: string;
  createdAt: string;
  mergedAt?: string | null;
  mergeable?: string;
  mergeStateStatus?: string;
  files?: PullFile[];
  assignees?: PullActor[];
  reviewRequests?: { login?: string; name?: string; slug?: string }[];
  latestReviews?: { author?: PullActor; state?: string; body?: string }[];
  comments?: PullComment[];
}

export interface PullError {
  code: string;
  error: string;
}

export type PullFilter = 'open' | 'merged' | 'closed' | 'all';
export type PullTab = 'conversation' | 'checks' | 'files';

interface PullsState {
  projectPath: string | null;
  filter: PullFilter;
  list: PullSummary[];
  loadingList: boolean;
  error: PullError | null;
  repo: { nameWithOwner: string; url: string } | null;

  selected: number | null;
  detail: PullDetail | null;
  loadingDetail: boolean;
  detailError: PullError | null;
  tab: PullTab;
  diff: string | null;

  setFilter: (filter: PullFilter) => void;
  setTab: (tab: PullTab) => void;
  load: (projectPath: string) => Promise<void>;
  open: (projectPath: string, number: number) => Promise<void>;
  back: () => void;
  reset: () => void;
}

/**
 * `api` throws with only the server's message string, so the machine-readable
 * code doesn't survive the trip. Recover it from the message — the empty state
 * needs to tell "install gh" apart from "this repo has no GitHub remote", and
 * those need very different instructions.
 */
function toPullError(err: unknown): PullError {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();
  const code = m.includes('not installed')
    ? 'gh-missing'
    : m.includes('gh auth login')
      ? 'gh-unauthenticated'
      : m.includes('no github remote')
        ? 'no-remote'
        : m.includes('not a git repository')
          ? 'not-a-repo'
          : 'gh-error';
  return { code, error: raw };
}

export const usePulls = create<PullsState>((set, get) => ({
  projectPath: null,
  filter: 'open',
  list: [],
  loadingList: false,
  error: null,
  repo: null,

  selected: null,
  detail: null,
  loadingDetail: false,
  detailError: null,
  tab: 'conversation',
  diff: null,

  setFilter: (filter) => {
    set({ filter });
    const path = get().projectPath;
    if (path) get().load(path);
  },

  setTab: (tab) => {
    set({ tab });
    const { projectPath, selected, diff } = get();
    // The diff is only fetched when someone actually opens Files changed.
    if (tab === 'files' && projectPath && selected && diff === null) {
      api
        .get<{ diff: string }>(
          `/api/pulls/${selected}/diff?path=${encodeURIComponent(projectPath)}`,
        )
        .then((r) => set({ diff: r.diff }))
        .catch(() => set({ diff: '' }));
    }
  },

  load: async (projectPath) => {
    set({ projectPath, loadingList: true, error: null });
    const query = `path=${encodeURIComponent(projectPath)}&state=${get().filter}`;
    try {
      const res = await api.get<{ pulls: PullSummary[] }>(`/api/pulls?${query}`);
      set({ list: res.pulls, loadingList: false });
    } catch (err) {
      set({ list: [], loadingList: false, error: toPullError(err) });
    }
    api
      .get<{ nameWithOwner: string; url: string }>(
        `/api/pulls/repo?path=${encodeURIComponent(projectPath)}`,
      )
      .then((repo) => set({ repo }))
      .catch(() => set({ repo: null }));
  },

  open: async (projectPath, number) => {
    set({
      selected: number,
      loadingDetail: true,
      detailError: null,
      detail: null,
      diff: null,
      tab: 'conversation',
    });
    try {
      const detail = await api.get<PullDetail>(
        `/api/pulls/${number}?path=${encodeURIComponent(projectPath)}`,
      );
      set({ detail, loadingDetail: false });
    } catch (err) {
      set({ loadingDetail: false, detailError: toPullError(err) });
    }
  },

  back: () => set({ selected: null, detail: null, detailError: null, diff: null }),

  reset: () =>
    set({
      list: [],
      error: null,
      selected: null,
      detail: null,
      detailError: null,
      diff: null,
      repo: null,
    }),
}));
