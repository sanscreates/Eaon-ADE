import { terminals } from './terminals'
import { useStore } from '../store/useStore'

/**
 * Where dictated text should land.
 *
 * A focused terminal is not obviously a terminal from the DOM's point of view —
 * xterm keeps a hidden textarea to receive keystrokes, so a plain
 * "is a text field focused?" check would type into the wrong place. The xterm
 * case is therefore ruled out first.
 */
export type InsertTarget =
  | { kind: 'field'; el: HTMLElement }
  | { kind: 'pane'; paneId: string }
  | { kind: 'none' }

function isXtermSurface(el: Element | null): boolean {
  if (!el) return false
  return Boolean(el.classList?.contains('xterm-helper-textarea') || el.closest('.xterm'))
}

function isEditable(el: Element | null): el is HTMLElement {
  if (!el || isXtermSurface(el)) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return ['text', 'search', 'url', 'email', 'tel', 'password', ''].includes(type)
  }
  return (el as HTMLElement).isContentEditable === true
}

export function currentTarget(): InsertTarget {
  const el = document.activeElement
  if (isEditable(el)) return { kind: 'field', el }

  const s = useStore.getState()
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)
  if (ws?.activePaneId) return { kind: 'pane', paneId: ws.activePaneId }
  return { kind: 'none' }
}

/**
 * Insert at the caret of a text field.
 *
 * Goes through execCommand so the browser handles the selection and the edit
 * joins the field's own undo stack — and, because it raises a real input event,
 * React's onChange sees it like any other typing.
 */
function insertIntoField(el: HTMLElement, text: string): boolean {
  el.focus()
  try {
    if (document.execCommand('insertText', false, text)) return true
  } catch {
    /* fall through to setting the value by hand */
  }

  const field = el as HTMLInputElement | HTMLTextAreaElement
  if (typeof field.value !== 'string') return false
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? start
  const next = field.value.slice(0, start) + text + field.value.slice(end)

  // React tracks the value on the DOM node, so assigning `.value` directly is
  // ignored. The prototype setter is the documented way around it.
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  setter ? setter.call(field, next) : (field.value = next)
  field.selectionStart = field.selectionEnd = start + text.length
  field.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

/**
 * Put dictated text wherever the user is working. Returns where it went, so the
 * caller can say something useful when there was nowhere to put it.
 *
 * Text is only ever placed, never submitted. There is deliberately no option to
 * press Return: dictation is a way of typing, and typing does not send by
 * itself. A misheard word is easy to fix while it is sitting on the prompt and
 * impossible to fix once an agent has acted on it.
 */
export function insertText(text: string): InsertTarget {
  if (!text) return { kind: 'none' }
  const target = currentTarget()

  if (target.kind === 'field') {
    insertIntoField(target.el, text)
    return target
  }

  if (target.kind === 'pane') {
    // paste() rather than write() so bracketed paste is honoured — agents that
    // read a multi-line prompt need it to arrive as one block, and a shell that
    // understands bracketed paste will not execute it on arrival.
    terminals.paste(target.paneId, text)
    return target
  }

  return { kind: 'none' }
}
