import { useMemo, useState } from 'react'
import { Bookmark, Trash2, X } from 'lucide-react'
import { LAYOUTS, gridShape, type Preset } from '@shared/types'
import { useStore } from '../store/useStore'
import { uid } from '../lib/util'

function TilePreview({ count }: { count: number }): React.JSX.Element {
  const { cols, rows } = gridShape(count)
  return (
    <span
      className="tile-preview"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      aria-hidden="true"
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <i className="tile-cell" key={i} style={{ opacity: i < count ? undefined : 0.12 }} />
      ))}
    </span>
  )
}

export function PresetEditor(): React.JSX.Element | null {
  const editing = useStore((s) => s.presetEditorId)
  const setEditing = useStore((s) => s.setPresetEditor)
  const presets = useStore((s) => s.presets)
  const savePreset = useStore((s) => s.savePreset)
  const deletePreset = useStore((s) => s.deletePreset)
  const agents = useStore((s) => s.agents)
  const settings = useStore((s) => s.settings)

  const original = useMemo(
    () => (editing && editing !== 'new' ? presets.find((p) => p.id === editing) : undefined),
    [editing, presets]
  )

  const [draft, setDraft] = useState<Preset | null>(null)
  const current: Preset =
    draft ??
    original ?? {
      id: uid('pre_'),
      name: '',
      layout: 4,
      agentId: settings.defaultAgentId,
      prompt: ''
    }

  if (!editing) return null

  const patch = (p: Partial<Preset>): void => setDraft({ ...current, ...p })
  const close = (): void => {
    setDraft(null)
    setEditing(null)
  }

  return (
    <div className="scrim" data-align="center" onMouseDown={close}>
      <div
        className="modal"
        role="dialog"
        aria-label="Preset"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-mark">
            <Bookmark size={16} />
          </span>
          <div className="modal-titles">
            <div className="modal-title">{original ? 'Edit preset' : 'New preset'}</div>
            <div className="modal-sub">A named layout you can open in one click.</div>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="section">
            <div className="section-head">
              <span className="eyebrow">Name</span>
            </div>
            <div className="field">
              <input
                autoFocus
                value={current.name}
                placeholder="Review crew"
                onChange={(e) => patch({ name: e.target.value })}
                aria-label="Preset name"
              />
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <span className="eyebrow">Layout</span>
              <span className="section-note">
                {current.layout} terminal{current.layout === 1 ? '' : 's'}
              </span>
            </div>
            <div className="layout-tiles">
              {LAYOUTS.map((n) => (
                <button
                  className="layout-tile"
                  key={n}
                  data-on={current.layout === n}
                  onClick={() => patch({ layout: n })}
                  aria-label={`${n} terminals`}
                >
                  <TilePreview count={n} />
                  <span className="layout-tile-n">{n}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <span className="eyebrow">Agent</span>
            </div>
            <select
              className="select"
              style={{ width: '100%', height: 38 }}
              value={current.agentId}
              onChange={(e) => patch({ agentId: e.target.value })}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-head">
              <span className="eyebrow">Opening prompt</span>
              <span className="section-note">Optional</span>
            </div>
            <textarea
              className="prompt-box"
              value={current.prompt ?? ''}
              placeholder="Sent to every pane when this preset opens."
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </div>
        </div>

        <div className="modal-foot">
          {original && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                deletePreset(original.id)
                close()
              }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!current.name.trim()}
            onClick={() => {
              savePreset({ ...current, name: current.name.trim() })
              close()
            }}
          >
            Save preset
          </button>
        </div>
      </div>
    </div>
  )
}
