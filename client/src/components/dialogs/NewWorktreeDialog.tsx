import { useState } from 'react';
import { Modal } from '../Modal';
import { useUi } from '../../store/ui';
import { useProjects } from '../../store/projects';
import { api } from '../../lib/api';

export function NewWorktreeDialog() {
  const open = useUi((s) => s.newWorktreeOpen);
  const setOpen = useUi((s) => s.setNewWorktreeOpen);
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const toast = useUi((s) => s.toast);
  const bumpWorktrees = useUi((s) => s.bumpWorktrees);
  const [branch, setBranch] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open || !active) return null;

  const create = async () => {
    if (!branch.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ path: string; branch: string }>('/api/git/worktree', {
        repoPath: active.path,
        name: branch.trim(),
        baseRef: baseRef.trim() || undefined,
      });
      toast(`Worktree ${res.branch} created`, 'success');
      bumpWorktrees();
      setBranch('');
      setBaseRef('');
      setOpen(false);
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New git worktree" onClose={() => setOpen(false)}>
      <label className="field">
        <span className="field-label">Branch name</span>
        <input
          className="field-input"
          placeholder="feat/my-task"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          autoFocus
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span className="field-label">Base ref <em>(optional, defaults to HEAD)</em></span>
        <input
          className="field-input"
          placeholder="main"
          value={baseRef}
          onChange={(e) => setBaseRef(e.target.value)}
          spellCheck={false}
        />
      </label>
      <p className="field-hint">
        The worktree is created at <code>.eaon/worktrees/&lt;branch&gt;</code> — spawn agents into it
        and keep your main checkout untouched.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-accent" onClick={create} disabled={!branch.trim() || busy}>
          {busy ? 'Creating…' : 'Create worktree'}
        </button>
      </div>
    </Modal>
  );
}
