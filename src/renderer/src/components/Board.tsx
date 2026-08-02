import { useState } from 'react'
import { Plus, SendHorizontal, Trash2 } from 'lucide-react'
import type { BoardCard } from '@shared/types'
import { useActiveWorkspace, useStore } from '../store/useStore'
import { terminals } from '../lib/terminals'
import { uid } from '../lib/util'

const COLUMNS: { id: BoardCard['column']; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'running', label: 'With an agent' },
  { id: 'review', label: 'Needs review' },
  { id: 'done', label: 'Done' }
]

/**
 * Work you have not started yet. A card becomes a prompt the moment you hand
 * it to a pane, and moves itself into "with an agent".
 */
export function Board(): React.JSX.Element {
  const board = useStore((s) => s.board)
  const saveCard = useStore((s) => s.saveCard)
  const deleteCard = useStore((s) => s.deleteCard)
  const notify = useStore((s) => s.notify)
  const workspace = useActiveWorkspace()

  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const add = (): void => {
    const title = draft.trim()
    if (!title) return
    saveCard({
      id: uid('c_'),
      title,
      notes: '',
      column: 'queued',
      assignedPaneName: null,
      createdAt: Date.now()
    })
    setDraft('')
  }

  const dispatch = (card: BoardCard): void => {
    const paneId = workspace?.activePaneId
    if (!workspace || !paneId) {
      notify({
        kind: 'error',
        title: 'No pane to send it to',
        text: 'Open a workspace and click a terminal first.'
      })
      return
    }
    const pane = workspace.panes.find((p) => p.id === paneId)
    terminals.send(paneId, `${card.title}\r`)
    saveCard({ ...card, column: 'running', assignedPaneName: pane?.name ?? null })
    notify({
      kind: 'info',
      title: `Sent to ${pane?.name ?? 'pane'}`,
      text: card.title,
      workspaceId: workspace.id
    })
  }

  return (
    <div className="surface-scroll">
      <div className="surface-inner" style={{ width: 'min(1200px, 100%)' }}>
        <div className="wizard-head" style={{ textAlign: 'left', marginBottom: 24 }}>
          <h1 className="wizard-title">Board</h1>
          <p className="wizard-sub">
            Park the work you have not started. Hand a card to the pane you are in and it becomes
            the prompt.
          </p>
        </div>

        <div className="field" style={{ marginBottom: 18 }}>
          <Plus size={15} color="var(--text-dim)" />
          <input
            value={draft}
            placeholder="Describe a task, press Enter"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            aria-label="New card"
          />
          <button className="btn btn-ghost" style={{ height: 28 }} onClick={add} disabled={!draft.trim()}>
            Add
          </button>
        </div>

        <div className="board-cols">
          {COLUMNS.map((col) => {
            const cards = board.filter((c) => c.column === col.id)
            return (
              <div
                className="board-col"
                key={col.id}
                data-over={overCol === col.id}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOverCol(col.id)
                }}
                onDragLeave={() => setOverCol((v) => (v === col.id ? null : v))}
                onDrop={() => {
                  setOverCol(null)
                  const card = board.find((c) => c.id === dragId)
                  if (card && card.column !== col.id) saveCard({ ...card, column: col.id })
                  setDragId(null)
                }}
              >
                <div className="board-col-head">
                  <span className="eyebrow">{col.label}</span>
                  <span className="rail-count">{cards.length}</span>
                </div>

                {cards.map((card) => (
                  <article
                    className="board-card"
                    key={card.id}
                    draggable
                    data-dragging={dragId === card.id}
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => setDragId(null)}
                  >
                    <div className="board-card-title">{card.title}</div>
                    <div className="board-card-foot">
                      {card.assignedPaneName && <span className="chip">{card.assignedPaneName}</span>}
                      <span style={{ flex: 1 }} />
                      <button
                        className="icon-btn"
                        style={{ width: 20, height: 20 }}
                        title="Send to the focused pane"
                        aria-label="Send to the focused pane"
                        onClick={() => dispatch(card)}
                      >
                        <SendHorizontal size={12} />
                      </button>
                      <button
                        className="icon-btn"
                        style={{ width: 20, height: 20 }}
                        title="Delete"
                        aria-label="Delete card"
                        onClick={() => deleteCard(card.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </article>
                ))}

                {cards.length === 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', padding: '6px 4px', margin: 0 }}>
                    {col.id === 'queued' ? 'Add a task above.' : 'Drag a card here.'}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
