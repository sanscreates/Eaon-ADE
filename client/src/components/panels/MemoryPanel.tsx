import { useEffect, useMemo, useRef, useState } from 'react';
import { useMemory } from '../../store/memory';
import { useProjects } from '../../store/projects';
import { useUi } from '../../store/ui';
import { useWorkspaces } from '../../store/workspaces';
import { api } from '../../lib/api';
import { Markdown } from '../../lib/miniMarkdown';
import { cls, timeAgo } from '../../lib/utils';
import { MemoryGraph, graphCommand } from '../MemoryGraph';
import { Modal } from '../Modal';
import type { MemoryGraphNode, MemoryNoteSummary, MemorySuggestion } from '../../lib/types';
import {
  IconCheck,
  IconCpu,
  IconExternal,
  IconMaximize,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconX,
} from '../Icons';

/* ═══════════════════════════════════════════════════════════════════════════
   Memory — the project's knowledge graph.

   Three columns, and the middle one is the point: notes on the left to search
   and browse, the graph in the centre because the connections are the reason
   this exists rather than a folder of files, and whatever you have selected on
   the right with its backlinks and its suggested connections.

   Nothing here is the source of truth. The notes are markdown beside the code
   and any agent can rewrite them mid-session, so every mutation goes to the
   server and comes back — see the store.
   ═══════════════════════════════════════════════════════════════════════════ */

export function MemoryPanel() {
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId) ?? null);
  const notes = useMemory((s) => s.notes);
  const graph = useMemory((s) => s.graph);
  const stats = useMemory((s) => s.stats);
  const loading = useMemory((s) => s.loading);
  const error = useMemory((s) => s.error);
  const selectedId = useMemory((s) => s.selectedId);
  const hits = useMemory((s) => s.hits);
  const select = useMemory((s) => s.select);

  const [composing, setComposing] = useState<{ title: string } | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) void useMemory.getState().load(active.path);
  }, [active?.path]);

  // Search results dim everything else in the graph, so a query is a way of
  // looking at the graph rather than a separate list you leave it for.
  const highlight = useMemo(() => (hits ? new Set(hits.map((h) => h.id)) : null), [hits]);

  if (!active) {
    return <div className="panel-empty">Add a project to give it a memory.</div>;
  }

  if (error) {
    return (
      <div className="panel-empty">
        <p>Couldn’t read this project’s memory.</p>
        <p className="panel-empty-hint">{error}</p>
        <p className="panel-empty-hint">
          <a onClick={() => void useMemory.getState().reload()}>Try again</a>
        </p>
      </div>
    );
  }

  const openNode = (node: MemoryGraphNode) => {
    // A ghost node is a link nobody has followed through on. Double-clicking
    // it is the obvious moment to offer writing the note it is asking for.
    if (node.missing) setComposing({ title: node.title });
    else void select(node.id);
  };

  return (
    <div className="mem-panel" ref={shellRef}>
      <Toolbar
        onNew={() => setComposing({ title: '' })}
        onAgents={() => setMcpOpen(true)}
        shellRef={shellRef}
      />

      <div className="mem-body">
        <NoteList onCompose={() => setComposing({ title: '' })} />

        <div className="mem-main">
          <MemoryGraph
            graph={graph}
            selectedId={selectedId}
            onSelect={(id) => void select(id)}
            onOpen={openNode}
            highlight={highlight}
          />
          {notes.length === 0 && !loading && <EmptyState onNew={() => setComposing({ title: '' })} onAgents={() => setMcpOpen(true)} />}
          {stats && notes.length > 0 && (
            <div className="mem-legend">
              <span>{stats.notes} notes</span>
              <span>{stats.links} links</span>
              {stats.dangling > 0 && <span className="mem-legend-ghost">{stats.dangling} unwritten</span>}
              {stats.orphans > 0 && <span>{stats.orphans} unconnected</span>}
            </div>
          )}
        </div>

        <aside className="mem-side">
          {composing ? (
            <Composer initialTitle={composing.title} onClose={() => setComposing(null)} />
          ) : selectedId ? (
            <NoteDetail onCompose={(title) => setComposing({ title })} />
          ) : (
            <Overview onAgents={() => setMcpOpen(true)} />
          )}
        </aside>
      </div>

      {mcpOpen && <McpDialog onClose={() => setMcpOpen(false)} />}
    </div>
  );
}

/* ── toolbar ────────────────────────────────────────────────────────────── */

function Toolbar({
  onNew,
  onAgents,
  shellRef,
}: {
  onNew: () => void;
  onAgents: () => void;
  shellRef: React.RefObject<HTMLDivElement>;
}) {
  const query = useMemory((s) => s.query);
  const setQuery = useMemory((s) => s.setQuery);
  const tags = useMemory((s) => s.tags);
  const activeTag = useMemory((s) => s.activeTag);
  const setTag = useMemory((s) => s.setTag);
  const searching = useMemory((s) => s.searching);

  return (
    <div className="panel-toolbar mem-toolbar">
      <div className="mem-search">
        <IconSearch size={12} />
        <input
          className="mem-search-input"
          placeholder="Search memories…"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
        {(query || searching) && (
          <button className="icon-btn" title="Clear search" onClick={() => setQuery('')}>
            <IconX size={11} />
          </button>
        )}
      </div>

      <div className="mem-tags">
        {tags.slice(0, 10).map((t) => (
          <button
            key={t.tag}
            className={cls('mem-tag', activeTag === t.tag && 'mem-tag-on')}
            onClick={() => setTag(activeTag === t.tag ? null : t.tag)}
            title={`${t.count} note${t.count === 1 ? '' : 's'} tagged #${t.tag}`}
          >
            #{t.tag}
          </button>
        ))}
      </div>

      <div className="mem-toolbar-right">
        <button className="icon-btn" title="Zoom out" onClick={() => graphCommand(shellRef.current, 'out')}>
          <IconMinus size={13} />
        </button>
        <button className="icon-btn" title="Zoom in" onClick={() => graphCommand(shellRef.current, 'in')}>
          <IconPlus size={13} />
        </button>
        <button className="icon-btn" title="Fit graph to view" onClick={() => graphCommand(shellRef.current, 'fit')}>
          <IconMaximize size={13} />
        </button>
        <button className="icon-btn" title="Re-run the layout" onClick={() => graphCommand(shellRef.current, 'reheat')}>
          <IconRefresh size={13} />
        </button>
        <span className="mem-toolbar-sep" />
        <button className="btn btn-sm" onClick={onAgents} title="Let your agents read and write this memory">
          <IconCpu size={12} /> Agents
        </button>
        <button className="btn btn-sm btn-accent" onClick={onNew}>
          <IconPlus size={12} /> New memory
        </button>
      </div>
    </div>
  );
}

/* ── left rail ──────────────────────────────────────────────────────────── */

function NoteList({ onCompose }: { onCompose: () => void }) {
  const notes = useMemory((s) => s.notes);
  const hits = useMemory((s) => s.hits);
  const selectedId = useMemory((s) => s.selectedId);
  const select = useMemory((s) => s.select);
  const query = useMemory((s) => s.query);
  const activeTag = useMemory((s) => s.activeTag);

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const rows: { id: string; title: string; sub: string; tags: string[]; note?: MemoryNoteSummary }[] = hits
    ? hits.map((h) => ({ id: h.id, title: h.title, sub: h.snippet, tags: h.tags, note: byId.get(h.id) }))
    : notes.map((n) => ({ id: n.id, title: n.title, sub: n.excerpt, tags: n.tags, note: n }));

  return (
    <aside className="mem-list">
      <div className="mem-list-head">
        {hits
          ? `${hits.length} match${hits.length === 1 ? '' : 'es'}${activeTag ? ` · #${activeTag}` : ''}`
          : `${notes.length} memor${notes.length === 1 ? 'y' : 'ies'}`}
      </div>
      <div className="mem-list-scroll">
        {rows.length === 0 && (
          <div className="mem-list-empty">
            {query || activeTag ? (
              'Nothing matches.'
            ) : (
              <>
                Nothing written yet.
                <br />
                <a onClick={onCompose}>Write the first one</a>
              </>
            )}
          </div>
        )}
        {rows.map((row) => (
          <button
            key={row.id}
            className={cls('mem-row', row.id === selectedId && 'mem-row-on')}
            onClick={() => void select(row.id)}
          >
            <div className="mem-row-title">{row.title}</div>
            {/* Search snippets carry **marks**; excerpts are plain. Both go
                through the same renderer so a match reads as emphasis. */}
            <div className="mem-row-sub">
              <Markdown source={row.sub} empty="" />
            </div>
            <div className="mem-row-meta">
              {row.tags.slice(0, 3).map((t) => (
                <span key={t} className="mem-row-tag">
                  #{t}
                </span>
              ))}
              {row.note && row.note.linkCount > 0 && (
                <span className="mem-row-links">{row.note.linkCount}→</span>
              )}
              {row.note && <span className="mem-row-age">{timeAgo(Date.parse(row.note.updated))}</span>}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

/* ── right rail: nothing selected ───────────────────────────────────────── */

function Overview({ onAgents }: { onAgents: () => void }) {
  const stats = useMemory((s) => s.stats);
  const suggestions = useMemory((s) => s.globalSuggestions);
  const mcp = useMemory((s) => s.mcp);
  const notes = useMemory((s) => s.notes);

  useEffect(() => {
    void useMemory.getState().loadSuggestions();
    if (!useMemory.getState().mcp) void useMemory.getState().loadMcp();
  }, [notes.length]);

  const connected = mcp?.targets.filter((t) => t.wired) ?? [];

  return (
    <div className="mem-side-inner">
      <div className="mem-side-head">
        <span className="mem-side-title">This project’s memory</span>
      </div>

      {stats && (
        <div className="mem-stats">
          <Stat label="notes" value={stats.notes} />
          <Stat label="links" value={stats.links} />
          <Stat label="unwritten" value={stats.dangling} />
          <Stat label="unconnected" value={stats.orphans} />
        </div>
      )}

      <div className="mem-section">
        <div className="mem-section-head">Agents</div>
        {connected.length > 0 ? (
          <p className="mem-note">
            {connected.map((t) => t.label).join(', ')} can read and write these notes.{' '}
            <a onClick={onAgents}>Change</a>
          </p>
        ) : (
          <p className="mem-note">
            No agent is connected yet. <a onClick={onAgents}>Connect one</a> and it can search this
            memory, write to it, and pick up where the last session left off.
          </p>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Connections worth making</div>
          {suggestions.slice(0, 8).map((s) => (
            <SuggestionRow key={`${s.from}-${s.id}`} suggestion={s} showFrom />
          ))}
        </div>
      )}

      <div className="mem-section">
        <div className="mem-section-head">Where it lives</div>
        <p className="mem-note mem-path">{stats?.dir ?? ''}</p>
        <p className="mem-note">
          Plain markdown beside your code. Commit it and the whole team — and every agent they run —
          starts with what you already worked out.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="mem-stat">
      <div className="mem-stat-value">{value}</div>
      <div className="mem-stat-label">{label}</div>
    </div>
  );
}

/* ── right rail: a selected note ────────────────────────────────────────── */

function NoteDetail({ onCompose }: { onCompose: (title: string) => void }) {
  const detail = useMemory((s) => s.detail);
  const loading = useMemory((s) => s.detailLoading);
  const editing = useMemory((s) => s.editing);
  const select = useMemory((s) => s.select);
  const notes = useMemory((s) => s.notes);
  const askConfirm = useUi((s) => s.askConfirm);

  if (loading && !detail) return <div className="mem-side-inner mem-side-loading">Loading…</div>;
  if (!detail) return <div className="mem-side-inner mem-side-loading">Gone.</div>;

  const { note, backlinks, suggestions } = detail;
  if (editing) return <Editor />;

  // Resolution belongs to the server: `[[Auth flow]]` points at `auth-flow`,
  // and matching the bracket text against ids here would call every link
  // written by title unwritten. `note.links` already carries the answer, keyed
  // by exactly the text the renderer hands back.
  const byRaw = new Map(note.links.map((l) => [l.raw.toLowerCase(), l]));
  const outgoing = note.links;

  return (
    <div className="mem-side-inner">
      <div className="mem-side-head">
        <span className="mem-side-title">{note.title}</span>
        <button className="icon-btn" title="Close" onClick={() => void select(null)}>
          <IconX size={12} />
        </button>
      </div>

      <div className="mem-meta">
        <span title={new Date(note.updated).toLocaleString()}>{timeAgo(Date.parse(note.updated))}</span>
        <span>·</span>
        <span title="Who wrote this">{note.source}</span>
        <span>·</span>
        <code className="mem-id">{note.id}</code>
      </div>

      {note.tags.length > 0 && (
        <div className="mem-tag-row">
          {note.tags.map((t) => (
            <button key={t} className="mem-tag" onClick={() => useMemory.getState().setTag(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      <div className="mem-body-text">
        <Markdown
          source={note.body}
          empty="This memory has no body yet."
          wikiLink={(target, label, key) => {
            const link = byRaw.get(target.toLowerCase());
            const resolved = link?.resolved ? link.target : null;
            return (
              <button
                key={key}
                className={cls('mem-wikilink', !resolved && 'mem-wikilink-missing')}
                title={resolved ? `Go to ${resolved}` : `“${target}” hasn’t been written yet — click to write it`}
                onClick={() => (resolved ? void select(resolved) : onCompose(label))}
              >
                {label}
              </button>
            );
          }}
        />
      </div>

      <div className="mem-actions">
        <button className="btn btn-sm" onClick={() => useMemory.getState().setEditing(true)}>
          Edit
        </button>
        <button
          className="btn btn-sm"
          title={`Open ${note.file} in the editor`}
          onClick={() => void openFileInEditor(note.file)}
        >
          <IconExternal size={11} /> Open file
        </button>
        <button
          className="icon-btn mem-delete"
          title="Delete this memory"
          onClick={() =>
            askConfirm({
              title: 'Delete memory?',
              body: `“${note.title}” will be removed. Notes linking to it keep the link, which will show as unwritten.`,
              confirmLabel: 'Delete',
              danger: true,
              onConfirm: () => void useMemory.getState().remove(note.id),
            })
          }
        >
          <IconTrash size={12} />
        </button>
      </div>

      <div className="mem-section">
        <div className="mem-section-head">
          Links out <span className="mem-count">{outgoing.length}</span>
        </div>
        {outgoing.length === 0 && <p className="mem-note">Nothing yet.</p>}
        {outgoing.map((link) => (
          <button
            key={`${link.target}-${link.raw}`}
            className={cls('mem-link-row', !link.resolved && 'mem-link-row-missing')}
            onClick={() => (link.resolved ? void select(link.target) : onCompose(link.alias || link.raw))}
            title={link.resolved ? link.target : 'Not written yet — click to write it'}
          >
            <span className="mem-link-dot" />
            <span className="mem-link-name">{link.alias || link.raw}</span>
            {!link.resolved && <span className="mem-link-badge">unwritten</span>}
          </button>
        ))}
      </div>

      <div className="mem-section">
        <div className="mem-section-head">
          Backlinks <span className="mem-count">{backlinks.length}</span>
        </div>
        {backlinks.length === 0 && (
          <p className="mem-note">Nothing links here yet — that makes this note hard to find again.</p>
        )}
        {backlinks.map((b) => (
          <button key={b.id} className="mem-link-row" onClick={() => void select(b.id)}>
            <span className="mem-link-dot mem-link-dot-in" />
            <span className="mem-link-body">
              <span className="mem-link-name">{b.title}</span>
              {b.context && <span className="mem-link-context">{b.context}</span>}
            </span>
          </button>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="mem-section">
          <div className="mem-section-head">Suggested connections</div>
          {suggestions.map((s) => (
            <SuggestionRow key={s.id} suggestion={s} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A memory is a file, and sometimes the file is what you want — to see the
 * frontmatter, to fix a link by hand, to paste something long into it. The
 * app already has an editor, so use that rather than shelling out.
 */
async function openFileInEditor(path: string): Promise<void> {
  try {
    const res = await api.get<{ path: string; content: string }>(
      `/api/files/read?path=${encodeURIComponent(path)}`,
    );
    useUi.getState().openInEditor({ path: res.path, content: res.content });
    useWorkspaces.getState().openKindTab('editor');
  } catch (err) {
    useUi.getState().toast(String(err instanceof Error ? err.message : err), 'error');
  }
}

function SuggestionRow({ suggestion, showFrom = false }: { suggestion: MemorySuggestion; showFrom?: boolean }) {
  const select = useMemory((s) => s.select);
  const link = useMemory((s) => s.link);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mem-suggest">
      <button className="mem-suggest-main" onClick={() => void select(suggestion.id)}>
        <span className="mem-suggest-title">
          {showFrom ? (
            <>
              {suggestion.fromTitle} <span className="mem-suggest-arrow">→</span> {suggestion.title}
            </>
          ) : (
            suggestion.title
          )}
        </span>
        <span className="mem-suggest-why">{suggestion.reasons.join(' · ')}</span>
      </button>
      <button
        className="btn btn-sm mem-suggest-link"
        disabled={busy}
        title={`Add a link from ${suggestion.from} to ${suggestion.id}`}
        onClick={async () => {
          setBusy(true);
          await link(suggestion.from, suggestion.id);
          setBusy(false);
        }}
      >
        Link
      </button>
    </div>
  );
}

/* ── editing and writing ────────────────────────────────────────────────── */

function Editor() {
  const detail = useMemory((s) => s.detail)!;
  const [title, setTitle] = useState(detail.note.title);
  const [tags, setTags] = useState(detail.note.tags.join(', '));
  const [body, setBody] = useState(detail.note.body);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const okSave = await useMemory.getState().update(detail.note.id, {
      title: title.trim(),
      content: body,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setSaving(false);
    if (okSave) useMemory.getState().setEditing(false);
  };

  return (
    <div className="mem-side-inner">
      <div className="mem-side-head">
        <span className="mem-side-title">Editing</span>
        <button className="icon-btn" title="Cancel" onClick={() => useMemory.getState().setEditing(false)}>
          <IconX size={12} />
        </button>
      </div>
      <NoteForm
        title={title}
        setTitle={setTitle}
        tags={tags}
        setTags={setTags}
        body={body}
        setBody={setBody}
        onSubmit={save}
      />
      <div className="mem-actions">
        <button className="btn btn-sm btn-accent" disabled={!title.trim() || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-sm" onClick={() => useMemory.getState().setEditing(false)}>
          Cancel
        </button>
        <span className="mem-hint">⌘↵ to save</span>
      </div>
    </div>
  );
}

function Composer({ initialTitle, onClose }: { initialTitle: string; onClose: () => void }) {
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const id = await useMemory.getState().create({
      title: title.trim(),
      content: body,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setSaving(false);
    if (id) onClose();
  };

  return (
    <div className="mem-side-inner">
      <div className="mem-side-head">
        <span className="mem-side-title">New memory</span>
        <button className="icon-btn" title="Cancel" onClick={onClose}>
          <IconX size={12} />
        </button>
      </div>
      <p className="mem-note">
        Something worth not working out twice. Link to another note with{' '}
        <code>[[its title]]</code> — the note does not have to exist yet.
      </p>
      <NoteForm
        title={title}
        setTitle={setTitle}
        tags={tags}
        setTags={setTags}
        body={body}
        setBody={setBody}
        onSubmit={save}
        autoFocus
      />
      <div className="mem-actions">
        <button className="btn btn-sm btn-accent" disabled={!title.trim() || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save memory'}
        </button>
        <button className="btn btn-sm" onClick={onClose}>
          Cancel
        </button>
        <span className="mem-hint">⌘↵ to save</span>
      </div>
    </div>
  );
}

function NoteForm({
  title,
  setTitle,
  tags,
  setTags,
  body,
  setBody,
  onSubmit,
  autoFocus = false,
}: {
  title: string;
  setTitle: (v: string) => void;
  tags: string;
  setTags: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
}) {
  const submitOnMeta = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
    // The panel sits inside the app's global key handler; stop ⌘K and friends
    // from firing while somebody is typing a note.
    e.stopPropagation();
  };

  return (
    <div className="mem-form">
      <div className="field">
        <label className="field-label">Title</label>
        <input
          className="field-input"
          value={title}
          autoFocus={autoFocus}
          spellCheck={false}
          placeholder="What is this about?"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={submitOnMeta}
        />
      </div>
      <div className="field">
        <label className="field-label">
          Tags <em>comma separated</em>
        </label>
        <input
          className="field-input"
          value={tags}
          spellCheck={false}
          placeholder="auth, server"
          onChange={(e) => setTags(e.target.value)}
          onKeyDown={submitOnMeta}
        />
      </div>
      <div className="field">
        <label className="field-label">Body</label>
        <textarea
          className="field-input field-textarea mem-textarea"
          value={body}
          rows={12}
          spellCheck={false}
          placeholder={'What you learned, and why it matters.\n\nRelated: [[another note]]'}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={submitOnMeta}
        />
      </div>
    </div>
  );
}

/* ── empty state ────────────────────────────────────────────────────────── */

function EmptyState({ onNew, onAgents }: { onNew: () => void; onAgents: () => void }) {
  return (
    <div className="mem-empty">
      <div className="mem-empty-card">
        <h2>Nothing remembered yet</h2>
        <p>
          Memories are markdown files in <code>.eaon/memory</code>, beside your code. Link them with{' '}
          <code>[[wikilinks]]</code> and the graph draws itself.
        </p>
        <p>
          Connect your agents and they share this: one writes down how the auth flow works, the next
          one — tomorrow, in a different session, maybe a different CLI — searches for it and finds it.
        </p>
        <div className="mem-empty-actions">
          <button className="btn btn-accent" onClick={onNew}>
            <IconPlus size={13} /> Write the first memory
          </button>
          <button className="btn" onClick={onAgents}>
            <IconCpu size={13} /> Connect agents
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── MCP wiring dialog ──────────────────────────────────────────────────── */

function McpDialog({ onClose }: { onClose: () => void }) {
  const mcp = useMemory((s) => s.mcp);
  const busy = useMemory((s) => s.mcpBusy);
  const toast = useUi((s) => s.toast);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void useMemory.getState().loadMcp();
  }, []);

  return (
    <Modal title="Share this memory with your agents" onClose={onClose} width={620}>
      <p className="mem-note">
        Each agent below can be given an MCP server that reads and writes these notes. Once
        connected it gets <code>create_memory</code>, <code>search_memories</code>,{' '}
        <code>find_backlinks</code> and <code>suggest_connections</code> — and everything it writes
        is here, and in every other agent’s memory too.
      </p>

      {!mcp && <p className="mem-note">Preparing the memory server…</p>}

      {mcp && (
        <>
          <div className="mem-mcp-list">
            {mcp.targets.map((target) => (
              <div key={target.id} className="mem-mcp-row">
                <div className="mem-mcp-info">
                  <div className="mem-mcp-name">
                    {target.label}
                    {target.wired && <span className="mem-mcp-on"><IconCheck size={10} /> connected</span>}
                    {target.stale && <span className="mem-mcp-stale">needs updating</span>}
                  </div>
                  <div className="mem-mcp-file">{target.file}</div>
                  <div className="mem-mcp-note">{target.note}</div>
                </div>
                <button
                  className={cls('btn', 'btn-sm', !target.wired && 'btn-accent')}
                  disabled={busy}
                  onClick={() => void useMemory.getState().setMcpTarget(target.id, !target.wired || target.stale)}
                >
                  {target.wired ? 'Disconnect' : target.stale ? 'Update' : 'Connect'}
                </button>
              </div>
            ))}
          </div>

          <div className="mem-section">
            <div className="mem-section-head">Anything else</div>
            <p className="mem-note">
              For an agent not listed — Codex, Aider, your own — paste this into its MCP config.
            </p>
            <pre className="mem-snippet">{mcp.snippet}</pre>
            <div className="mem-actions">
              <button
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(mcp.snippet);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  } catch {
                    toast('Could not reach the clipboard', 'error');
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy config'}
              </button>
              <span className="mem-hint">
                Restart an already-running agent for it to pick up a new server.
              </span>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
