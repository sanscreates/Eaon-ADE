/**
 * The thing that actually makes noise.
 *
 * macOS already has a speech synthesiser and a set of neural voices behind it,
 * so an announcement is one call to `say` and nothing else: no model on disk,
 * no ONNX session held open, no audio graph in the renderer competing with the
 * microphone dictation already uses. A line takes about a second to speak and
 * the process is gone straight after.
 *
 * Speaking is serialised. Four agents finishing at once would otherwise talk
 * over each other into the same speaker, which is worse than silence.
 */

import { execFile, type ChildProcess } from 'node:child_process'
import { shell } from 'electron'
import {
  RATE_MAX,
  RATE_MIN,
  qualityOf,
  baseName,
  type SpeechSupport,
  type SystemVoice
} from '../shared/speech'

const SAY = '/usr/bin/say'

/**
 * How many lines may be waiting to be spoken.
 *
 * A grid finishing together should be announced, not queued into a monologue
 * that outlives the thing it is describing. Past this, the oldest waiting line
 * is dropped — the newest news is the useful news.
 */
const MAX_QUEUE = 3

interface Utterance {
  text: string
  voice: string
  rate: number
  volume: number
}

let queue: Utterance[] = []
let active: ChildProcess | null = null
let voiceCache: SystemVoice[] | null = null

export function support(): SpeechSupport {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      reason: 'Spoken alerts use the macOS speech synthesiser and are only available there.'
    }
  }
  return { ok: true }
}

/**
 * Every voice installed on this Mac.
 *
 * `say -v '?'` prints one voice per line as `Name  locale  # sample sentence`,
 * with the name padded out to a column — except when the name is longer than
 * the column, which several are. So the line is split at the comment marker and
 * the locale taken as the last token before it, rather than by counting spaces.
 */
export async function voices(): Promise<SystemVoice[]> {
  if (voiceCache) return voiceCache
  if (!support().ok) return []

  const raw = await new Promise<string>((resolve) => {
    execFile(SAY, ['-v', '?'], { timeout: 8000 }, (err, stdout) => resolve(err ? '' : stdout))
  })

  const found: SystemVoice[] = []
  const seen = new Set<string>()

  for (const line of raw.split('\n')) {
    const hash = line.indexOf('#')
    const head = (hash === -1 ? line : line.slice(0, hash)).trimEnd()
    const cut = head.lastIndexOf(' ')
    if (cut <= 0) continue

    const id = head.slice(0, cut).trim()
    const locale = head.slice(cut + 1).trim()
    // The locale column is the only field with a fixed shape; anything that
    // does not look like one means the line was not a voice.
    if (!id || !/^[A-Za-z]{2,3}([_-][A-Za-z0-9]+)*$/.test(locale)) continue
    if (seen.has(id)) continue
    seen.add(id)

    found.push({ id, name: baseName(id), locale, quality: qualityOf(id) })
  }

  voiceCache = found
  return found
}

/** Forgets the cached list, so a voice downloaded just now can be picked. */
export function refreshVoices(): void {
  voiceCache = null
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

function pump(): void {
  if (active || !queue.length) return

  const next = queue.shift() as Utterance
  const args = ['-r', String(Math.round(next.rate))]
  if (next.voice) args.push('-v', next.voice)
  // Volume rides in the text as an embedded command because `say` has no flag
  // for it. It is consumed by the synthesiser, never spoken.
  args.push(`[[volm ${next.volume.toFixed(2)}]]${next.text}`)

  // execFile, not exec: the text is an argument, so nothing in a pane title or
  // a workspace name can reach a shell.
  const child = execFile(SAY, args, { timeout: 20000 }, () => {
    if (active === child) active = null
    pump()
  })
  active = child
  child.on('error', () => {
    if (active === child) active = null
    pump()
  })
}

/** Queues a line. Returns false when this platform cannot speak it. */
export function speak(
  text: string,
  opts: { voice?: string; rate?: number; volume?: number } = {}
): boolean {
  if (!support().ok) return false
  const clean = text.trim()
  if (!clean) return false

  queue.push({
    text: clean.slice(0, 200),
    voice: (opts.voice ?? '').trim(),
    rate: clamp(opts.rate ?? 180, RATE_MIN, RATE_MAX),
    volume: clamp(opts.volume ?? 0.75, 0, 1)
  })
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)

  pump()
  return true
}

/** Drops anything waiting and silences what is being said right now. */
export function stop(): void {
  queue = []
  const child = active
  active = null
  try {
    child?.kill('SIGTERM')
  } catch {
    /* it had already finished */
  }
}

/**
 * Opens the pane where macOS downloads its natural-sounding voices.
 *
 * They cannot be installed programmatically — Apple only offers them through
 * System Settings — so the honest thing is to take the user straight there.
 */
export function openVoiceSettings(): void {
  if (process.platform !== 'darwin') return
  void shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.universalaccess?SpokenContent'
  )
}
