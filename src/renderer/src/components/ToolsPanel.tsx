import { useEffect, useState } from 'react'
import { CircleCheck, CircleSlash, FolderOpen, Play, Terminal } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { useStore } from '../store/useStore'
import { terminals } from '../lib/terminals'

/** Commands worth one click in most repos. */
const COMMON = ['git status -sb', 'git pull --rebase', 'npm test', 'npm run build']

export function ToolsPanel({ workspace }: { workspace: Workspace | null }): React.JSX.Element {
  const agents = useStore((s) => s.agents)
  const notify = useStore((s) => s.notify)
  const [scripts, setScripts] = useState<string[]>([])
  const [command, setCommand] = useState('')
  const [info, setInfo] = useState<{ electron: string; node: string; platform: string } | null>(null)

  const cwd = workspace?.cwd ?? ''
  const target = workspace?.activePaneId ?? null

  useEffect(() => {
    window.eaon.sys.info().then(setInfo)
  }, [])

  useEffect(() => {
    if (!cwd) return
    let live = true
    window.eaon.fs
      .read(`${cwd}/package.json`)
      .then(({ text }) => {
        if (!live) return
        const parsed = JSON.parse(text) as { scripts?: Record<string, string> }
        setScripts(Object.keys(parsed.scripts ?? {}))
      })
      .catch(() => live && setScripts([]))
    return () => {
      live = false
    }
  }, [cwd])

  const run = (line: string): void => {
    if (!target) {
      notify({ kind: 'error', title: 'No pane focused', text: 'Click a terminal first.' })
      return
    }
    terminals.send(target, `${line}\r`)
  }

  const paneName = workspace?.panes.find((p) => p.id === target)?.name

  return (
    <div className="panel">
      <div className="panel-bar">
        <Terminal size={13} color="var(--accent)" />
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text-mid)' }}>
          {paneName ? `Runs in ${paneName}` : 'No pane focused'}
        </span>
      </div>

      <div className="scroll" style={{ flex: 1, padding: 10 }}>
        <div className="tool-card">
          <div className="tool-card-title">
            <Play size={13} />
            Run a command
          </div>
          <div className="tool-card-desc">Typed into the focused pane, exactly as written.</div>
          <div className="field" style={{ height: 32 }}>
            <input
              value={command}
              spellCheck={false}
              placeholder="npm run dev"
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !command.trim()) return
                run(command.trim())
                setCommand('')
              }}
              aria-label="Command to run"
            />
          </div>
          <div className="tool-row" style={{ marginTop: 8 }}>
            {COMMON.map((c) => (
              <button className="chip" key={c} onClick={() => run(c)} style={{ height: 24 }}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {scripts.length > 0 && (
          <div className="tool-card">
            <div className="tool-card-title">
              <Play size={13} />
              Scripts in this repo
            </div>
            <div className="tool-card-desc">Read from package.json in the workspace folder.</div>
            <div className="tool-row">
              {scripts.map((s) => (
                <button
                  className="chip"
                  key={s}
                  style={{ height: 24 }}
                  onClick={() => run(`npm run ${s}`)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="tool-card">
          <div className="tool-card-title">
            <Terminal size={13} />
            Agents on this machine
          </div>
          <div className="tool-card-desc">Checked against your login shell’s PATH.</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {agents
              .filter((a) => a.bin)
              .map((a) => (
                <div
                  key={a.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                >
                  {a.available ? (
                    <CircleCheck size={13} color="var(--live)" />
                  ) : (
                    <CircleSlash size={13} color="var(--text-dim)" />
                  )}
                  <span style={{ color: a.available ? 'var(--text-mid)' : 'var(--text-dim)' }}>
                    {a.label}
                  </span>
                  <span className="chip mono" style={{ marginLeft: 'auto' }}>
                    {a.bin}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {cwd && (
          <div className="tool-card">
            <div className="tool-card-title">
              <FolderOpen size={13} />
              Workspace folder
            </div>
            <div className="tool-card-desc mono" style={{ wordBreak: 'break-all' }}>
              {cwd}
            </div>
            <div className="tool-row">
              <button className="btn" style={{ height: 28 }} onClick={() => window.eaon.sys.reveal(cwd)}>
                Show in Finder
              </button>
              <button
                className="btn"
                style={{ height: 28 }}
                onClick={() => navigator.clipboard.writeText(cwd)}
              >
                Copy path
              </button>
            </div>
          </div>
        )}

        {info && (
          <p className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', padding: '4px 2px' }}>
            {info.platform} · electron {info.electron} · node {info.node}
          </p>
        )}
      </div>
    </div>
  )
}
