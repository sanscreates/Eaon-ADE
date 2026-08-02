/**
 * Deciding which resumable sessions belong to the folder you are looking at.
 *
 * Kept apart from the dialog because it is the whole of the feature's
 * correctness: a prefix test that forgets the path separator quietly claims
 * `…/EaonADE-old` as part of `…/EaonADE`, and nothing on screen would say so.
 */

/** Is this session's folder the one we are in, or somewhere inside it? */
export function inFolder(cwd: string, folder: string): boolean {
  if (!cwd || !folder) return false
  const strip = (p: string): string => p.replace(/\/+$/, '').toLowerCase()
  const a = strip(cwd)
  const b = strip(folder)
  // The separator matters: without it "/a/b-old" reads as inside "/a/b".
  // Compared case-insensitively because this volume almost certainly is, and
  // /Users/me/Proj is not a different project from /Users/me/proj.
  return a === b || a.startsWith(`${b}/`)
}
