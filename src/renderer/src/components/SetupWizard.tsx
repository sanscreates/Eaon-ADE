import { useEffect, useState } from 'react'
import { Check, Folder, FolderOpen, Pencil, Plus, Terminal } from 'lucide-react'
import { LAYOUTS, gridShape, type Preset } from '@shared/types'
import { useStore } from '../store/useStore'
import { basename, shortPath, uid } from '../lib/util'

const STEPS = ['Start', 'Layout', 'Agents'] as const

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

function MiniGrid({ count }: { count: number }): React.JSX.Element {
  const { cols, rows } = gridShape(count)
  return (
    <span
      className="mini-grid"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      aria-hidden="true"
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  )
}

export function SetupWizard(): React.JSX.Element | null {
  const draft = useStore((s) => s.wizard)
  const update = useStore((s) => s.updateWizard)
  const close = useStore((s) => s.closeWizard)
  const create = useStore((s) => s.createWorkspace)
  const recents = useStore((s) => s.recents)
  const presets = useStore((s) => s.presets)
  const agents = useStore((s) => s.agents)
  const home = useStore((s) => s.home)
  const setPresetEditor = useStore((s) => s.setPresetEditor)
  const savePreset = useStore((s) => s.savePreset)

  const [pathValid, setPathValid] = useState(true)

  useEffect(() => {
    if (!draft?.cwd) return
    let live = true
    window.eaon.fs.isDir(draft.cwd).then((ok) => live && setPathValid(ok))
    return () => {
      live = false
    }
  }, [draft?.cwd])

  if (!draft) return null

  const { cols, rows } = gridShape(draft.layout)

  const browse = async (): Promise<void> => {
    const picked = await window.eaon.fs.pickFolder(draft.cwd)
    if (picked) update({ cwd: picked })
  }

  const applyPreset = (p: Preset): void => {
    update({ layout: p.layout, agentId: p.agentId, prompt: p.prompt ?? '', presetId: p.id, cwd: p.cwd ?? draft.cwd })
  }

  const saveAsPreset = (): void => {
    const name = window.prompt('Name this preset', `${basename(draft.cwd)} ${draft.layout}`)
    if (!name) return
    savePreset({
      id: uid('pre_'),
      name,
      layout: draft.layout,
      agentId: draft.agentId,
      cwd: draft.cwd,
      prompt: draft.prompt || undefined
    })
  }

  const next = (): void => {
    if (draft.step < 2) update({ step: (draft.step + 1) as 0 | 1 | 2 })
    else create(draft)
  }

  const canAdvance = draft.step === 0 ? Boolean(draft.cwd) && pathValid : true

  return (
    <div className="surface-scroll">
      <div className="surface-inner">
        <div className="stepper">
          {STEPS.map((label, i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <span className="step-rule" data-done={draft.step >= i} />}
              <button
                className="step"
                data-state={draft.step === i ? 'current' : draft.step > i ? 'done' : 'todo'}
                onClick={() => draft.step > i && update({ step: i as 0 | 1 | 2 })}
              >
                <span className="step-num">{draft.step > i ? <Check size={11} /> : i + 1}</span>
                {label}
              </button>
            </div>
          ))}
        </div>

        {draft.step === 0 && (
          <>
            <div className="wizard-head">
              <h1 className="wizard-title">Where are you working?</h1>
              <p className="wizard-sub">Every terminal in this workspace starts in this folder.</p>
            </div>

            <div className="section">
              <div className="field" style={{ borderColor: pathValid ? undefined : 'var(--danger)' }}>
                <Folder size={15} color="var(--text-dim)" />
                <input
                  value={draft.cwd}
                  spellCheck={false}
                  onChange={(e) => update({ cwd: e.target.value })}
                  placeholder="/Users/you/projects/thing"
                  aria-label="Working folder"
                />
                <button className="btn btn-ghost" style={{ height: 28 }} onClick={browse}>
                  <FolderOpen size={14} />
                  Browse
                </button>
              </div>
              {!pathValid && (
                <p className="section-note" style={{ color: 'var(--danger)', marginTop: 8 }}>
                  That folder does not exist. Pick another one.
                </p>
              )}
            </div>

            {recents.length > 0 && (
              <div className="section">
                <div className="section-head">
                  <span className="eyebrow">Recent</span>
                  <span className="section-note">{recents.length} folders</span>
                </div>
                <div className="card-grid">
                  {recents.map((r) => (
                    <button
                      className="folder-card"
                      key={r.path}
                      data-on={r.path === draft.cwd}
                      onClick={() => update({ cwd: r.path })}
                    >
                      <Folder size={16} />
                      <span className="folder-text">
                        <span className="folder-name">{r.name}</span>
                        <span className="folder-path">{shortPath(r.path, home)}</span>
                      </span>
                      {r.sessions > 0 && <span className="chip">{r.sessions}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {draft.step === 1 && (
          <>
            <div className="wizard-head">
              <h1 className="wizard-title">How many terminals?</h1>
              <p className="wizard-sub">Pick a tile. You can add or close panes later.</p>
            </div>

            <div className="section">
              <div className="section-head">
                <span className="eyebrow">Layout</span>
                <div className="section-right">
                  <span className="chip" style={{ color: 'var(--accent)' }}>
                    {draft.layout} terminal{draft.layout === 1 ? '' : 's'}
                  </span>
                  <span className="section-note">
                    {cols}×{rows} grid
                  </span>
                </div>
              </div>
              <div className="layout-tiles">
                {LAYOUTS.map((n) => (
                  <button
                    className="layout-tile"
                    key={n}
                    data-on={draft.layout === n}
                    onClick={() => update({ layout: n })}
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
                <span className="eyebrow">Presets</span>
                <span className="section-note">{presets.length} saved</span>
                <div className="section-right">
                  <button className="btn btn-ghost" style={{ height: 26 }} onClick={saveAsPreset}>
                    Save current
                  </button>
                </div>
              </div>
              <div className="preset-row">
                {presets.map((p) => (
                  <span className="preset-chip" key={p.id} data-on={draft.presetId === p.id}>
                    <MiniGrid count={p.layout} />
                    <button onClick={() => applyPreset(p)} style={{ color: 'inherit' }}>
                      {p.name}
                    </button>
                    <span
                      className="preset-edit"
                      role="button"
                      tabIndex={0}
                      aria-label={`Edit ${p.name}`}
                      onClick={() => setPresetEditor(p.id)}
                      onKeyDown={(e) => e.key === 'Enter' && setPresetEditor(p.id)}
                    >
                      <Pencil size={11} />
                    </span>
                  </span>
                ))}
                <button className="preset-chip preset-chip-new" onClick={() => setPresetEditor('new')}>
                  <Plus size={12} />
                  New preset
                </button>
              </div>
            </div>
          </>
        )}

        {draft.step === 2 && (
          <>
            <div className="wizard-head">
              <h1 className="wizard-title">Which agent runs in each pane?</h1>
              <p className="wizard-sub">
                Eaon ADE types the command into a fresh shell. Anything greyed out is not on your PATH.
              </p>
            </div>

            <div className="section">
              <div className="agent-list">
                {agents.map((a) => (
                  <button
                    className="agent-row"
                    key={a.id}
                    data-on={draft.agentId === a.id}
                    disabled={a.available === false}
                    onClick={() => update({ agentId: a.id })}
                  >
                    <span className="agent-mark">
                      <Terminal size={15} />
                    </span>
                    <span className="agent-meta">
                      <span className="agent-name">{a.label}</span>
                      <span className="agent-blurb">
                        {a.available === false ? `${a.bin} not found on PATH` : a.blurb}
                      </span>
                    </span>
                    {a.bin && <span className="chip mono">{a.bin}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-head">
                <span className="eyebrow">Opening prompt</span>
                <span className="section-note">
                  {draft.mode === 'swarm'
                    ? 'Sent to every pane once the agents are up.'
                    : 'Optional. Sent to every pane once the agents are up.'}
                </span>
              </div>
              <textarea
                className="prompt-box"
                value={draft.prompt}
                onChange={(e) => update({ prompt: e.target.value })}
                placeholder={
                  draft.mode === 'swarm'
                    ? 'Find every place we still call the v1 endpoint and propose a migration.'
                    : 'Leave blank to start each agent with an empty prompt.'
                }
              />
            </div>
          </>
        )}

        <div className="wizard-foot">
          <button
            className="btn btn-ghost"
            onClick={() => (draft.step === 0 ? close() : update({ step: (draft.step - 1) as 0 | 1 | 2 }))}
          >
            {draft.step === 0 ? 'Cancel' : 'Back'}
          </button>
          <span className="spacer" />
          {draft.step === 2 && (
            <button
              className="btn"
              onClick={() => create({ ...draft, agentId: 'shell', prompt: '' })}
            >
              Open without agents
            </button>
          )}
          <button className="btn btn-primary" onClick={next} disabled={!canAdvance}>
            {draft.step === 2 ? 'Open workspace' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
