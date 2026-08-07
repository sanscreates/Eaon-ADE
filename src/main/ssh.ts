import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ManualHostInput, SshHost } from '../shared/ssh'
import { hostLabel } from '../shared/ssh'

const run = promisify(execFile)

/**
 * Connections to remote boxes.
 *
 * Two layers, and the split is deliberate. `sshArgv` and `remoteCommandLine`
 * are pure — given a host and a command, they say exactly what would run,
 * with nothing executed — which is what makes them testable without a
 * reachable server. `remoteExec` is the one function that actually shells
 * out, and it is a thin wrapper over the other two.
 *
 * Nothing in this file ever touches a passphrase or a private key's bytes.
 * `identityFile` is a path, handed to the real `ssh` binary with `-i`; ssh
 * itself decides whether the key needs unlocking and, if so, prompts on the
 * pty exactly like it would in any other terminal.
 */

/** Timeout on the TCP/handshake phase, not on how long a command takes to run. */
const CONNECT_TIMEOUT_S = 10

/**
 * The `ssh` argv for reaching this host, with nothing shell-interpreted.
 *
 * A config-sourced host connects by its alias and nothing else — the whole
 * point of reading `~/.ssh/config` is to let its own `ProxyJump`, `Include`,
 * multiple `IdentityFile` lines and `Match` blocks apply exactly as they
 * would from a real terminal, which re-stating the fields we parsed out of it
 * would only risk contradicting. A manual host has no config entry to defer
 * to, so every flag is passed explicitly.
 */
export function sshArgv(host: SshHost, opts: { interactive: boolean }): string[] {
  const args = ['-o', `ConnectTimeout=${CONNECT_TIMEOUT_S}`, '-o', 'ServerAliveInterval=15']
  // -tt forces a real pty even when a remote command follows, which a plain
  // -t does not guarantee once stdin is not itself a terminal (true for
  // anything spawned through node-pty, but doubly true for a piped exec).
  if (opts.interactive) args.push('-tt')

  if (host.source === 'config' && host.alias) {
    args.push(host.alias)
    return args
  }

  if (host.port) args.push('-p', String(host.port))
  if (host.identityFile) args.push('-i', host.identityFile)
  args.push(host.user ? `${host.user}@${host.hostname}` : host.hostname)
  return args
}

/**
 * POSIX single-quoting: wrap in `'...'`, escaping an embedded `'` as `'\''`.
 * The standard, exhaustively-correct way to make one argument shell-safe.
 */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * One remote command line, safe to hand to sshd as the trailing argument.
 *
 * This is the one place in the whole feature where a string crosses a real
 * shell boundary: sshd runs the server-side command through the remote
 * user's shell (`sh -c '<this>'`), so every argument is quoted here rather
 * than trusted. The `ssh` argv itself (host, `-i`, `-p`, …) never goes
 * through a shell — `execFile`/`node-pty` pass it straight to `execve` — so
 * nothing above this function needs escaping at all.
 */
export function remoteCommandLine(cmd: string, args: string[]): string {
  return [cmd, ...args].map(shQuote).join(' ')
}

export interface RemoteExecResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** Run one non-interactive command on the host and capture its output. */
export async function remoteExec(
  host: SshHost,
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<RemoteExecResult> {
  const argv = [...sshArgv(host, { interactive: false }), remoteCommandLine(cmd, args)]
  try {
    const { stdout, stderr } = await run('ssh', argv, {
      timeout: opts.timeoutMs ?? 20_000,
      maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024
    })
    return { ok: true, stdout, stderr }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(err) }
  }
}

/** The remote command a terminal pane runs: land in `cwd`, then a login shell. */
export function remoteShellCommand(cwd: string): string {
  // A bare `cd X; exec $SHELL -l` is deliberately simple — this runs through
  // the REMOTE user's own default shell, whatever it is, rather than assuming
  // bash exists. If cwd has vanished, cd fails and the shell still starts, in
  // the remote home directory, rather than the pane going straight to a dead
  // connection over one missing folder.
  return `cd ${shQuote(cwd)} 2>/dev/null; exec "$SHELL" -l`
}

export async function existsRemote(host: SshHost, target: string): Promise<boolean> {
  const res = await remoteExec(host, 'test', ['-e', target])
  return res.ok
}

export async function mkdirRemote(host: SshHost, target: string): Promise<RemoteExecResult> {
  return remoteExec(host, 'mkdir', ['-p', target])
}

/** Symlink-resolved form, the same reason the local worktree code resolves one. */
export async function realpathRemote(host: SshHost, target: string): Promise<string | null> {
  const res = await remoteExec(host, 'realpath', [target])
  return res.ok ? res.stdout.trim() || null : null
}

export async function removeRemote(host: SshHost, target: string): Promise<RemoteExecResult> {
  return remoteExec(host, 'rm', ['-rf', '--', target])
}

/**
 * Whether a binary is on the remote user's PATH — same question `which()` in
 * the main process asks locally, asked of the far end instead, so the agent
 * picker does not grey out a CLI that is only missing on this machine, or
 * show one as available because it happens to be installed here.
 */
export async function remoteWhich(host: SshHost, bin: string): Promise<boolean> {
  if (!bin) return true
  const res = await remoteExec(host, 'command', ['-v', bin])
  return res.ok && res.stdout.trim().length > 0
}

/**
 * `$HOME` on the far end, expanded by the remote shell rather than assumed.
 *
 * This is the one place a raw, unquoted snippet is sent instead of going
 * through `remoteCommandLine` — deliberately, because the whole point is
 * tilde/variable expansion, which quoting exists everywhere else specifically
 * to prevent. Safe only because the snippet is a fixed string this file
 * wrote, never anything built from a host label, a path, or any other value
 * that could have come from outside.
 */
export async function remoteHomeDir(host: SshHost): Promise<string | null> {
  const argv = [...sshArgv(host, { interactive: false }), 'printf %s "$HOME"']
  try {
    const { stdout } = await run('ssh', argv, { timeout: 15_000 })
    const home = stdout.trim()
    return home || null
  } catch {
    return null
  }
}

/**
 * Where a remote workspace's worktrees live: a fixed folder in that user's
 * own home directory, since there is no Eaon install on the far end to own an
 * app-data folder the way the local side does.
 */
export async function remoteWorktreeBase(host: SshHost): Promise<string | null> {
  const home = await remoteHomeDir(host)
  return home ? `${home}/.eaon-worktrees` : null
}

/* ------------------------------------------------------------------------ *
 * ~/.ssh/config, read-only
 * ------------------------------------------------------------------------ */

interface RawBlock {
  patterns: string[]
  fields: Map<string, string>
}

/**
 * Top-level `Host` blocks only.
 *
 * `Include` is not followed and `Match` is not evaluated — both would need a
 * real implementation of ssh_config's own resolution order to get right, and
 * getting it slightly wrong would be worse than not trying: a host that looks
 * connectable here but resolves differently for the real `ssh` binary is a
 * trap. A block whose pattern contains a wildcard is skipped for the same
 * reason it cannot be "one host" to connect to. This only ever reads the
 * file — it is not consulted for anything ssh itself is about to do, so a
 * blind spot here costs a missing entry in a picker, never a wrong
 * connection.
 */
async function readBlocks(file: string): Promise<RawBlock[]> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return []
  }

  const blocks: RawBlock[] = []
  let current: RawBlock | null = null

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const sp = line.indexOf(' ')
    const tab = line.indexOf('\t')
    const cut = sp === -1 ? tab : tab === -1 ? sp : Math.min(sp, tab)
    if (cut === -1) continue
    const key = line.slice(0, cut).toLowerCase()
    const value = line.slice(cut + 1).trim()

    if (key === 'host') {
      current = { patterns: value.split(/\s+/), fields: new Map() }
      blocks.push(current)
      continue
    }
    if (!current || current.fields.has(key)) continue
    // First occurrence wins, matching ssh_config's own precedence rule.
    current.fields.set(key, value)
  }
  return blocks
}

function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

export async function parseSshConfig(file = path.join(os.homedir(), '.ssh', 'config')): Promise<SshHost[]> {
  const blocks = await readBlocks(file)
  const hosts: SshHost[] = []

  for (const block of blocks) {
    for (const alias of block.patterns) {
      if (alias.includes('*') || alias.includes('?')) continue

      const hostname = block.fields.get('hostname') || alias
      const user = block.fields.get('user') || null
      const portRaw = block.fields.get('port')
      const port = portRaw && /^\d+$/.test(portRaw) ? Number(portRaw) : null
      const identityRaw = block.fields.get('identityfile') || null

      const host: SshHost = {
        id: `cfg:${alias}`,
        label: '',
        hostname,
        user,
        port,
        identityFile: identityRaw ? expandHome(identityRaw) : null,
        source: 'config',
        alias
      }
      host.label = hostLabel(host)
      hosts.push(host)
    }
  }
  return hosts
}

let manualSeq = 0

export function hostFromManualInput(input: ManualHostInput): SshHost {
  manualSeq += 1
  const host: SshHost = {
    id: `manual:${Date.now().toString(36)}${manualSeq}`,
    label: '',
    hostname: input.hostname.trim(),
    user: input.user?.trim() || null,
    port: input.port || null,
    identityFile: input.identityFile?.trim() || null,
    source: 'manual',
    alias: null
  }
  host.label = input.label?.trim() || hostLabel(host)
  return host
}
