import { useEffect, useMemo } from 'react';
import { useProjects } from '../../store/projects';
import {
  usePulls,
  type PullCheck,
  type PullDetail,
  type PullFilter,
  type PullSummary,
} from '../../store/pulls';
import { Markdown } from '../../lib/miniMarkdown';
import { cls, timeAgo } from '../../lib/utils';
import { BrandGitHub } from '../AgentLogos';
import {
  IconCheck,
  IconChevronRight,
  IconExternal,
  IconGitBranch,
  IconRefresh,
} from '../Icons';

const FILTERS: { id: PullFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'merged', label: 'Merged' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

/** GitHub's own vocabulary: draft beats open, merged beats closed. */
function stateOf(pr: PullSummary): { label: string; tone: string } {
  if (pr.state === 'MERGED') return { label: 'Merged', tone: 'merged' };
  if (pr.state === 'CLOSED') return { label: 'Closed', tone: 'closed' };
  if (pr.isDraft) return { label: 'Draft', tone: 'draft' };
  return { label: 'Open', tone: 'open' };
}

/** Roll a check run list up to one verdict, the way a status badge reads. */
function rollup(checks: PullCheck[] | null | undefined): 'pass' | 'fail' | 'pending' | null {
  if (!checks || checks.length === 0) return null;
  let pending = false;
  for (const c of checks) {
    const verdict = (c.conclusion || c.state || '').toUpperCase();
    if (verdict === 'FAILURE' || verdict === 'ERROR' || verdict === 'TIMED_OUT') return 'fail';
    if (!verdict || verdict === 'PENDING' || (c.status && c.status.toUpperCase() !== 'COMPLETED')) {
      pending = true;
    }
  }
  return pending ? 'pending' : 'pass';
}

function checkName(c: PullCheck): string {
  return c.name || c.context || c.workflowName || 'check';
}

function checkVerdict(c: PullCheck): 'pass' | 'fail' | 'pending' {
  const verdict = (c.conclusion || c.state || '').toUpperCase();
  if (verdict === 'SUCCESS' || verdict === 'NEUTRAL' || verdict === 'SKIPPED') return 'pass';
  if (verdict === 'FAILURE' || verdict === 'ERROR' || verdict === 'TIMED_OUT') return 'fail';
  return 'pending';
}

export function PullsPanel() {
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const projectPath = usePulls((s) => s.projectPath);
  const selected = usePulls((s) => s.selected);
  const load = usePulls((s) => s.load);
  const reset = usePulls((s) => s.reset);

  useEffect(() => {
    if (!active) {
      reset();
      return;
    }
    if (projectPath !== active.path) load(active.path);
  }, [active?.path]);

  if (!active) return <div className="panel-empty">Add a project to see pull requests.</div>;
  return selected ? <PullDetailView projectPath={active.path} /> : <PullList projectPath={active.path} />;
}

/* ── list ──────────────────────────────────────────────────────────────── */

function PullList({ projectPath }: { projectPath: string }) {
  const list = usePulls((s) => s.list);
  const loading = usePulls((s) => s.loadingList);
  const error = usePulls((s) => s.error);
  const filter = usePulls((s) => s.filter);
  const setFilter = usePulls((s) => s.setFilter);
  const repo = usePulls((s) => s.repo);
  const open = usePulls((s) => s.open);
  const load = usePulls((s) => s.load);

  return (
    <div className="pulls">
      <div className="panel-toolbar pulls-toolbar">
        <span className="pulls-repo" title={repo?.nameWithOwner}>
          <BrandGitHub size={13} />
          {repo?.nameWithOwner ?? 'Pull requests'}
        </span>
        <button className="icon-btn" title="Refresh" onClick={() => load(projectPath)}>
          <IconRefresh size={13} />
        </button>
      </div>

      <div className="seg">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={cls('seg-item', filter === f.id && 'seg-item-active')}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="panel-empty">Loading pull requests…</div>}
      {!loading && error && <PullsError code={error.code} message={error.error} />}
      {!loading && !error && list.length === 0 && (
        <div className="panel-empty">
          No {filter === 'all' ? '' : filter} pull requests.
        </div>
      )}

      {!loading && !error && list.length > 0 && (
        <div className="pull-list">
          {list.map((pr) => {
            const st = stateOf(pr);
            const checks = rollup(pr.statusCheckRollup);
            return (
              <button key={pr.number} className="pull-row" onClick={() => open(projectPath, pr.number)}>
                <div className="pull-row-top">
                  <span className={cls('pr-state', `pr-state-${st.tone}`)}>{st.label}</span>
                  <span className="pull-row-title">{pr.title}</span>
                  <span className="pull-row-num">#{pr.number}</span>
                </div>
                <div className="pull-row-meta">
                  <span className="pull-branch">
                    <IconGitBranch size={11} />
                    {pr.headRefName}
                  </span>
                  {pr.author?.login && <span>{pr.author.login}</span>}
                  <span>{timeAgo(new Date(pr.updatedAt).getTime())}</span>
                  <span className="pull-diffstat">
                    <span className="add">+{pr.additions}</span>
                    <span className="del">−{pr.deletions}</span>
                  </span>
                  {checks && <span className={cls('check-dot', `check-${checks}`)} title={`Checks ${checks}`} />}
                </div>
                {pr.labels && pr.labels.length > 0 && (
                  <div className="pull-labels">
                    {pr.labels.slice(0, 4).map((l) => (
                      <span
                        key={l.name}
                        className="pull-label"
                        style={{
                          // GitHub gives a bare hex; tint the chip from it so the
                          // label reads the same here as it does on the PR page.
                          color: `#${l.color}`,
                          background: `#${l.color}1f`,
                          boxShadow: `inset 0 0 0 1px #${l.color}55`,
                        }}
                      >
                        {l.name}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Each failure has a different fix, so each gets its own instruction. */
function PullsError({ code, message }: { code: string; message: string }) {
  const help: Record<string, { title: string; hint: string }> = {
    'gh-missing': {
      title: 'GitHub CLI not found',
      hint: 'Install it with `brew install gh`, then reload.',
    },
    'gh-unauthenticated': {
      title: 'Not signed in to GitHub',
      hint: 'Run `gh auth login` in any pane, then refresh.',
    },
    'no-remote': {
      title: 'No GitHub remote',
      hint: 'This project has no GitHub remote, so it has no pull requests.',
    },
    'not-a-repo': {
      title: 'Not a git repository',
      hint: 'Pull requests need a git repository with a GitHub remote.',
    },
  };
  const info = help[code];
  return (
    <div className="panel-empty">
      <p>{info?.title ?? 'Could not load pull requests'}</p>
      <p className="panel-empty-hint">{info?.hint ?? message}</p>
    </div>
  );
}

/* ── detail ────────────────────────────────────────────────────────────── */

function PullDetailView({ projectPath }: { projectPath: string }) {
  const detail = usePulls((s) => s.detail);
  const loading = usePulls((s) => s.loadingDetail);
  const error = usePulls((s) => s.detailError);
  const number = usePulls((s) => s.selected);
  const back = usePulls((s) => s.back);
  const tab = usePulls((s) => s.tab);
  const setTab = usePulls((s) => s.setTab);
  const repo = usePulls((s) => s.repo);

  return (
    <div className="pull-detail">
      <div className="panel-toolbar pull-crumbs">
        <button className="pull-back" onClick={back}>
          <IconChevronRight size={12} className="flip" /> Pull requests
        </button>
        {repo?.nameWithOwner && <span className="crumb-sep">·</span>}
        {repo?.nameWithOwner && <span className="pull-crumb-repo">{repo.nameWithOwner}</span>}
        <span className="pull-crumb-num">#{number}</span>
        {detail && (
          <a
            className="icon-btn"
            href={detail.url}
            target="_blank"
            rel="noreferrer noopener"
            title="Open on GitHub"
          >
            <IconExternal size={13} />
          </a>
        )}
      </div>

      {loading && <div className="panel-empty">Loading #{number}…</div>}
      {!loading && error && <PullsError code={error.code} message={error.error} />}

      {!loading && detail && (
        <>
          <div className="pull-head">
            <h2 className="pull-title">
              {detail.title} <span className="pull-title-num">#{detail.number}</span>
            </h2>
            <div className="pull-head-meta">
              <span className={cls('pr-state', `pr-state-${stateOf(detail).tone}`)}>
                {stateOf(detail).label}
              </span>
              <span className="pull-refs">
                <code>{detail.baseRefName}</code>
                <span className="pull-refs-arrow">←</span>
                <code>{detail.headRefName}</code>
              </span>
              <span className="pull-updated">
                updated {timeAgo(new Date(detail.updatedAt).getTime())}
              </span>
            </div>
          </div>

          <div className="seg pull-tabs">
            <button
              className={cls('seg-item', tab === 'conversation' && 'seg-item-active')}
              onClick={() => setTab('conversation')}
            >
              Conversation
              {detail.comments && detail.comments.length > 0 && (
                <span className="seg-count">{detail.comments.length}</span>
              )}
            </button>
            <button
              className={cls('seg-item', tab === 'checks' && 'seg-item-active')}
              onClick={() => setTab('checks')}
            >
              Checks
              {detail.statusCheckRollup && detail.statusCheckRollup.length > 0 && (
                <span className="seg-count">{detail.statusCheckRollup.length}</span>
              )}
            </button>
            <button
              className={cls('seg-item', tab === 'files' && 'seg-item-active')}
              onClick={() => setTab('files')}
            >
              Files changed
              {detail.changedFiles > 0 && <span className="seg-count">{detail.changedFiles}</span>}
            </button>
          </div>

          <div className="pull-body">
            {tab === 'conversation' && <Conversation detail={detail} />}
            {tab === 'checks' && <Checks detail={detail} />}
            {tab === 'files' && <Files detail={detail} />}
          </div>

          <PullRail detail={detail} projectPath={projectPath} />
        </>
      )}
    </div>
  );
}

function Conversation({ detail }: { detail: PullDetail }) {
  return (
    <div className="pull-scroll">
      <article className="pull-comment">
        <header className="pull-comment-head">
          <strong>{detail.author?.login ?? 'unknown'}</strong>
          <span>opened {timeAgo(new Date(detail.createdAt).getTime())}</span>
        </header>
        <Markdown source={detail.body} />
      </article>
      {(detail.comments ?? []).map((c) => (
        <article key={c.id} className="pull-comment">
          <header className="pull-comment-head">
            <strong>{c.author?.login ?? 'unknown'}</strong>
            <span>{timeAgo(new Date(c.createdAt).getTime())}</span>
          </header>
          <Markdown source={c.body} />
        </article>
      ))}
    </div>
  );
}

function Checks({ detail }: { detail: PullDetail }) {
  const checks = detail.statusCheckRollup ?? [];
  if (checks.length === 0) {
    return <div className="panel-empty">No checks reported on this pull request.</div>;
  }
  return (
    <div className="pull-scroll">
      <div className="check-list">
        {checks.map((c, i) => {
          const verdict = checkVerdict(c);
          const href = c.detailsUrl || c.targetUrl;
          return (
            <div key={`${checkName(c)}-${i}`} className="check-row">
              <span className={cls('check-dot', `check-${verdict}`)} />
              <span className="check-name">{checkName(c)}</span>
              <span className={cls('check-verdict', `check-text-${verdict}`)}>
                {verdict === 'pass' ? 'Successful' : verdict === 'fail' ? 'Failed' : 'Pending'}
              </span>
              {href && (
                <a className="icon-btn" href={href} target="_blank" rel="noreferrer noopener" title="Open log">
                  <IconExternal size={12} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Files({ detail }: { detail: PullDetail }) {
  const diff = usePulls((s) => s.diff);
  const files = detail.files ?? [];

  const lines = useMemo(() => (diff ? diff.split('\n') : []), [diff]);

  return (
    <div className="pull-scroll">
      <div className="file-list">
        {files.map((f) => (
          <div key={f.path} className="file-row" title={f.path}>
            <span className="file-path">{f.path}</span>
            <span className="pull-diffstat">
              <span className="add">+{f.additions}</span>
              <span className="del">−{f.deletions}</span>
            </span>
          </div>
        ))}
      </div>

      {diff === null && <div className="panel-empty-hint diff-loading">Loading diff…</div>}
      {diff !== null && diff !== '' && (
        <pre className="diff">
          {lines.map((line, i) => {
            const kind = line.startsWith('+++') || line.startsWith('---')
              ? 'meta'
              : line.startsWith('@@')
                ? 'hunk'
                : line.startsWith('diff ') || line.startsWith('index ')
                  ? 'meta'
                  : line.startsWith('+')
                    ? 'add'
                    : line.startsWith('-')
                      ? 'del'
                      : 'ctx';
            return (
              <span key={i} className={`dl dl-${kind}`}>
                {line || ' '}
              </span>
            );
          })}
        </pre>
      )}
    </div>
  );
}

function PullRail({ detail, projectPath }: { detail: PullDetail; projectPath: string }) {
  const open = usePulls((s) => s.open);
  const assignees = detail.assignees ?? [];
  const reviewers = detail.reviewRequests ?? [];
  const checks = detail.statusCheckRollup ?? [];
  const verdict = rollup(checks);

  return (
    <aside className="pull-rail">
      <div className="rail-block">
        <div className="rail-head">
          <span>Pull request</span>
          <span className={cls('pr-state', `pr-state-${stateOf(detail).tone}`)}>
            {stateOf(detail).label}
          </span>
        </div>
        {detail.mergedAt && (
          <div className="rail-line">merged {timeAgo(new Date(detail.mergedAt).getTime())}</div>
        )}
        {detail.state === 'OPEN' && detail.mergeable && detail.mergeable !== 'UNKNOWN' && (
          <div className="rail-line">
            merge state <code>{detail.mergeable}</code>
          </div>
        )}
      </div>

      <div className="rail-block">
        <div className="rail-head">
          <span>Assignees</span>
        </div>
        <div className="rail-line">
          {assignees.length === 0
            ? 'No one assigned'
            : assignees.map((a) => a.login).join(', ')}
        </div>
      </div>

      <div className="rail-block">
        <div className="rail-head">
          <span>Reviewers</span>
        </div>
        <div className="rail-line">
          {reviewers.length === 0
            ? 'No reviewers requested'
            : reviewers.map((r) => r.login ?? r.slug ?? r.name).join(', ')}
        </div>
      </div>

      {checks.length > 0 && (
        <div className="rail-block">
          <div className="rail-head">
            <span>Checks</span>
            <button
              className="icon-btn"
              title="Refresh checks"
              onClick={() => open(projectPath, detail.number)}
            >
              <IconRefresh size={12} />
            </button>
          </div>
          <div className="rail-line">
            {verdict === 'pass' && (
              <span className="check-text-pass">
                <IconCheck size={11} /> All checks passing
              </span>
            )}
            {verdict === 'fail' && <span className="check-text-fail">Some checks failed</span>}
            {verdict === 'pending' && <span className="check-text-pending">Checks running</span>}
          </div>
        </div>
      )}

      <div className="rail-block">
        <div className="rail-head">
          <span>Changes</span>
        </div>
        <div className="rail-line">
          {detail.changedFiles} {detail.changedFiles === 1 ? 'file' : 'files'}
          <span className="pull-diffstat">
            <span className="add">+{detail.additions}</span>
            <span className="del">−{detail.deletions}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
