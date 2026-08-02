import { SAMPLE_RATE, isPhantom } from '@shared/stt'
import type { Settings } from '@shared/types'

/**
 * Microphone capture and voice-activity segmentation.
 *
 * The microphone is opened only while you are dictating and closed the moment
 * you stop. Audio is held in memory, handed to the local transcriber a phrase
 * at a time, and dropped — it is never written to disk and never leaves the
 * machine.
 *
 * Speech is cut at natural pauses rather than transcribed in one lump. That
 * keeps every request inside Whisper's 30-second window and lets text land
 * while you are still talking.
 */

export type DictationPhase = 'off' | 'starting' | 'listening' | 'thinking' | 'error'

export interface DictationState {
  phase: DictationPhase
  /** Smoothed 0–1 input level, for the meter. */
  level: number
  speaking: boolean
  elapsedMs: number
  /** Everything transcribed so far this session. */
  text: string
  error: string | null
  /** Segments handed over but not yet answered. */
  pending: number
}

const IDLE: DictationState = {
  phase: 'off',
  level: 0,
  speaking: false,
  elapsedMs: 0,
  text: '',
  error: null,
  pending: 0
}

/** Silence that ends a phrase and sends it off to be transcribed. */
const SEGMENT_SILENCE_MS = 700
/** Anything shorter than this is a cough or a key press, not a phrase. */
const MIN_SPEECH_MS = 320
/** Keep a little audio from before speech was detected, so words are not clipped. */
const PRE_ROLL_MS = 200
/** Whisper sees 30s at a time; cut before that so nothing is silently dropped. */
const MAX_SEGMENT_MS = 24_000
/** Absolute noise gate, for a quiet room where the adaptive floor sits near zero. */
const FLOOR_MIN = 0.006
/**
 * Highest level we will ever mistake for background noise.
 *
 * Without this, someone who starts talking the instant they press the key
 * teaches the detector that their own voice is the noise floor, and then
 * nothing is ever loud enough to count as speech. Real rooms sit well under
 * this; speech sits well over it.
 */
const NOISE_CEIL = 0.02
/** How far above the noise floor a frame has to sit to be called speech. */
const SPEECH_MULT = 2.5

/**
 * The capture processor, served as a static asset from the renderer root.
 *
 * Resolved against the document rather than hard-coded, so it is correct both
 * behind the dev server and inside a packaged build's `file://` renderer.
 */
const WORKLET_URL = new URL('ade-capture-worklet.js', document.baseURI).href

/** Frames per message. Must match the batch size in the worklet. */
const FRAME = 1024

function concat(chunks: Float32Array[], from: number, to: number): Float32Array {
  let total = 0
  for (let i = from; i < to; i += 1) total += chunks[i].length
  const out = new Float32Array(total)
  let at = 0
  for (let i = from; i < to; i += 1) {
    out.set(chunks[i], at)
    at += chunks[i].length
  }
  return out
}

/** Straight-line resample. Only used if the browser refuses a 16 kHz context. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i += 1) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0)
  }
  return out
}

/**
 * Your words, unedited.
 *
 * Nothing here rewrites what you said — no filler words removed, no
 * punctuation added, no capitalisation guessed at. The only thing this does is
 * flatten whitespace, and that is a safety measure rather than a stylistic one:
 * a transcript is pasted straight onto a live shell prompt, and a stray newline
 * inside it would submit the line before you had a chance to read it. Runs of
 * whitespace collapse to single spaces so that cannot happen, and the ends are
 * trimmed because Whisper always returns a leading space.
 */
function tidy(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** Join a new phrase onto what is already there without doubling spaces. */
export function joinText(prev: string, next: string): string {
  if (!prev) return next
  if (!next) return prev
  const needsSpace = !/\s$/.test(prev) && !/^[,.!?;:)\]]/.test(next)
  return prev + (needsSpace ? ' ' : '') + next
}

interface StartOptions {
  settings: Settings
  /** Called with each finished phrase, in order, as it comes back. */
  onText: (chunk: string) => void
  onError?: (message: string) => void
}

class DictationController {
  private state: DictationState = { ...IDLE }
  private listeners = new Set<(s: DictationState) => void>()

  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  /** Only set when the worklet could not be loaded. */
  private legacy: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null

  private chunks: Float32Array[] = []
  private samplesSinceSpeech = 0
  private speechSamples = 0
  /** Speech in the phrase being collected. Cleared every time one is sent off. */
  private sawSpeech = false
  /** Speech at any point this session. Drives auto-stop, so it is never cleared. */
  private sessionSawSpeech = false
  private noiseFloor = 0
  private startedAt = 0
  private ticker: number | null = null
  private opts: StartOptions | null = null
  private queue: Promise<void> = Promise.resolve()
  private sessionId = 0
  private ctxRate = SAMPLE_RATE

  subscribe(cb: (s: DictationState) => void): () => void {
    this.listeners.add(cb)
    cb(this.state)
    return () => this.listeners.delete(cb)
  }

  private set(patch: Partial<DictationState>): void {
    this.state = { ...this.state, ...patch }
    for (const cb of this.listeners) cb(this.state)
  }

  get active(): boolean {
    return this.state.phase === 'listening' || this.state.phase === 'starting'
  }

  snapshot(): DictationState {
    return this.state
  }

  async start(opts: StartOptions): Promise<void> {
    if (this.active) return
    this.opts = opts
    this.sessionId += 1
    this.chunks = []
    this.samplesSinceSpeech = 0
    this.speechSamples = 0
    this.sawSpeech = false
    this.sessionSawSpeech = false
    this.noiseFloor = 0
    this.queue = Promise.resolve()
    this.startedAt = Date.now()
    this.set({ ...IDLE, phase: 'starting' })

    try {
      const deviceId = opts.settings.voiceMicId
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      // Asking for the model's rate up front avoids resampling entirely on
      // every browser that honours it, which is all of them in practice.
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
      this.ctxRate = this.ctx.sampleRate

      this.source = this.ctx.createMediaStreamSource(this.stream)

      // A worklet with no destination is not pulled in some engines; a muted
      // gain node keeps the graph running without making a sound.
      const mute = this.ctx.createGain()
      mute.gain.value = 0

      let tap: AudioNode
      try {
        await this.ctx.audioWorklet.addModule(WORKLET_URL)
        const node = new AudioWorkletNode(this.ctx, 'ade-capture')
        node.port.onmessage = (e) => this.onAudio(e.data as Float32Array)
        this.node = node
        tap = node
      } catch (err) {
        // The worklet is the good path, not the only one. If it cannot be
        // loaded, fall back rather than losing dictation altogether — the work
        // per block is a sum and a square root, which the main thread can carry.
        console.warn('[ade] audio worklet unavailable, using fallback:', err)
        const legacy = this.ctx.createScriptProcessor(FRAME * 4, 1, 1)
        legacy.onaudioprocess = (e) => this.onAudio(new Float32Array(e.inputBuffer.getChannelData(0)))
        this.legacy = legacy
        tap = legacy
      }

      this.source.connect(tap)
      tap.connect(mute).connect(this.ctx.destination)

      this.ticker = window.setInterval(() => {
        if (this.state.phase === 'listening') {
          this.set({ elapsedMs: Date.now() - this.startedAt })
        }
      }, 100)

      this.set({ phase: 'listening' })
    } catch (err) {
      const message =
        err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
          ? 'Microphone access was refused. Allow it in System Settings › Privacy & Security › Microphone.'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No microphone was found.'
            : String(err instanceof Error ? err.message : err)
      this.teardown()
      this.set({ phase: 'error', error: message })
      opts.onError?.(message)
    }
  }

  private onAudio(raw: Float32Array): void {
    if (this.state.phase !== 'listening' || !this.opts) return
    const frame = this.ctxRate === SAMPLE_RATE ? raw : resample(raw, this.ctxRate, SAMPLE_RATE)

    let sum = 0
    for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)

    this.chunks.push(frame)

    // The noise floor is learned continuously rather than measured once up
    // front: it drops quickly when the room goes quiet and creeps up only very
    // slowly, so a long sentence can never drag it up to meet your own voice.
    if (this.noiseFloor === 0) this.noiseFloor = Math.min(rms, NOISE_CEIL)
    else if (rms < this.noiseFloor) this.noiseFloor = this.noiseFloor * 0.9 + rms * 0.1
    else this.noiseFloor = this.noiseFloor * 0.9995 + rms * 0.0005

    const threshold = Math.max(this.noiseFloor * SPEECH_MULT, FLOOR_MIN)
    const speaking = rms > threshold

    const smoothed = this.state.level * 0.6 + Math.min(1, rms * 12) * 0.4
    this.set({ level: smoothed, speaking })

    if (speaking) {
      this.samplesSinceSpeech = 0
      this.speechSamples += frame.length
      this.sawSpeech = true
      this.sessionSawSpeech = true
    } else {
      this.samplesSinceSpeech += frame.length
    }

    const silenceMs = (this.samplesSinceSpeech / SAMPLE_RATE) * 1000
    const speechMs = (this.speechSamples / SAMPLE_RATE) * 1000
    let bufferedMs = 0
    for (const c of this.chunks) bufferedMs += (c.length / SAMPLE_RATE) * 1000

    const phraseEnded = this.sawSpeech && silenceMs >= SEGMENT_SILENCE_MS
    const tooLong = this.sawSpeech && bufferedMs >= MAX_SEGMENT_MS

    if (phraseEnded || tooLong) {
      if (speechMs >= MIN_SPEECH_MS) this.flush()
      else this.dropSegment()
    }

    // Auto-stop after a longer stretch of quiet, if that is switched on.
    //
    // This deliberately keys off `sessionSawSpeech` and a silence counter that
    // sending a phrase does not reset. Using the per-phrase flags would mean
    // auto-stop could only ever fire before the first phrase was sent — after
    // that the mic would stay open until you stopped it by hand.
    const stopAfter = this.opts.settings.voiceSilenceMs
    if (
      stopAfter > 0 &&
      this.sessionSawSpeech &&
      silenceMs >= Math.max(stopAfter, SEGMENT_SILENCE_MS)
    ) {
      void this.stop()
    }
  }

  /**
   * Throw away the current phrase's audio — it held no real speech. A little is
   * kept so the next phrase does not start clipped.
   */
  private dropSegment(): void {
    const keep = Math.ceil(((PRE_ROLL_MS / 1000) * SAMPLE_RATE) / FRAME)
    this.chunks = this.chunks.slice(Math.max(0, this.chunks.length - keep))
    this.speechSamples = 0
    this.sawSpeech = false
  }

  /** Hand the current phrase to the transcriber and start collecting the next. */
  private flush(): void {
    if (!this.opts) return
    // Everything buffered is the phrase: the leading silence is the pre-roll,
    // and the trailing silence is what told us the phrase had ended.
    const audio = concat(this.chunks, 0, this.chunks.length)

    this.chunks = []
    this.speechSamples = 0
    this.sawSpeech = false

    if (audio.length < (MIN_SPEECH_MS / 1000) * SAMPLE_RATE) return
    this.transcribe(audio)
  }

  private transcribe(audio: Float32Array): void {
    const opts = this.opts
    if (!opts) return
    const session = this.sessionId
    const { voiceModelId, voiceLanguage } = opts.settings

    this.set({ pending: this.state.pending + 1 })

    // One at a time and in order, so phrases are never interleaved or reordered.
    this.queue = this.queue.then(async () => {
      try {
        const res = await window.eaon.stt.transcribe(voiceModelId, audio, voiceLanguage)
        if (session !== this.sessionId) return
        if (!res.ok) throw new Error(res.error ?? 'Transcription failed')

        const text = tidy(res.text ?? '')
        // Near-silence makes Whisper invent a stock phrase; do not type it.
        if (text && !isPhantom(text)) {
          this.set({ text: joinText(this.state.text, text) })
          opts.onText(text)
        }
      } catch (err) {
        if (session !== this.sessionId) return
        const message = String(err instanceof Error ? err.message : err)
        this.set({ error: message })
        opts.onError?.(message)
      } finally {
        if (session === this.sessionId) {
          const pending = Math.max(0, this.state.pending - 1)
          this.set({ pending })
          if (pending === 0 && this.state.phase === 'thinking') {
            this.set({ phase: 'off', level: 0, speaking: false })
          }
        }
      }
    })
  }

  /** Finish: transcribe whatever is left, then close the microphone. */
  async stop(): Promise<void> {
    if (!this.active) return
    if (this.sawSpeech && this.speechSamples >= (MIN_SPEECH_MS / 1000) * SAMPLE_RATE) this.flush()
    this.teardown()
    this.set({ phase: this.state.pending > 0 ? 'thinking' : 'off', level: 0, speaking: false })
    await this.queue
    if (this.state.pending === 0 && this.state.phase === 'thinking') {
      this.set({ phase: 'off' })
    }
  }

  /** Abandon: no transcription, nothing inserted. */
  cancel(): void {
    this.sessionId += 1
    this.teardown()
    this.chunks = []
    this.set({ ...IDLE })
  }

  private teardown(): void {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker)
      this.ticker = null
    }
    if (this.node) {
      this.node.port.onmessage = null
      try {
        this.node.disconnect()
      } catch {
        /* already detached */
      }
      this.node = null
    }
    if (this.legacy) {
      this.legacy.onaudioprocess = null
      try {
        this.legacy.disconnect()
      } catch {
        /* already detached */
      }
      this.legacy = null
    }
    try {
      this.source?.disconnect()
    } catch {
      /* already detached */
    }
    this.source = null
    // Closing the context and stopping every track is what turns the recording
    // indicator off. Leaving either open would keep the microphone live.
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}

export const dictation = new DictationController()
