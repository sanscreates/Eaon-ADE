/**
 * Comparing two paths that were written down by different programs.
 *
 * A transcript records the folder a shell was in; a workspace records the
 * folder you opened. They mean the same place and spell it differently —
 * Windows mixes `\` and `/` inside one path, a trailing separator is noise, and
 * the same volume answers to either case. Every folder-scoped feature in the
 * app rests on this comparison, so it lives in one place and is tested on its
 * own rather than being retyped wherever it is needed.
 */

/** One shape for a path, whichever platform wrote it. */
export function normalisePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Is `child` the same folder as `parent`, or somewhere inside it?
 *
 * The separator in the prefix test is the whole point: without it, `/a/b-old`
 * reads as part of `/a/b`, and nothing on screen would say so.
 */
export function isInside(child: string, parent: string): boolean {
  if (!child || !parent) return false
  const a = normalisePath(child)
  const b = normalisePath(parent)
  return a === b || a.startsWith(`${b}/`)
}
