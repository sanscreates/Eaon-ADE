import { useState } from 'react';
import { api } from '../../lib/api';
import { useProjects } from '../../store/projects';
import { useGit } from '../../store/git';
import { useUi } from '../../store/ui';
import { useWorkspaces } from '../../store/workspaces';
import { cls } from '../../lib/utils';
import { IconGitBranch, IconRefresh } from '../Icons';

const STATUS_LABELS: Record<string, string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', '?': '?', C: 'C', U: 'U',
};

export function GitPanel() {
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const git = useGit((s) => s.status);
  const refresh = useGit((s) => s.refresh);
  const openInEditor = useUi((s) => s.openInEditor);
  const toast = useUi((s) => s.toast);
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);

  if (!active) return <div className="panel-empty">Add a project to see git status.</div>;
  if (!git) return <div className="panel-empty">Loading…</div>;
  if (!git.isRepo) return <div className="panel-empty">Not a git repository.</div>;

  const showDiff = async (file: string) => {
    try {
      const res = await api.get<{ original: string; modified: string }>(
        `/api/git/diff?path=${encodeURIComponent(active.path)}&file=${encodeURIComponent(file)}`,
      );
      openInEditor({
        path: `${active.path}/${file}`,
        content: '',
        diff: { original: res.original, modified: res.modified },
      });
      useWorkspaces.getState().openKindTab('editor');
    } catch (err) {
      toast(String(err), 'error');
    }
  };

  const commit = async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await api.post('/api/git/commit', { path: active.path, message: message.trim() });
      setMessage('');
      toast('Committed', 'success');
      refresh(active.path);
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="git-panel">
      <div className="panel-toolbar">
        <span className="git-branch-label">
          <IconGitBranch size={13} /> {git.branch}
          {(git.ahead ?? 0) > 0 && <span className="git-chip">↑{git.ahead}</span>}
          {(git.behind ?? 0) > 0 && <span className="git-chip">↓{git.behind}</span>}
        </span>
        <button className="icon-btn" title="Refresh" onClick={() => refresh(active.path)}>
          <IconRefresh size={13} />
        </button>
      </div>

      <div className="git-files">
        {(git.files ?? []).length === 0 && <div className="panel-empty">Working tree clean.</div>}
        {(git.files ?? []).map((f) => {
          const code = f.index || f.worktree || '?';
          return (
            <button key={f.path} className="git-file" onClick={() => showDiff(f.path)} title={`${f.path} — click to view diff`}>
              <span className={cls('git-status', `gs-${code === '?' ? 'untracked' : code}`)}>
                {STATUS_LABELS[code] ?? code}
              </span>
              <span className="git-file-path">{f.path}</span>
            </button>
          );
        })}
      </div>

      <div className="git-commit">
        <textarea
          className="git-commit-input"
          placeholder="Commit message…"
          value={message}
          rows={2}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
          }}
        />
        <button
          className="btn btn-accent btn-sm"
          disabled={!message.trim() || committing || (git.files ?? []).length === 0}
          onClick={commit}
        >
          {committing ? 'Committing…' : `Commit ${(git.files ?? []).length || ''} ${(git.files ?? []).length === 1 ? 'file' : 'files'}`}
        </button>
      </div>
    </div>
  );
}
