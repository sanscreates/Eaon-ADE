import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useProjects } from '../../store/projects';
import { useUi } from '../../store/ui';
import { useWorkspaces } from '../../store/workspaces';
import { useSettings } from '../../store/settings';
import { cls } from '../../lib/utils';
import type { FileNode } from '../../lib/types';
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconRefresh,
  IconSearch,
  IconX,
} from '../Icons';

export function FilesPanel() {
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const openInEditor = useUi((s) => s.openInEditor);
  const toast = useUi((s) => s.toast);
  const [tree, setTree] = useState<FileNode[]>([]);
  const prefHidden = useSettings((s) => s.filesShowHidden);
  const [showHidden, setShowHidden] = useState(prefHidden);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterTree(tree, query.trim()), [tree, query]);

  const load = async () => {
    if (!active) return;
    try {
      const res = await api.get<{ tree: FileNode[] }>(
        `/api/files/tree?path=${encodeURIComponent(active.path)}&depth=4${showHidden ? '&hidden=1' : ''}`,
      );
      setTree(res.tree);
    } catch (err) {
      toast(`Failed to load files: ${err}`, 'error');
    }
  };

  // Follow the preference, while still allowing a per-session override.
  useEffect(() => setShowHidden(prefHidden), [prefHidden]);

  useEffect(() => {
    setTree([]);
    load();
  }, [active?.path, showHidden]);

  const openFile = async (node: FileNode) => {
    try {
      const res = await api.get<{ path: string; content: string }>(
        `/api/files/read?path=${encodeURIComponent(node.path)}`,
      );
      openInEditor({ path: res.path, content: res.content });
      useWorkspaces.getState().openKindTab('editor');
    } catch (err) {
      toast(String(err), 'error');
    }
  };

  if (!active) return <div className="panel-empty">Add a project to browse files.</div>;

  return (
    <div className="files-panel">
      <div className="panel-toolbar">
        <button className="icon-btn" title="Refresh" onClick={load}>
          <IconRefresh size={13} />
        </button>
        <button
          className={cls('btn btn-sm', showHidden && 'btn-active')}
          onClick={() => setShowHidden((v) => !v)}
          title="Show hidden files"
        >
          .*
        </button>
      </div>
      <div className="files-search">
        <IconSearch size={13} />
        <input
          className="files-search-input"
          placeholder="Search files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button className="icon-btn" title="Clear" onClick={() => setQuery('')}>
            <IconX size={12} />
          </button>
        )}
      </div>
      <div className="files-tree">
        {visible.length === 0 && (
          <div className="panel-empty">
            {query ? `Nothing matching “${query}”.` : 'This folder is empty.'}
          </div>
        )}
        {visible.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            onOpenFile={openFile}
            forceOpen={query.length > 0}
          />
        ))}
      </div>
    </div>
  );
}

/** Keep files whose name matches, and directories that still hold a match. */
function filterTree(nodes: FileNode[], q: string): FileNode[] {
  if (!q) return nodes;
  const needle = q.toLowerCase();
  const walk = (list: FileNode[]): FileNode[] =>
    list.flatMap((node) => {
      if (node.kind === 'file') {
        return node.name.toLowerCase().includes(needle) ? [node] : [];
      }
      const children = walk(node.children ?? []);
      if (children.length > 0) return [{ ...node, children }];
      return node.name.toLowerCase().includes(needle) ? [{ ...node, children: [] }] : [];
    });
  return walk(nodes);
}

function TreeRow({
  node,
  depth,
  onOpenFile,
  forceOpen = false,
}: {
  node: FileNode;
  depth: number;
  onOpenFile: (node: FileNode) => void;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(depth < 1);
  const openPath = useUi((s) => s.openFile?.path);
  const expanded = forceOpen || open;

  if (node.kind === 'dir') {
    return (
      <div>
        <button
          className="tree-row"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setOpen((v) => !v)}
        >
          {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          <IconFolder size={13} className="tree-icon-dir" />
          <span className="tree-name">{node.name}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              forceOpen={forceOpen}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={cls('tree-row', openPath === node.path && 'tree-row-open')}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onOpenFile(node)}
      title={node.path}
    >
      <span style={{ width: 12 }} />
      <IconFile size={13} className="tree-icon-file" />
      <span className="tree-name">{node.name}</span>
    </button>
  );
}
