/**
 * Deciding which resumable sessions belong to the folder you are looking at.
 *
 * The comparison itself is shared with the main process, which needs the same
 * answer when it works out whose transcripts are whose. Both sides asking the
 * same function is the point: a folder that the dialog counts as yours and the
 * scanner does not would show a number that never matches the list.
 */
import { isInside } from '@shared/paths'

/** Is this session's folder the one we are in, or somewhere inside it? */
export function inFolder(cwd: string, folder: string): boolean {
  return isInside(cwd, folder)
}
