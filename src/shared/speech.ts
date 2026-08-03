/**
 * Spoken alerts: "Ada has finished."
 *
 * When an agent stops working, the pane that ran it says so out loud, so you
 * can look away from a twelve-up grid and still know when something wants you.
 *
 * The voice is the operating system's own. Nothing is downloaded, nothing is
 * synthesised in-process, and no audio is sent anywhere — macOS renders the
 * line and plays it. That keeps the whole feature to one short-lived child
 * process per announcement instead of a speech model resident in memory.
 *
 * Keep this file free of runtime imports — main, preload and renderer all use it.
 */

/**
 * How natural a voice sounds. macOS ships every voice at "compact" quality and
 * downloads the good ones on request, so this is the difference between an
 * announcement you are happy to leave on and one you turn off after a day.
 */
export type VoiceQuality = 'premium' | 'enhanced' | 'compact' | 'novelty'

export interface SystemVoice {
  /** Exact name the synthesiser expects. Doubles as the stable id. */
  id: string
  /** Name without the quality suffix, e.g. "Ava" for "Ava (Premium)". */
  name: string
  /** BCP-ish tag as the system reports it, e.g. "en_US". */
  locale: string
  quality: VoiceQuality
}

export interface SpeechSupport {
  /** Whether this platform can speak at all. */
  ok: boolean
  /** Why not, in a sentence, when it cannot. */
  reason?: string
}

/**
 * Voices that are jokes, instruments or sound effects. macOS lists them beside
 * the real ones, and every single one of them would sound wrong reading a
 * status line, so they are kept out of the picker unless asked for.
 */
const NOVELTY = new Set([
  'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Eddy',
  'Flo', 'Fred', 'Good News', 'Grandma', 'Grandpa', 'Jester', 'Junior', 'Kathy',
  'Organ', 'Ralph', 'Reed', 'Rocko', 'Sandy', 'Shelley', 'Superstar', 'Trinoids',
  'Whisper', 'Wobble', 'Zarvox'
])

/**
 * The name on its own, without the parenthesised part macOS appends.
 *
 * Two different things end up in those brackets — a quality, as in
 * "Ava (Premium)", and a language, as in "Eddy (English (US))" — and the second
 * shape is how the novelty voices are listed once they exist in more than one
 * language. Cutting at the first bracket handles both, and is what stops a
 * cartoon voice from being read as an unrecognised serious one.
 */
export function baseName(id: string): string {
  const cut = id.indexOf(' (')
  return (cut === -1 ? id : id.slice(0, cut)).trim()
}

export function qualityOf(id: string): VoiceQuality {
  if (/\(Premium\)\s*$/i.test(id)) return 'premium'
  if (/\(Enhanced\)\s*$/i.test(id)) return 'enhanced'
  return NOVELTY.has(baseName(id)) ? 'novelty' : 'compact'
}

const RANK: Record<VoiceQuality, number> = {
  premium: 3,
  enhanced: 2,
  compact: 1,
  novelty: 0
}

/**
 * Whether a voice belongs in the picker at all.
 *
 * Every voice macOS ships that is not a joke is a real, usable one, so the
 * novelty list is the entire filter. An allowlist of good names was the
 * obvious alternative and the wrong one: it silently hid every voice for every
 * language nobody thought to add to it.
 */
export function isSpeakable(voice: SystemVoice): boolean {
  return voice.quality !== 'novelty'
}

export function isEnglish(voice: SystemVoice): boolean {
  return /^en\b/i.test(voice.locale.replace('_', '-'))
}

/**
 * Best voice on this machine for a one-line announcement.
 *
 * Quality first, then a preference for the user's own English variant, so a
 * British Mac says it in a British accent rather than defaulting to en_US.
 */
export function pickDefaultVoice(voices: SystemVoice[], locale = 'en_US'): string {
  const want = locale.replace('-', '_').toLowerCase()
  const usable = voices.filter((v) => isSpeakable(v) && isEnglish(v))
  if (!usable.length) return ''

  const score = (v: SystemVoice): number => {
    const tag = v.locale.replace('-', '_').toLowerCase()
    const localeBonus = tag === want ? 2 : 0
    // en_US is the variant these voices are tuned hardest for, so it breaks
    // ties on a machine set to a locale with no voice of its own.
    const usBonus = tag === 'en_us' ? 1 : 0
    return RANK[v.quality] * 10 + localeBonus + usBonus
  }

  return [...usable].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0].id
}

/** Voices worth offering, best first. */
export function sortForPicker(voices: SystemVoice[]): SystemVoice[] {
  return voices
    .filter(isSpeakable)
    .sort(
      (a, b) =>
        Number(isEnglish(b)) - Number(isEnglish(a)) ||
        RANK[b.quality] - RANK[a.quality] ||
        a.name.localeCompare(b.name)
    )
}

/** True when the machine has nothing better than the built-in compact voices. */
export function onlyCompactVoices(voices: SystemVoice[]): boolean {
  return !voices.some((v) => v.quality === 'premium' || v.quality === 'enhanced')
}

export const QUALITY_LABEL: Record<VoiceQuality, string> = {
  premium: 'Premium',
  enhanced: 'Enhanced',
  compact: 'Built in',
  novelty: 'Novelty'
}

/**
 * What a pane says when its agent stops.
 *
 * Square brackets are stripped because macOS reads `[[...]]` in the text as an
 * embedded synthesiser command rather than as words.
 */
export function finishedLine(paneName: string): string {
  const clean = paneName.replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? `${clean} has finished.` : 'An agent has finished.'
}

/** Speaking rate bounds, in words per minute. macOS defaults to about 175. */
export const RATE_MIN = 140
export const RATE_MAX = 260
