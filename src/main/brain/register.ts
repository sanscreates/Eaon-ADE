import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installSkill, isSkillInstalled, removeSkill, type SkillResult } from './skill'
import { installClaudeMdPointer, removeClaudeMdPointer, type ClaudeMdResult } from './claude-md'

/**
 * Registers the brain server in a workspace's `.mcp.json`.
 *
 * Claude Code reads that file from the project root, so writing an entry there
 * is what makes a fresh `claude` session start with the project's memory
 * already available — no flags, no per-session setup.
 *
 * The file belongs to the user: their own servers are left exactly as they are
 * and only the `eaon-brain` key is touched.
 */

const KEY = 'eaon-brain'

/** The bundled server script, wherever the app happens to be running from. */
function serverScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'out', 'main', 'brain-mcp.js')
    : path.join(app.getAppPath(), 'out', 'main', 'brain-mcp.js')
}

/**
 * Electron runs plain Node when ELECTRON_RUN_AS_NODE is set, so the server can
 * be launched with the binary already on disk. Depending on `node` being
 * installed and on PATH would make this fail on plenty of machines.
 */
function launcher(): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: process.execPath,
    args: [serverScript()],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}

export interface RegisterResult {
  ok: boolean
  path: string
  /** True when the file was actually changed. */
  wrote: boolean
  error?: string
}

export function registerWorkspace(cwd: string): RegisterResult {
  const file = path.join(cwd, '.mcp.json')
  const { command, args, env } = launcher()

  const entry = {
    command,
    args: [...args, '--root', cwd],
    env
  }

  try {
    let config: Record<string, unknown> = {}
    if (fs.existsSync(file)) {
      try {
        config = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
      } catch {
        // A hand-edited file with a syntax error is not ours to overwrite.
        return { ok: false, path: file, wrote: false, error: '.mcp.json is not valid JSON' }
      }
    }

    const servers = (config.mcpServers ?? {}) as Record<string, unknown>
    const before = JSON.stringify(servers[KEY] ?? null)
    if (before === JSON.stringify(entry)) {
      return { ok: true, path: file, wrote: false }
    }

    servers[KEY] = entry
    config.mcpServers = servers
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
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

export function isRegistered(cwd: string): boolean {
  try {
    const file = path.join(cwd, '.mcp.json')
    if (!fs.existsSync(file)) return false
    const config = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    return Boolean(config.mcpServers?.[KEY])
  } catch {
    return false
  }
}

/* ── provisioning ─────────────────────────────────────────────────────────
   Registering the server and installing the skill are two halves of one idea:
   the first gives an agent the memory tools, the second gives it the judgement
   to use them. Nothing calls one without wanting the other, so they travel
   together.                                                                  */

export interface ProvisionResult {
  mcp: RegisterResult
  skill: SkillResult
  claudeMd: ClaudeMdResult
}

/**
 * Folders where writing `.mcp.json` and `.claude/skills/` would be wrong.
 *
 * The home directory is the one that matters: `.claude/skills/` there is the
 * *personal* skill folder, so installing into it would quietly make this
 * repo's skill apply to every project on the machine. A pane opened in `~`
 * is a scratch shell, not a workspace, and should leave no trace.
 */
function isProvisionable(cwd: string): boolean {
  if (!cwd) return false
  const resolved = path.resolve(cwd)
  if (resolved === path.resolve(os.homedir())) return false
  if (resolved === path.parse(resolved).root) return false
  try {
    return fs.statSync(resolved).isDirectory()
  } catch {
    return false
  }
}

/**
 * Make a workspace ready for agents: memory tools wired into `.mcp.json`, the
 * skill that says how to use them in `.claude/skills/`, and a short pointer in
 * `CLAUDE.md` so a session knows the brain exists even for a task simple
 * enough that it would never otherwise think to consult a skill.
 *
 * Safe to call repeatedly — every part compares against what is already on
 * disk and writes only when something would actually change. That is what
 * lets this sit on the spawn path, where it runs once per pane.
 */
export function provisionWorkspace(cwd: string): ProvisionResult | null {
  if (!isProvisionable(cwd)) return null
  return {
    mcp: registerWorkspace(cwd),
    skill: installSkill(cwd),
    claudeMd: installClaudeMdPointer(cwd)
  }
}

/**
 * The tooling agents actually need is present — what the Brain panel reports
 * as "connected", and what gates turning off Claude Code's own native memory
 * in `pty-manager.ts` (never do that with nothing to redirect to).
 *
 * Deliberately doesn't require the `CLAUDE.md` pointer: that one is skipped on
 * purpose when the file already explains the brain in its own words, and left
 * removed on purpose if a user deletes it, and neither of those should make an
 * otherwise fully-working workspace read as unprovisioned.
 */
export function isProvisioned(cwd: string): boolean {
  return isRegistered(cwd) && isSkillInstalled(cwd)
}

export function deprovisionWorkspace(cwd: string): boolean {
  const claudeMd = removeClaudeMdPointer(cwd)
  const skill = removeSkill(cwd)
  const mcp = unregisterWorkspace(cwd)
  return claudeMd && skill && mcp
}

export function unregisterWorkspace(cwd: string): boolean {
  try {
    const file = path.join(cwd, '.mcp.json')
    if (!fs.existsSync(file)) return true
    const config = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>
    if (!(KEY in servers)) return true
    delete servers[KEY]
    // Leave nothing behind if we were the only entry.
    if (Object.keys(servers).length === 0 && Object.keys(config).length === 1) fs.rmSync(file)
    else fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
