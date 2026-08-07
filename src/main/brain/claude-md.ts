import fs from 'node:fs'
import path from 'node:path'

/**
 * A pointer to the brain in the workspace's `CLAUDE.md`.
 *
 * The skill teaches the *how* — search first, record what you learn, title and
 * tag and link so it can be found again — but a skill only enters context when
 * Claude decides the task is complex enough to consult one. A short, simple
 * request that could plausibly be answered "from the prompt" never triggers it,
 * and that is exactly the request most likely to be answered wrong for want of
 * five seconds of `brain_search`.
 *
 * `CLAUDE.md` has no such gate. Claude Code loads it into every session
 * unconditionally — repo, home directory and per-directory overrides, all
 * always-on — which makes it the one place that reaches a session regardless of
 * how the task looks. So this carries only a pointer, not the instructions
 * themselves: full guidance stays in the skill, where it costs context only
 * when actually used; this costs a few lines on every turn, in exchange for
 * every session at least knowing the brain exists and where to read more.
 */

const START = '<!-- eaon-brain:start'
const END = '<!-- eaon-brain:end -->'
export const POINTER_VERSION = 2

/** Terms that mean an existing CLAUDE.md already covers this — don't duplicate it. */
const ALREADY_COVERED = /eaon-brain|\.eaonbrain\b/i

function block(version: number): string {
  return [
    `${START} v${version} -->`,
    '## Project memory',
    '',
    'This project has a shared memory at `.eaonbrain/`, reachable through the',
    '`eaon-brain` MCP tools (`brain_search`, `brain_list`, `brain_read`, `brain_write`,',
    '`brain_link`, `brain_related`) and the `eaon-brain` skill. Search it before',
    'reading source files for background — a past session may already have worked',
    'out what you are about to rediscover. Before finishing, upload anything worth',
    'keeping — a decision and why, a convention, a gotcha — every session, not just',
    'the ones that felt hard. The `eaon-brain` skill has the full guidance on',
    'searching, writing and linking notes well.',
    END
  ].join('\n')
}

function claudeMdFile(cwd: string): string {
  return path.join(cwd, 'CLAUDE.md')
}

/**
 * Whether we have ever touched this workspace's `CLAUDE.md` before — tracked in
 * our own namespace, not inferred from the file, so that a user (or a later
 * version of this app) removing the block reads as "leave it removed" rather
 * than "put it back". `CLAUDE.md` is much more clearly the user's own file than
 * the skill folder is, so the bar for re-asserting ourselves into it is higher:
 * offer once, then respect whatever they do with it.
 */
function markerFile(cwd: string): string {
  return path.join(cwd, '.claude', 'skills', 'eaon-brain', '.claude-md-pointer')
}

function readVersion(text: string): { version: number; start: number; end: number } | null {
  const startIdx = text.indexOf(START)
  if (startIdx < 0) return null
  const headerEnd = text.indexOf('-->', startIdx)
  if (headerEnd < 0) return null
  const versionMatch = /v(\d+)/.exec(text.slice(startIdx, headerEnd))
  const endIdx = text.indexOf(END, headerEnd)
  if (endIdx < 0) return null
  return {
    version: versionMatch ? Number(versionMatch[1]) : 0,
    start: startIdx,
    end: endIdx + END.length
  }
}

export interface ClaudeMdResult {
  ok: boolean
  path: string
  wrote: boolean
  /** True when we skipped because the file already mentions eaon-brain in its own words. */
  alreadyCovered?: boolean
  /** True when a previous run installed this and it was since removed — left alone. */
  respectedRemoval?: boolean
  error?: string
}

export function installClaudeMdPointer(cwd: string): ClaudeMdResult {
  const file = claudeMdFile(cwd)
  const marker = markerFile(cwd)

  try {
    const everInstalled = fs.existsSync(marker)
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    const found = existing ? readVersion(existing) : null

    if (found) {
      if (found.version >= POINTER_VERSION) return { ok: true, path: file, wrote: false }
      // An older copy from a previous app version: replace only what is
      // between our own markers, byte for byte, and leave the rest of the
      // file — which may be entirely the user's own — untouched.
      const next = existing!.slice(0, found.start) + block(POINTER_VERSION) + existing!.slice(found.end)
      fs.writeFileSync(file, next, 'utf8')
      return { ok: true, path: file, wrote: true }
    }

    // No block in the file. Either we have never been here, or we have and it
    // was removed on purpose — those are different situations with different
    // right answers, and the marker file is what tells them apart.
    if (everInstalled) return { ok: true, path: file, wrote: false, respectedRemoval: true }

    if (existing && ALREADY_COVERED.test(existing)) {
      // Someone already wrote, in their own words, that this project has a
      // brain. Our version would just be a second, redundant explanation of
      // the same fact — mark it handled without touching their text.
      fs.mkdirSync(path.dirname(marker), { recursive: true })
      fs.writeFileSync(marker, `${POINTER_VERSION}\n`, 'utf8')
      return { ok: true, path: file, wrote: false, alreadyCovered: true }
    }

    const content = existing
      ? `${existing.replace(/\s*$/, '')}\n\n${block(POINTER_VERSION)}\n`
      : `${block(POINTER_VERSION)}\n`
    fs.writeFileSync(file, content, 'utf8')
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, `${POINTER_VERSION}\n`, 'utf8')
    return { ok: true, path: file, wrote: true }
  } catch (err) {
    return { ok: false, path: file, wrote: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function hasClaudeMdPointer(cwd: string): boolean {
  try {
    const text = fs.readFileSync(claudeMdFile(cwd), 'utf8')
    const found = readVersion(text)
    return found !== null && found.version >= POINTER_VERSION
  } catch {
    return false
  }
}

/**
 * Remove only our block. If that leaves nothing behind and the file is one we
 * created outright — never any other content, ever, going by the marker having
 * been the *only* reason the file exists — remove the empty file too; anything
 * else is left in place even if the remainder looks blank, since a file with
 * other content once had a reason to exist that has nothing to do with us.
 */
export function removeClaudeMdPointer(cwd: string): boolean {
  const file = claudeMdFile(cwd)
  const marker = markerFile(cwd)
  try {
    if (fs.existsSync(marker)) fs.rmSync(marker, { force: true })
    if (!fs.existsSync(file)) return true
    const text = fs.readFileSync(file, 'utf8')
    const found = readVersion(text)
    if (!found) return true
    const before = text.slice(0, found.start).replace(/\n+$/, '')
    const after = text.slice(found.end).replace(/^\n+/, '')
    const remainder = `${before}${before && after ? '\n\n' : ''}${after}`
    if (remainder.trim()) fs.writeFileSync(file, `${remainder.replace(/\s*$/, '')}\n`, 'utf8')
    else fs.rmSync(file, { force: true })
    return true
  } catch {
    return false
  }
}
