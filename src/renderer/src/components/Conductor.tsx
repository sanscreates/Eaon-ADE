import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Mic, Minimize2, Radio, SendHorizontal, X } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { useStore } from '../store/useStore'
import { terminals } from '../lib/terminals'
import { dictation, joinText } from '../lib/dictation'
import { toggleDictation } from '../lib/voice'

type Target = { kind: 'focused' } | { kind: 'all' } | { kind: 'pane'; id: string }

/**
 * One place to type into many shells. The target picker decides who hears it:
 * the pane you are looking at, every pane, or one you name.
 */
export function Conductor({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const open = useStore((s) => s.conductorOpen)
  const toggle = useStore((s) => s.toggleConductor)
  const notify = useStore((s) => s.notify)

  const [text, setText] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [target, setTarget] = useState<Target>({ kind: 'focused' })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dictating, setDictating] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Dictation into the message box appends to whatever is already typed, so
  // you can start with the keyboard and finish out loud.
  useEffect(
    () =>
      dictation.subscribe((s) =>
        setDictating(s.phase === 'listening' || s.phase === 'thinking')
      ),
    []
  )

  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  if (!open) return null

  const resolve = (): string[] => {
    if (target.kind === 'all') return workspace.panes.map((p) => p.id)
    if (target.kind === 'pane') return workspace.panes.some((p) => p.id === target.id) ? [target.id] : []
    return workspace.activePaneId ? [workspace.activePaneId] : []
  }

  const targetLabel = (): string => {
    if (target.kind === 'all') return `all ${workspace.panes.length}`
    if (target.kind === 'pane') return workspace.panes.find((p) => p.id === target.id)?.name ?? 'pane'
    const active = workspace.panes.find((p) => p.id === workspace.activePaneId)
    return active ? active.name : 'no pane'
  }

  const send = (): void => {
    const body = text.trim()
    if (!body) return
    const ids = resolve()
    if (!ids.length) {
      notify({ kind: 'error', title: 'Nowhere to send', text: 'Click a pane first.' })
      return
    }
    for (const id of ids) terminals.send(id, `${body}\r`)
    setText('')
    if (ids.length > 1) {
      notify({
        kind: 'info',
        title: 'Sent to every pane',
        text: `${ids.length} sessions received the same message.`,
        workspaceId: workspace.id
      })
    }
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape') toggle()
  }

  return (
    <div className="conductor" data-expanded={expanded} ref={rootRef}>
      <div className="conductor-row">
        <span className="conductor-orb" aria-hidden="true">
          <Radio size={14} />
        </span>

        <button className="conductor-target" onClick={() => setPickerOpen((v) => !v)}>
          {targetLabel()}
          <ChevronDown size={11} />
        </button>

        {!expanded && (
          <input
            className="conductor-input"
            value={text}
            autoFocus
            placeholder={`Message ${targetLabel()}…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            aria-label="Message to send"
          />
        )}

        <button
          className="icon-btn conductor-mic"
          data-on={dictating}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            void toggleDictation({
              sink: (chunk) => setText((prev) => joinText(prev, chunk))
            })
          }
          title={dictating ? 'Stop dictating' : 'Dictate this message'}
          aria-label={dictating ? 'Stop dictating' : 'Dictate this message'}
          aria-pressed={dictating}
        >
          <Mic size={14} />
        </button>

        <button
          className="icon-btn"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Write a longer message'}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        <button className="conductor-send" onClick={send} disabled={!text.trim()} aria-label="Send">
          <SendHorizontal size={14} />
        </button>

        <button className="icon-btn" onClick={toggle} title="Close" aria-label="Close conductor">
          <X size={14} />
        </button>
      </div>

      {expanded && (
        <textarea
          className="conductor-multi"
          value={text}
          autoFocus
          placeholder={`Message ${targetLabel()}…  Enter sends, Shift+Enter adds a line.`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          aria-label="Message to send"
        />
      )}

      {pickerOpen && (
        <div className="target-menu">
          <button
            className="menu-item"
            onClick={() => {
              setTarget({ kind: 'focused' })
              setPickerOpen(false)
            }}
          >
            The pane I am in
            {target.kind === 'focused' && <span className="kbd">on</span>}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setTarget({ kind: 'all' })
              setPickerOpen(false)
            }}
          >
            Every pane here
            {target.kind === 'all' && <span className="kbd">on</span>}
          </button>
          <div className="menu-sep" />
          {workspace.panes.map((p) => (
            <button
              className="menu-item"
              key={p.id}
              onClick={() => {
                setTarget({ kind: 'pane', id: p.id })
                setPickerOpen(false)
              }}
            >
              {p.name}
              {target.kind === 'pane' && target.id === p.id && <span className="kbd">on</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
