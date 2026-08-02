import path from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { findModel, type SttEngineState } from '../../shared/stt'
import { isReady, modelsDir } from './models'

interface Reply {
  id: number
  ok: boolean
  text?: string
  ms?: number
  error?: string
}

/** Drop the model after this long unused — a large one holds serious memory. */
const IDLE_UNLOAD_MS = 5 * 60 * 1000

/**
 * Owns the transcriber process: starts it on first use, keeps one model warm
 * while you are dictating, and lets it go once you have clearly stopped.
 */
export class SttHost {
  private child: UtilityProcess | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>()
  private state: SttEngineState = { kind: 'idle' }
  private notify: (s: SttEngineState) => void = () => {}
  private idleTimer: NodeJS.Timeout | null = null
  private loadedModelId = ''

  onState(cb: (s: SttEngineState) => void): void {
    this.notify = cb
  }

  private setState(s: SttEngineState): void {
    this.state = s
    this.notify(s)
  }

  current(): SttEngineState {
    return this.state
  }

  private spawn(): UtilityProcess {
    if (this.child) return this.child

    const child = utilityProcess.fork(path.join(__dirname, 'stt-child.js'), [], {
      serviceName: 'ADE speech',
      // Whisper decoding is allocation-heavy; the default heap is tight for the
      // larger models and an OOM here would read as "dictation just broke".
      execArgv: ['--max-old-space-size=4096']
    })

    child.on('message', (msg: Reply) => {
      const waiter = this.pending.get(msg.id)
      if (!waiter) return
      this.pending.delete(msg.id)
      waiter.resolve(msg)
    })

    child.on('exit', () => {
      const err = new Error('The speech engine stopped unexpectedly')
      for (const [, waiter] of this.pending) waiter.reject(err)
      this.pending.clear()
      this.child = null
      this.loadedModelId = ''
      if (this.state.kind !== 'idle') this.setState({ kind: 'idle' })
    })

    this.child = child
    return child
  }

  private request(payload: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
    const child = this.spawn()
    const id = (this.seq += 1)
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The speech engine did not answer in time'))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      child.postMessage({ ...payload, id })
    })
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stop(), IDLE_UNLOAD_MS)
  }

  /** Bring a model into memory. Safe to call repeatedly; reloads only on change. */
  async load(modelId: string): Promise<void> {
    const model = findModel(modelId)
    if (!model) throw new Error('That speech model is not in the catalogue')
    if (!isReady(modelId)) throw new Error(`${model.label} is not downloaded yet`)
    if (this.loadedModelId === modelId && this.child) {
      this.touch()
      return
    }

    this.setState({ kind: 'loading', modelId })
    try {
      const res = await this.request(
        {
          kind: 'load',
          repo: model.repo,
          root: modelsDir(),
          encoderDtype: model.encoderDtype,
          decoderDtype: model.decoderDtype
        },
        120_000
      )
      if (!res.ok) throw new Error(res.error ?? 'Could not load the model')
      this.loadedModelId = modelId
      this.setState({ kind: 'ready', modelId })
      this.touch()
    } catch (err) {
      this.loadedModelId = ''
      const message = err instanceof Error ? err.message : String(err)
      this.setState({ kind: 'error', message })
      throw err
    }
  }

  async transcribe(modelId: string, audio: Float32Array, language: string): Promise<string> {
    const model = findModel(modelId)
    if (!model) throw new Error('That speech model is not in the catalogue')
    await this.load(modelId)

    this.setState({ kind: 'working', modelId })
    try {
      // Decoding scales with utterance length; a minute of speech on a large
      // model is legitimately slow, so the ceiling is generous.
      const res = await this.request(
        { kind: 'transcribe', audio, multilingual: model.multilingual, language },
        300_000
      )
      if (!res.ok) throw new Error(res.error ?? 'Could not transcribe')
      this.setState({ kind: 'ready', modelId })
      this.touch()
      return res.text ?? ''
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setState({ kind: 'error', message })
      throw err
    }
  }

  /** Shut the engine down and hand its memory back. */
  stop(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (!this.child) return
    try {
      this.child.kill()
    } catch {
      /* it may already be gone */
    }
    this.child = null
    this.loadedModelId = ''
    this.setState({ kind: 'idle' })
  }
}
