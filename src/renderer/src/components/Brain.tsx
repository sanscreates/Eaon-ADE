import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  Check,
  FileText,
  Link2,
  Network,
  Plug,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import type { BrainGraph as Graph, BrainStats, Memory, MemoryMeta } from '@shared/brain'
import { useActiveWorkspace, useStore } from '../store/useStore'
import { relTime } from '../lib/util'
import { BrainGraph } from './BrainGraph'

type Related = {
  backlinks: MemoryMeta[]
  suggested: { meta: MemoryMeta; terms: string[] }[]
}

/**
 * Eaon Brain — what the project knows, kept as markdown beside the code.
 *
 * The same files are edited here and by agents over MCP, so everything reloads
 * from disk after a write rather than trusting local state.
 */
export function Brain(): React.JSX.Element {
  const workspace = useActiveWorkspace()
  const notify = useStore((s) => s.notify)

  const [stats, setStats] = useState<BrainStats | null>(null)
  const [registered, setRegistered] = useState(false)
  const [list, setList] = useState<MemoryMeta[]>([])
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [], orphans: [] })
  const [selected, setSelected] = useState<string | null>(null)
  const [memory, setMemory] = useState<Memory | null>(null)
  const [related, setRelated] = useState<Related>({ backlinks: [], suggested: [] })
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'note' | 'graph'>('note')
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null)

  const cwd = workspace?.cwd ?? null

  const refresh = useCallback(async () => {
    const [items, g, s] = await Promise.all([
      window.eaon.brain.list(),
      window.eaon.brain.graph(),
      window.eaon.brain.stats()
    ])
    setList(items)
    setGraph(g)
    setStats(s)
  }, [])

  useEffect(() => {
    let live = true
    window.eaon.brain.open(cwd).then((res) => {
      if (!live) return
      setStats(res.stats)
      setRegistered(res.registered)
      void refresh()
    })
    return () => {
      live = false
    }
  }, [cwd, refresh])

  useEffect(() => {
    if (!selected) {
      setMemory(null)
      setRelated({ backlinks: [], suggested: [] })
      return
    }
    let live = true
    Promise.all([window.eaon.brain.get(selected), window.eaon.brain.related(selected)]).then(
      ([m, r]) => {
        if (!live) return
        setMemory(m)
        setRelated(r)
        setDraft(m ? { title: m.title, body: m.content } : null)
      }
    )
    return () => {
      live = false
    }
  }, [selected, list])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (m) => m.title.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [list, query])

  const save = async (): Promise<void> => {
    if (!draft || !memory) return
    await window.eaon.brain.write({
      slug: memory.slug,
      title: draft.title,
      content: draft.body,
      tags: memory.tags
    })
    await refresh()
    notify({ kind: 'info', title: 'Saved', text: draft.title })
  }

  const create = async (): Promise<void> => {
    const saved = await window.eaon.brain.write({
      title: 'Untitled memory',
      content: 'What did you learn?\n'
    })
    if (!saved) return
    await refresh()
    setSelected(saved.slug)
    setView('note')
  }

  if (!cwd) {
    return (
      <div className="surface-scroll">
        <div className="surface-inner">
          <div className="empty" style={{ paddingTop: 80 }}>
            <strong>Open a workspace first.</strong>
            <span>The brain lives in a folder beside your code, so it needs one.</span>
          </div>
        </div>
      </div>
    )
  }

  const dirty =
    Boolean(memory && draft) && (draft!.title !== memory!.title || draft!.body !== memory!.content)

  return (
    <div className="brain">
      <header className="brain-bar">
        <div className="brain-identity">
          <h1 className="brain-title">Brain</h1>
          <span className="brain-stats mono">
            {stats
              ? `${stats.memories} memories · ${stats.links} links${stats.orphans ? ` · ${stats.orphans} orphan${stats.orphans === 1 ? '' : 's'}` : ''}`
              : '…'}
          </span>
        </div>

        <div className="field brain-search">
          <Search size={13} color="var(--text-dim)" />
          <input
            value={query}
            placeholder="Search memories"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search memories"
          />
        </div>

        <span
          className="brain-mcp"
          data-on={registered}
          title={
            registered
              ? 'Agents started here can read and write these memories over MCP, and carry a skill telling them to search before exploring and record what they learn. Claude Code asks to approve the server once.'
              : 'Not connected to agents yet — starting one in this folder wires it up'
          }
        >
          {registered ? <Check size={11} /> : <Plug size={11} />}
          Agents
        </span>

        <button
          className="btn"
          data-on={view === 'graph'}
          onClick={() => setView(view === 'graph' ? 'note' : 'graph')}
          style={{ height: 30 }}
        >
          {view === 'graph' ? <FileText size={13} /> : <Network size={13} />}
          {view === 'graph' ? 'Note' : 'Graph'}
        </button>
        <button className="btn btn-primary" style={{ height: 30 }} onClick={create}>
          <Plus size={13} />
          Memory
        </button>
      </header>

      <div className="brain-body">
        <nav className="brain-list" aria-label="Memories">
          {filtered.length === 0 && (
            <p className="brain-hint">
              {list.length === 0
                ? 'Nothing recorded yet. Agents write here as they work, or start one yourself.'
                : 'No memory matches that.'}
            </p>
          )}
          {filtered.map((m) => (
            <button
              className="brain-item"
              key={m.slug}
              data-on={selected === m.slug}
              onClick={() => {
                setSelected(m.slug)
                setView('note')
              }}
            >
              <FileText size={13} />
              <span className="brain-item-text">
                <span className="brain-item-title">{m.title}</span>
                <span className="brain-item-meta mono">
                  {m.links.length + m.backlinks.length} links · {relTime(Date.parse(m.updated))}
                </span>
              </span>
            </button>
          ))}
        </nav>

        <section className="brain-main">
          {view === 'graph' ? (
            <BrainGraph
              graph={graph}
              selected={selected}
              onSelect={(slug) => {
                setSelected(slug)
                setView('note')
              }}
            />
          ) : memory && draft ? (
            <div className="brain-editor">
              <input
                className="brain-editor-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                aria-label="Memory title"
              />
              <textarea
                className="brain-editor-body"
                value={draft.body}
                spellCheck={false}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                aria-label="Memory content"
                placeholder="Markdown. Link another memory with [[Its Title]]."
              />
              <div className="brain-editor-foot">
                <span className="mono brain-path">{memory.path.split('/').slice(-2).join('/')}</span>
                <span style={{ flex: 1 }} />
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    if (!window.confirm(`Delete "${memory.title}"?`)) return
                    await window.eaon.brain.remove(memory.slug)
                    setSelected(null)
                    await refresh()
                  }}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
                <button className="btn btn-primary" disabled={!dirty} onClick={save}>
                  {dirty ? 'Save' : 'Saved'}
                </button>
              </div>
            </div>
          ) : (
            <div className="empty" style={{ height: '100%' }}>
              <strong>Pick a memory, or open the graph.</strong>
              <span>
                Everything here is markdown in .eaonbrain/ — commit it with your code. Agents read
                and write it over MCP, guided by the skill in .claude/skills/eaon-brain/.
              </span>
            </div>
          )}
        </section>

        <aside className="brain-inspector">
          {memory ? (
            <>
              <p className="eyebrow">Links out {memory.links.length}</p>
              {memory.links.length === 0 && <p className="brain-hint">None yet.</p>}
              {memory.links.map((slug) => (
                <button className="brain-ref" key={slug} onClick={() => setSelected(slug)}>
                  <Link2 size={12} />
                  {list.find((m) => m.slug === slug)?.title ?? slug}
                </button>
              ))}

              {memory.unresolved.length > 0 && (
                <>
                  <p className="eyebrow" style={{ marginTop: 16 }}>
                    Not written yet {memory.unresolved.length}
                  </p>
                  {memory.unresolved.map((t) => (
                    <span className="brain-ref" key={t} data-missing="true">
                      <Link2 size={12} />
                      {t}
                    </span>
                  ))}
                </>
              )}

              <p className="eyebrow" style={{ marginTop: 16 }}>
                Backlinks {related.backlinks.length}
              </p>
              {related.backlinks.length === 0 && <p className="brain-hint">Nothing links here.</p>}
              {related.backlinks.map((m) => (
                <button className="brain-ref" key={m.slug} onClick={() => setSelected(m.slug)}>
                  <ArrowLeftRight size={12} />
                  {m.title}
                </button>
              ))}

              {related.suggested.length > 0 && (
                <>
                  <p className="eyebrow" style={{ marginTop: 16 }}>
                    Suggested {related.suggested.length}
                  </p>
                  {related.suggested.map((s) => (
                    <button
                      className="brain-ref brain-suggested"
                      key={s.meta.slug}
                      onClick={() => setSelected(s.meta.slug)}
                    >
                      <span>{s.meta.title}</span>
                      <span className="brain-terms mono">{s.terms.join(' · ')}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          ) : (
            <p className="brain-hint">
              Memories are shared with every agent you run here over MCP. What one session learns,
              the next one starts with.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
