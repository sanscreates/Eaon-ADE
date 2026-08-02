import { findModel } from '@shared/stt'
import { useStore } from '../store/useStore'
import { dictation } from './dictation'
import { currentTarget, insertText, type InsertTarget } from './insert'
import { terminals } from './terminals'

/**
 * Ties the microphone to wherever you are typing.
 *
 * Everything here is about deciding *where* dictated text goes and saying
 * something useful when it cannot go anywhere. The capture and transcription
 * themselves live in `dictation.ts` and the main process.
 */

/** Somewhere other than the caret to send text — the Conductor uses this. */
export type VoiceSink = (chunk: string) => void

export interface StartOpts {
  /** Overrides the caret target. */
  sink?: VoiceSink
}

/**
 * The destination is fixed when dictation starts, not looked up per phrase.
 * Text arrives seconds after you speak, and by then the focus may well have
 * moved — resolving late is how dictation ends up in the wrong pane.
 */
let heldTarget: InsertTarget = { kind: 'none' }

export function activeTarget(): InsertTarget {
  return heldTarget
}

/** Human-readable name for wherever dictation is currently pointed. */
export function targetLabel(): string {
  // Copied to a local first: narrowing a mutable module binding does not
  // survive into the callback below.
  const target = heldTarget
  if (target.kind === 'field') return 'the message box'
  if (target.kind === 'pane') {
    const s = useStore.getState()
    const pane = s.workspaces.flatMap((w) => w.panes).find((p) => p.id === target.paneId)
    return pane ? pane.name : 'the pane'
  }
  return 'nowhere'
}

export async function startDictation(opts: StartOpts = {}): Promise<void> {
  const s = useStore.getState()
  const { settings } = s

  const model = findModel(settings.voiceModelId)
  if (!model) {
    s.notify({
      kind: 'error',
      title: 'No speech model yet',
      text: 'Pick one to download in Settings › Voice. Dictation runs on this machine, so it needs a model first.'
    })
    s.setSettingsOpen(true)
    return
  }

  const installed = s.sttInstalled.find((m) => m.id === model.id)
  if (!installed?.complete) {
    s.notify({
      kind: 'error',
      title: `${model.label} is not downloaded`,
      text: 'Finish the download in Settings › Voice, or choose a model you already have.'
    })
    s.setSettingsOpen(true)
    return
  }

  heldTarget = opts.sink ? { kind: 'field', el: document.body } : currentTarget()
  if (!opts.sink && heldTarget.kind === 'none') {
    s.notify({
      kind: 'error',
      title: 'Nowhere to dictate',
      text: 'Click into a pane or a text box first.'
    })
    return
  }

  const target = heldTarget

  await dictation.start({
    settings,
    onText: (chunk) => {
      if (opts.sink) {
        opts.sink(chunk)
        return
      }
      if (target.kind === 'pane') {
        // Placed on the prompt and left there. Dictation never presses Return —
        // the words are yours to read back and send.
        terminals.paste(target.paneId, chunk)
        return
      }
      if (target.kind === 'field') {
        // Re-focus first: the field may have lost the caret to a HUD button.
        target.el.focus()
        insertText(chunk)
      }
    },
    onError: (message) => {
      useStore.getState().notify({ kind: 'error', title: 'Dictation stopped', text: message })
    }
  })

  // Warm the model up while the first phrase is still being spoken, so the
  // first transcription is not also paying the load cost.
  void window.eaon.stt.load(settings.voiceModelId)
}

export async function stopDictation(): Promise<void> {
  await dictation.stop()
}

export function cancelDictation(): void {
  dictation.cancel()
}

export async function toggleDictation(opts: StartOpts = {}): Promise<void> {
  if (dictation.active) {
    await stopDictation()
    return
  }
  await startDictation(opts)
}
