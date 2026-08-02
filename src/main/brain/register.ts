import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

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
