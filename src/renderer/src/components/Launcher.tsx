import { Columns3, Layers, LayoutList, NotebookPen } from 'lucide-react'
import { useStore } from '../store/useStore'
import { MOD } from '../lib/util'
import { Logo } from './Logo'
import type { SurfaceId } from '@shared/types'

interface Mode {
  id: SurfaceId
  name: string
  desc: string
  key: string
  icon: typeof Columns3
}

const MODES: Mode[] = [
  {
    id: 'grid',
    name: 'Grid',
    desc: 'Up to twelve agents in one view, each in its own shell.',
    key: '1',
    icon: Columns3
  },
  {
    id: 'swarm',
    name: 'Swarm',
    desc: 'Send one task to every pane at once and compare what comes back.',
    key: '2',
    icon: Layers
  },
  {
    id: 'board',
    name: 'Board',
    desc: 'Queue work you have not started, then hand a card to a pane.',
    key: '3',
    icon: LayoutList
  },
  {
    id: 'vault',
    name: 'Vault',
    desc: 'Prompts and context you reuse, ready to drop into any session.',
    key: '4',
    icon: NotebookPen
  }
]

export function Launcher(): React.JSX.Element {
  const openWizard = useStore((s) => s.openWizard)
  const setSurface = useStore((s) => s.setSurface)

  const pick = (mode: SurfaceId): void => {
    if (mode === 'grid' || mode === 'swarm') openWizard(mode)
    else setSurface(mode)
  }

  return (
    <div className="surface-scroll">
      <div className="surface-inner launcher">
        <div className="launcher-mark">
          <Logo size={44} />
          <span className="wordmark">eaon ade</span>
        </div>

        <p className="eyebrow" style={{ marginBottom: 18 }}>
          Agentic development environment
        </p>

        <h1 className="launcher-head">
          Run the room.
          <span className="launcher-caret" aria-hidden="true" />
        </h1>
        <p className="launcher-sub">Four surfaces. Pick where you start.</p>

        <div className="modes">
          {MODES.map((m) => {
            const Icon = m.icon
            return (
              <button className="mode-card" key={m.id} onClick={() => pick(m.id)}>
                <span className="mode-glyph">
                  <Icon size={18} />
                </span>
                <span className="mode-text">
                  <span className="mode-name">{m.name}</span>
                  <span className="mode-desc">{m.desc}</span>
                </span>
                <span className="kbd">
                  {MOD}
                  {m.key}
                </span>
              </button>
            )
          })}
        </div>

        <div className="launcher-hints">
          <span className="launcher-hint">
            <span className="kbd">{MOD}T</span> new workspace
          </span>
          <span className="launcher-hint">
            <span className="kbd">{MOD}K</span> commands
          </span>
          <span className="launcher-hint">
            <span className="kbd">{MOD}D</span> add pane
          </span>
          <span className="launcher-hint">
            <span className="kbd">{MOD},</span> settings
          </span>
        </div>
      </div>
    </div>
  )
}
