/**
 * Files dropped onto a pane.
 *
 * A terminal's answer to a dropped file has always been to type its path, and
 * that is exactly what the agents want too — Claude Code and the rest read an
 * image by being handed somewhere to find it. So this does what dragging onto
 * Terminal.app does: the path lands on the prompt, escaped, and nothing is sent
 * until you send it.
 */

/**
 * Escape a path the way a terminal does when you drag a file into it.
 *
 * Backslashes rather than quotes, because that is what every macOS terminal
 * produces on a drop and therefore what anything reading the line already
 * copes with. A quoted path would be just as safe for the shell and stranger
 * for an agent parsing it.
 */
export function escapePath(path: string): string {
  // Left alone when there is nothing that would need it — most paths.
  if (/^[\w@%+=:,./-]+$/.test(path)) return path
  return path.replace(/([ '"\\()[\]{}$&;|<>*?!#~`\t])/g, '\\$1')
}

/** What the drop should type, given the paths it resolved to. */
export function lineFor(paths: string[]): string {
  return paths.map(escapePath).join(' ')
}

/** True when a drag is carrying files rather than text or one of our own cards. */
export function carriesFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types).includes('Files')
}

/**
 * Turn a drop into a list of paths on this machine.
 *
 * Real files keep their own path, which is always the better answer — the agent
 * then reads the file you dropped rather than a copy of it. Only when there is
 * no path, as with an image dragged out of a web page, is one written out.
 */
export async function pathsFromDrop(dt: DataTransfer): Promise<string[]> {
  const files = Array.from(dt.files ?? [])
  const out: string[] = []

  for (const file of files) {
    const known = window.eaon.fs.pathForDropped(file)
    if (known) {
      out.push(known)
      continue
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!bytes.length) continue
      out.push(await window.eaon.fs.saveDropped(file.name, bytes))
    } catch {
      /* one unreadable item should not lose the rest of the drop */
    }
  }

  return out
}
