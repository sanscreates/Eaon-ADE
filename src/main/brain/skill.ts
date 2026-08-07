import fs from 'node:fs'
import path from 'node:path'
import { SKILL_MD, SKILL_NAME, SKILL_VERSION } from './skill-md'

/**
 * Installs the Eaon Brain skill into a workspace.
 *
 * `.mcp.json` gives an agent the memory *tools*; this gives it the judgement to
 * use them — search before exploring, record what was learned, title and tag
 * and link so the note is findable again. Claude Code discovers skills in
 * `.claude/skills/`, so writing the file is the whole installation.
 *
 * The file belongs to the repo and is meant to be committed and read, so it is
 * written as plain markdown with nothing generated-looking about it beyond a
 * version marker — which exists so a newer app can replace an older copy
 * without asking, and so a hand-edited one can be recognised and left alone.
 */

const MARKER = '<!-- eaon-brain-skill v'

function skillDir(cwd: string): string {
  return path.join(cwd, '.claude', 'skills', SKILL_NAME)
}

function skillFile(cwd: string): string {
  return path.join(skillDir(cwd), 'SKILL.md')
}

/** What we actually write: the skill, plus a version line we can recognise. */
function contents(): string {
  return `${SKILL_MD}\n${MARKER}${SKILL_VERSION} -->\n`
}

/** The version stamp in an installed copy, or null if it has none. */
function installedVersion(file: string): number | null {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const match = new RegExp(`${MARKER.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(\\d+) -->`).exec(text)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

export interface SkillResult {
  ok: boolean
  path: string
  /** True when the file was created or upgraded. */
  wrote: boolean
  /** True when an existing copy was left alone because someone edited it. */
  keptCustom?: boolean
  error?: string
}

export function installSkill(cwd: string): SkillResult {
  const file = skillFile(cwd)
  try {
    // mkdir -p would happily conjure the whole chain, so a typo'd or
    // since-deleted workspace path would leave a lone `.claude/skills/` in a
    // folder that never existed. Refuse rather than create.
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      return { ok: false, path: file, wrote: false, error: `Not a directory: ${cwd}` }
    }
    if (fs.existsSync(file)) {
      const version = installedVersion(file)
      // No marker means a human wrote or rewrote this. Their version of the
      // instructions is more likely to be what they want than ours, and
      // silently replacing it would be the kind of thing you only notice
      // after it has already thrown away an afternoon's tuning.
      if (version === null) return { ok: true, path: file, wrote: false, keptCustom: true }
      if (version >= SKILL_VERSION) return { ok: true, path: file, wrote: false }
    }
    fs.mkdirSync(skillDir(cwd), { recursive: true })
    fs.writeFileSync(file, contents(), 'utf8')
    return { ok: true, path: file, wrote: true }
  } catch (err) {
    return {
      ok: false,
      path: file,
      wrote: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export function isSkillInstalled(cwd: string): boolean {
  return fs.existsSync(skillFile(cwd))
}

export function removeSkill(cwd: string): boolean {
  try {
    const dir = skillDir(cwd)
    if (!fs.existsSync(dir)) return true
    fs.rmSync(dir, { recursive: true, force: true })
    // Tidy up the folders we created, but only while they are empty — a
    // `.claude/` holding the user's own settings is not ours to remove.
    for (const dead of [path.join(cwd, '.claude', 'skills'), path.join(cwd, '.claude')]) {
      try {
        if (fs.readdirSync(dead).length === 0) fs.rmdirSync(dead)
      } catch {
        // not empty, or gone already
      }
    }
    return true
  } catch {
    return false
  }
}
