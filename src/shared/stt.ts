/**
 * Voice dictation: the model catalogue and the file manifest behind it.
 *
 * Dictation never leaves this machine. A model is downloaded once into the
 * app's own folder, and every transcription after that reads from disk with the
 * network switched off. The only time speech models touch the internet is the
 * download you explicitly ask for.
 *
 * Keep this file free of runtime imports — main, preload and renderer all use it.
 */

/** Precisions transformers.js can load. The suffix is how it names the file. */
export type SttDtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'q4f16' | 'bnb4'

export const DTYPE_SUFFIX: Record<SttDtype, string> = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4'
}

/** How a model feels in use. Drives the badge in the picker, nothing else. */
export type SttSpeed = 'instant' | 'fast' | 'balanced' | 'accurate'

export interface SttModelDef {
  /** Our stable id. Survives a repo rename. */
  id: string
  /** Hugging Face repo the weights come from. */
  repo: string
  label: string
  blurb: string
  /**
   * Download size in bytes. Measured from the repo, not estimated — but the
   * exact figure is re-resolved before any download actually starts.
   */
  size: number
  /**
   * English-only models refuse a `language` or `task` argument outright, so the
   * transcriber has to know which kind it is holding.
   */
  multilingual: boolean
  encoderDtype: SttDtype
  decoderDtype: SttDtype
  speed: SttSpeed
  /** Rough transcription speed as a multiple of real time, measured on CPU. */
  realtime: string
  recommended?: boolean
}

/**
 * Six models covering "instant and rough" through "slow and excellent".
 * Sizes are the sum of the files in `modelFiles`, read from the repo tree.
 */
export const STT_MODELS: SttModelDef[] = [
  {
    id: 'whisper-tiny-en',
    repo: 'onnx-community/whisper-tiny.en',
    label: 'Whisper Tiny',
    blurb: 'English only. Quickest to download and the fastest to answer.',
    size: 43_675_000,
    multilingual: false,
    encoderDtype: 'q8',
    decoderDtype: 'q8',
    speed: 'instant',
    realtime: '~6x'
  },
  {
    id: 'whisper-base-en',
    repo: 'onnx-community/whisper-base.en',
    label: 'Whisper Base',
    blurb: 'English only. The best balance of speed and accuracy for dictation.',
    size: 79_587_000,
    multilingual: false,
    encoderDtype: 'q8',
    decoderDtype: 'q8',
    speed: 'fast',
    realtime: '~4x',
    recommended: true
  },
  {
    id: 'whisper-small-en',
    repo: 'onnx-community/whisper-small.en',
    label: 'Whisper Small',
    blurb: 'English only. Noticeably better on names, jargon and code words.',
    size: 251_769_000,
    multilingual: false,
    encoderDtype: 'q8',
    decoderDtype: 'q8',
    speed: 'balanced',
    realtime: '~2x'
  },
  {
    id: 'whisper-base-multi',
    repo: 'onnx-community/whisper-base',
    label: 'Whisper Base · multilingual',
    blurb: 'Same size as Base, but understands 99 languages.',
    size: 79_588_000,
    multilingual: true,
    encoderDtype: 'q8',
    decoderDtype: 'q8',
    speed: 'fast',
    realtime: '~4x'
  },
  {
    id: 'whisper-small-multi',
    repo: 'onnx-community/whisper-small',
    label: 'Whisper Small · multilingual',
    blurb: 'The multilingual model most people should use if English is not enough.',
    size: 251_770_000,
    multilingual: true,
    encoderDtype: 'q8',
    decoderDtype: 'q8',
    speed: 'balanced',
    realtime: '~2x'
  },
  {
    id: 'whisper-large-v3-turbo',
    repo: 'onnx-community/whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    blurb:
      'The most accurate option, multilingual. A large download, and slow without a GPU — expect to wait after you stop speaking.',
    size: 761_800_000,
    multilingual: true,
    encoderDtype: 'q4',
    decoderDtype: 'q4',
    speed: 'accurate',
    realtime: 'under 1x'
  }
]

export function findModel(id: string | undefined | null): SttModelDef | null {
  if (!id) return null
  return STT_MODELS.find((m) => m.id === id) ?? null
}

/** Small files every Whisper model needs, whatever its size. */
const CONFIG_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json'
]

/**
 * Exactly the files transformers.js opens for a Whisper model — the five JSON
 * configs plus one encoder and one merged decoder at the chosen precision.
 * Downloading anything else would multiply the size for no gain.
 */
export function modelFiles(m: SttModelDef): string[] {
  return [
    ...CONFIG_FILES,
    `onnx/encoder_model${DTYPE_SUFFIX[m.encoderDtype]}.onnx`,
    `onnx/decoder_model_merged${DTYPE_SUFFIX[m.decoderDtype]}.onnx`
  ]
}

export interface InstalledModel {
  id: string
  repo: string
  /** Bytes actually on disk. */
  bytes: number
  /** False when a file is missing — a half-finished or hand-deleted install. */
  complete: boolean
  installedAt: number
}

export interface DownloadProgress {
  modelId: string
  received: number
  total: number
  /** File currently in flight, for the caption under the bar. */
  file: string
  done: boolean
  error?: string
}

export type SttEngineState =
  | { kind: 'idle' }
  | { kind: 'loading'; modelId: string }
  | { kind: 'ready'; modelId: string }
  | { kind: 'working'; modelId: string }
  | { kind: 'error'; message: string }

/**
 * Whisper invents speech when handed silence — almost always one of these.
 * Anything that reduces to a line below is dropped rather than typed at you.
 */
const PHANTOMS = new Set([
  'you',
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching!',
  'thank you for watching',
  'thank you for watching!',
  'bye',
  'bye.',
  'bye!',
  'okay',
  'so',
  '.',
  '...',
  'the',
  'oh',
  'hmm',
  'mm',
  'mmm',
  'uh',
  'um',
  'yeah',
  'please subscribe',
  'subscribe'
])

/** True when a transcript is almost certainly hallucinated from near-silence. */
export function isPhantom(text: string): boolean {
  const clean = text
    .toLowerCase()
    .replace(/[♪♫♪-♯]/g, '')
    .replace(/[\s]+/g, ' ')
    .trim()
  if (!clean) return true
  if (PHANTOMS.has(clean)) return true
  // Bracketed stage directions: [BLANK_AUDIO], (music), *silence*
  if (/^[[(*][^\])*]*[\])*]$/.test(clean)) return true
  return false
}

/** Languages offered for multilingual models. Whisper knows many more. */
export const STT_LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ru', label: 'Russian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
  { code: 'tr', label: 'Turkish' },
  { code: 'pl', label: 'Polish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'vi', label: 'Vietnamese' }
]

/**
 * Keys you can hold to talk, by `KeyboardEvent.code`.
 *
 * Right-hand modifiers are the useful ones: they sit under the thumb, nothing
 * else in the app binds them on their own, and unlike Fn they actually reach
 * the application. macOS never delivers the Fn/globe key to an app's key
 * handling — reading it needs a native input monitor and the Input Monitoring
 * permission that goes with it.
 */
export const VOICE_HOLD_KEYS: { code: string; mac: string; other: string }[] = [
  { code: 'MetaRight', mac: 'Right ⌘', other: 'Right Win' },
  { code: 'AltRight', mac: 'Right ⌥', other: 'Right Alt' },
  { code: 'ControlRight', mac: 'Right ⌃', other: 'Right Ctrl' },
  { code: 'F5', mac: 'F5', other: 'F5' },
  { code: '', mac: 'No hold key', other: 'No hold key' }
]

export function holdKeyLabel(code: string, isMac: boolean): string {
  const found = VOICE_HOLD_KEYS.find((k) => k.code === code) ?? VOICE_HOLD_KEYS[0]
  return isMac ? found.mac : found.other
}

/** Audio the transcriber expects, and the shape the capture side must produce. */
export const SAMPLE_RATE = 16000

export function formatBytes(n: number): string {
  if (n <= 0) return '0 MB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
