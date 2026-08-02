import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { ChevronLeft, File, FileText, Folder, RefreshCw, Save, Search } from 'lucide-react'
import type { DirEntry } from '@shared/types'
import { useStore } from '../store/useStore'
import { basename } from '../lib/util'

/** Reads through the same custom properties as the rest of the app, so the
 *  editor repaints with the theme without being rebuilt. */
const THEME = EditorView.theme({
  '&': { color: 'var(--text-mid)', backgroundColor: 'transparent', height: '100%' },
  '.cm-content': { caretColor: 'var(--accent)', fontFamily: 'var(--font-mono)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-wash)'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-dim)',
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: 'var(--ink-300)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-mid)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-panels': { backgroundColor: 'var(--ink-300)', color: 'var(--text-hi)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-wash)' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-wash)', outline: '1px solid var(--accent-edge)' }
})

function languageFor(file: string): Extension[] {
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext))
    return [javascript({ typescript: ext.startsWith('ts'), jsx: ext.endsWith('x') })]
  if (ext === 'json') return [json()]
  if (['md', 'markdown', 'mdx'].includes(ext)) return [markdown()]
  if (ext === 'py') return [python()]
  if (ext === 'rs') return [rust()]
  if (['css', 'scss', 'less'].includes(ext)) return [css()]
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return [html()]
  return []
}

export function EditorPanel({ cwd }: { cwd: string }): React.JSX.Element {
  const notify = useStore((s) => s.notify)

  const [dir, setDir] = useState(cwd)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DirEntry[] | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [doc, setDoc] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [autosave, setAutosave] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saveTimer = useRef<number | null>(null)
  // The editor's change listener is created once per file, so it reads these
  // through refs rather than closing over stale state.
  const autosaveRef = useRef(autosave)
  const fileRef = useRef<string | null>(null)

  useEffect(() => {
    autosaveRef.current = autosave
  }, [autosave])

  useEffect(() => setDir(cwd), [cwd])

  const load = useCallback((): void => {
    window.eaon.fs
      .list(dir)
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [dir])

  useEffect(load, [load])

  useEffect(() => {
    if (!query.trim()) {
      setHits(null)
      return
    }
    const id = window.setTimeout(() => {
      window.eaon.fs.search(cwd, query).then(setHits)
    }, 220)
    return () => window.clearTimeout(id)
  }, [query, cwd])

  const save = useCallback(async (): Promise<void> => {
    const view = viewRef.current
    const target = fileRef.current
    if (!view || !target) return
    await window.eaon.fs.write(target, view.state.doc.toString())
    setDirty(false)
  }, [])

  const open = async (path: string): Promise<void> => {
    try {
      const { text, truncated } = await window.eaon.fs.read(path)
      fileRef.current = path
      setDirty(false)
      setFile(path)
      setDoc(text)
      if (truncated) {
        notify({
          kind: 'info',
          title: 'Showing the first 2 MB',
          text: `${basename(path)} is too large to open in full.`
        })
      }
    } catch (err) {
      notify({
        kind: 'error',
        title: 'Could not open that file',
        text: err instanceof Error ? err.message : String(err)
      })
    }
  }

  // CodeMirror mounts here, not in open(), because the host element does not
  // exist until React has rendered the newly selected file.
  useEffect(() => {
    const host = hostRef.current
    if (!host || file === null || doc === null) return
    viewRef.current?.destroy()
    viewRef.current = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        extensions: [
          basicSetup,
          THEME,
          ...languageFor(file),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            setDirty(true)
            if (saveTimer.current) window.clearTimeout(saveTimer.current)
            saveTimer.current = window.setTimeout(() => {
              if (autosaveRef.current) void save()
            }, 900)
          })
        ]
      })
    })
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [file, doc, save])

  const shown = hits ?? entries
  const atRoot = dir === cwd

  return (
    <div className="panel">
      <div className="panel-bar">
        <div className="field">
          <Search size={13} color="var(--text-dim)" />
          <input
            value={query}
            placeholder="Find a file"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a file"
          />
        </div>
        <button className="icon-btn" onClick={load} title="Refresh" aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
        <button
          className="icon-btn"
          data-on={autosave}
          onClick={() => setAutosave((v) => !v)}
          title="Autosave"
          aria-label="Autosave"
        >
          <FileText size={14} />
        </button>
        <button
          className="icon-btn"
          data-on={dirty}
          disabled={!dirty}
          onClick={save}
          title="Save"
          aria-label="Save"
        >
          <Save size={14} />
        </button>
      </div>

      <div className="panel-split">
        <div className="panel-side">
          {!hits && !atRoot && (
            <button
              className="tree-row"
              onClick={() => setDir(dir.replace(/\/[^/]+\/?$/, '') || '/')}
            >
              <ChevronLeft size={13} />
              <span className="tree-name">Up a level</span>
            </button>
          )}
          {shown.length === 0 && (
            <p style={{ padding: 10, fontSize: 12, color: 'var(--text-dim)' }}>
              {hits ? 'No files match.' : 'This folder is empty.'}
            </p>
          )}
          {shown.map((e) => (
            <button
              className="tree-row"
              key={e.path}
              data-dir={e.isDir}
              data-on={file === e.path}
              onClick={() => (e.isDir ? setDir(e.path) : open(e.path))}
              title={e.path}
            >
              {e.isDir ? <Folder size={13} /> : <File size={13} />}
              <span className="tree-name">{e.name}</span>
            </button>
          ))}
        </div>

        <div className="panel-main">
          {file ? (
            <>
              <div
                className="panel-bar"
                style={{ borderBottom: '1px solid var(--line-100)', gap: 6 }}
              >
                <span
                  className="mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 11,
                    color: 'var(--text-mid)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    direction: 'rtl'
                  }}
                  title={file}
                >
                  {file}
                </span>
                {dirty && <span className="chip">unsaved</span>}
                {autosave && <span className="chip">autosave on</span>}
              </div>
              <div className="editor-host" ref={hostRef} />
            </>
          ) : (
            <div className="empty">
              <strong>Pick a file from the list.</strong>
              <span>Edits save with the button above, or turn on autosave.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
