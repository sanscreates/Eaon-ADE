import { IS_MAC } from './keys'
/** Short, collision-safe id. Good enough for pane and workspace keys. */
export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const time = Date.now().toString(36).slice(-5)
  return `${prefix}${time}${rand}`
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function basename(p: string): string {
  if (!p) return ''
  const clean = p.replace(/[/\\]+$/, '')
  const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return idx >= 0 ? clean.slice(idx + 1) || clean : clean
}

export function shortPath(p: string, home: string): string {
  if (!p) return ''
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

export function relTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * Removes ANSI escape sequences using explicit character codes — no regex
 * escapes, which keeps invisible control characters out of this source file.
 */
export function stripAnsi(input: string): string {
  const ESC = 27
  const BEL = 7
  let out = ''
  let i = 0
  while (i < input.length) {
    const code = input.charCodeAt(i)
    if (code === ESC) {
      i += 1
      const next = input[i]
      if (next === '[') {
        i += 1
        while (i < input.length && !/[A-Za-z]/.test(input[i])) i += 1
        i += 1
      } else if (next === ']') {
        i += 1
        while (i < input.length && input.charCodeAt(i) !== BEL && input.charCodeAt(i) !== ESC) i += 1
        i += 1
      } else {
        i += 1
      }
      continue
    }
    // Keep printable characters, newlines and tabs; drop the rest.
    if (code >= 32 || code === 10 || code === 9) out += input[i]
    i += 1
  }
  return out
}

/** Simple subsequence match, so "cmp" finds "Compare panes". */
export function fuzzy(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()
  if (!n) return true
  let i = 0
  for (const ch of h) {
    if (ch === n[i]) i += 1
    if (i === n.length) return true
  }
  return false
}

export function isMac(): boolean {
  return IS_MAC
}

/*
 * Re-exported so there is one answer to "what does a shortcut look like here".
 * The label has to match what the key handler actually binds, and on Windows
 * that is Ctrl+Shift — bare Control belongs to the shell. See lib/keys.ts.
 */
export { IS_MAC, MOD, MOD_PLAIN } from './keys'
