import { useEffect, useState } from 'react'
import { Plus, SendHorizontal, Trash2 } from 'lucide-react'
import type { VaultNote } from '@shared/types'
import { useActiveWorkspace, useStore } from '../store/useStore'
import { terminals } from '../lib/terminals'
import { relTime, uid } from '../lib/util'

/**
 * Prompts and context you keep re-typing. Send one into the pane you are in
 * instead of pasting it from a scratch file.
 */
export function Vault(): React.JSX.Element {
  const vault = useStore((s) => s.vault)
  const saveNote = useStore((s) => s.saveNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const notify = useStore((s) => s.notify)
  const workspace = useActiveWorkspace()

  const [selectedId, setSelectedId] = useState<string | null>(vault[0]?.id ?? null)
  const selected = vault.find((n) => n.id === selectedId) ?? null

  useEffect(() => {
    if (!selected && vault.length) setSelectedId(vault[0].id)
  }, [vault, selected])

  const create = (): void => {
    const note: VaultNote = {
      id: uid('v_'),
      title: 'Untitled note',
      body: '',
      updatedAt: Date.now()
    }
    saveNote(note)
    setSelectedId(note.id)
  }

  const patch = (p: Partial<VaultNote>): void => {
    if (!selected) return
    saveNote({ ...selected, ...p, updatedAt: Date.now() })
  }

  const send = (): void => {
    const paneId = workspace?.activePaneId
    if (!selected || !workspace || !paneId) {
      notify({
        kind: 'error',
        title: 'No pane to send it to',
        text: 'Open a workspace and click a terminal first.'
      })
      return
    }
    terminals.send(paneId, `${selected.body.trim()}\r`)
    notify({ kind: 'info', title: 'Sent', text: selected.title, workspaceId: workspace.id })
  }

  return (
    <div className="surface-scroll">
      <div className="surface-inner" style={{ width: 'min(1100px, 100%)' }}>
        <div className="wizard-head" style={{ textAlign: 'left', marginBottom: 24 }}>
          <h1 className="wizard-title">Vault</h1>
          <p className="wizard-sub">Context you reuse. Drop any note straight into a session.</p>
        </div>

        <div className="vault-layout">
          <div className="vault-list">
            <button className="btn btn-ghost" style={{ marginBottom: 6 }} onClick={create}>
              <Plus size={14} />
              New note
            </button>
            {vault.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-dim)', padding: '4px 8px' }}>
                Nothing saved yet.
              </p>
            )}
            {vault.map((n) => (
              <button
                className="vault-item"
                key={n.id}
                data-on={n.id === selectedId}
                onClick={() => setSelectedId(n.id)}
              >
                <div className="vault-item-title">{n.title || 'Untitled note'}</div>
                <div className="vault-item-when">{relTime(n.updatedAt)}</div>
              </button>
            ))}
          </div>

          <div className="vault-editor">
            {selected ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    className="vault-title-input"
                    value={selected.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    aria-label="Note title"
                  />
                  <button className="btn" style={{ height: 30 }} onClick={send} disabled={!selected.body.trim()}>
                    <SendHorizontal size={13} />
                    Send to pane
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => {
                      deleteNote(selected.id)
                      setSelectedId(null)
                    }}
                    aria-label="Delete note"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <textarea
                  className="vault-body-input"
                  value={selected.body}
                  placeholder="Paste the prompt, the conventions, the API shape — whatever you keep repeating."
                  onChange={(e) => patch({ body: e.target.value })}
                  aria-label="Note body"
                />
              </>
            ) : (
              <div className="empty">
                <strong>No note selected.</strong>
                <span>Make one and it saves as you type.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
