/**
 * Shared branch lookups for the pane headers.
 *
 * Every pane shows the branch its folder is on, and a grid is normally a dozen
 * panes over one or two folders. Asked for pane by pane that is a dozen `git`
 * processes every fifteen seconds, nearly all of them answering the same
 * question — which is real work for the machine and none of it useful. Results
 * are cached per folder, and panes that ask at the same moment share one call.
 */

import { hostKeyOf, type SshHost } from '@shared/ssh'

const FRESH_MS = 15_000

interface Entry {
  value: string | null
  at: number
}

const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<string | null>>()

/**
 * Local and remote paths are cached separately even when the string happens
 * to match — `/home/dev/project` on your Mac and the same path on a remote
 * box are not the same repository, and sharing one cache entry between them
 * would show one folder's branch on the other's pane.
 */
function keyOf(cwd: string, host?: SshHost | null): string {
  return `${host ? hostKeyOf(host) : 'local'}:${cwd}`
}

/** The branch for a folder, from cache when it is recent enough to trust. */
export function branchOf(
  cwd: string,
  host?: SshHost | null,
  maxAgeMs = FRESH_MS
): Promise<string | null> {
  if (!cwd) return Promise.resolve(null)
  const key = keyOf(cwd, host)

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.value)

  const pending = inflight.get(key)
  if (pending) return pending

  const call = window.eaon.git
    .branch(cwd, host)
    .then((value) => {
      cache.set(key, { value, at: Date.now() })
      return value
    })
    // A folder that stopped being a repo, or a git that is not there. The last
    // known answer beats flickering the chip away and back.
    .catch(() => cache.get(key)?.value ?? null)
    .finally(() => inflight.delete(key))

  inflight.set(key, call)
  return call
}

/** Drops a folder's cached branch, so the next ask goes to git. */
export function forgetBranch(cwd: string, host?: SshHost | null): void {
  cache.delete(keyOf(cwd, host))
}
