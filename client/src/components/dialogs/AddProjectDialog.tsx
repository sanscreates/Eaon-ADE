import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { useUi } from '../../store/ui';
import { useProjects } from '../../store/projects';
import { api } from '../../lib/api';
import { IconChevronRight, IconFolder } from '../Icons';

interface DirEntry {
  name: string;
  path: string;
}

export function AddProjectDialog() {
  const open = useUi((s) => s.addProjectOpen);
  const setOpen = useUi((s) => s.setAddProjectOpen);
  const add = useProjects((s) => s.add);
  const toast = useUi((s) => s.toast);

  const [current, setCurrent] = useState('~');
  const [resolved, setResolved] = useState('');
  const [parent, setParent] = useState('');
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get<{ root: string; parent: string; dirs: DirEntry[] }>(
        `/api/files/dirs?path=${encodeURIComponent(current)}`,
      )
      .then((res) => {
        if (cancelled) return;
        setResolved(res.root);
        setParent(res.parent);
        setDirs(res.dirs);
      })
      .catch(() => {
        if (!cancelled) setDirs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [current, open]);

  if (!open) return null;

  const select = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await add(resolved || current);
      setOpen(false);
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add project" onClose={() => setOpen(false)}>
      <label className="field">
        <span className="field-label">Folder</span>
        <input
          className="field-input"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && select()}
          spellCheck={false}
          autoFocus
        />
      </label>
      <div className="dir-browser">
        <button className="dir-row" onClick={() => setCurrent(parent || '/')}>
          <IconFolder size={13} /> ..
        </button>
        {dirs.map((d) => (
          <button key={d.path} className="dir-row" onClick={() => setCurrent(d.path)}>
            <IconFolder size={13} />
            <span className="dir-name">{d.name}</span>
            <IconChevronRight size={12} className="dir-go" />
          </button>
        ))}
        {dirs.length === 0 && <div className="side-empty">No subfolders</div>}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-accent" onClick={select} disabled={busy}>
          {busy ? 'Adding…' : `Add ${resolved || current}`}
        </button>
      </div>
    </Modal>
  );
}
