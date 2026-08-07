import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitFile, GitStatus } from '../shared/types'
import type { SshHost } from '../shared/ssh'
import { remoteExec } from './ssh'

const run = promisify(execFile)

/** Unit separator — survives commit subjects containing tabs, pipes or quotes. */
const FIELD = String.fromCharCode(31)

/**
 * Runs one `git` invocation, locally or on a remote box.
 *
 * `host` is the only new thing here; every caller below is unchanged from
 * before it existed. When absent this is exactly the local `execFile` call
 * this function always was. When present, `-C cwd` replaces the `cwd` child-
 * process option — ssh has no equivalent of "start the child here," so the
 * directory has to travel as a flag instead — and a failed remote command is
 * turned into a thrown `Error` with the same `.stdout`/`.stderr` shape
 * `execFile` itself throws, which is what lets every catch block below stay
 * unaware that the command might not have run on this machine at all.
 */
async function git(cwd: string, args: string[], host?: SshHost | null): Promise<string> {
  if (host) {
    const res = await remoteExec(host, 'git', ['-C', cwd, ...args])
    if (!res.ok) {
      const err = new Error(res.stderr || 'git failed') as Error & {
        stdout?: string
        stderr?: string
      }
      err.stdout = res.stdout
      err.stderr = res.stderr
      throw err
    }
    return res.stdout
  }
  const { stdout } = await run('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

/** Branch name only — cheap enough to poll for the chip in every pane header. */
export async function branchOf(cwd: string, host?: SshHost | null): Promise<string | null> {
  try {
    const out = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], host)
    const name = out.trim()
    return name && name !== 'HEAD' ? name : null
  } catch {
    return null
  }
}

export async function status(cwd: string, host?: SshHost | null): Promise<GitStatus> {
  const empty: GitStatus = { repo: false, branch: null, ahead: 0, behind: 0, files: [] }
  try {
    const out = await git(cwd, ['status', '--porcelain=v1', '-b', '--untracked-files=all'], host)
    const lines = out.split('\n').filter(Boolean)
    const files: GitFile[] = []
    let branch: string | null = null
    let ahead = 0
    let behind = 0

    for (const line of lines) {
      if (line.startsWith('## ')) {
        const head = line.slice(3)
        branch = head.split('...')[0].replace(/^No commits yet on /, '').trim()
        ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0)
        behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0)
        continue
      }
      const index = line[0]
      const work = line[1]
      let file = line.slice(3)
      // Renames arrive as "old -> new"; the new path is the useful one.
      if (file.includes(' -> ')) file = file.split(' -> ')[1]
      files.push({
        path: file.replace(/^"|"$/g, ''),
        index,
        work,
        staged: index !== ' ' && index !== '?'
      })
    }
    return { repo: true, branch, ahead, behind, files }
  } catch {
    return empty
  }
}

export async function diff(
  cwd: string,
  file: string,
  staged: boolean,
  host?: SshHost | null
): Promise<string> {
  try {
    const args = ['diff', '--no-color']
    if (staged) args.push('--cached')
    args.push('--', file)
    const out = await git(cwd, args, host)
    if (out.trim()) return out
    // Untracked files have no diff of their own.
    const show = await git(cwd, ['status', '--porcelain=v1', '--', file], host)
    if (show.startsWith('??')) return `New file: ${file}\n\nStage it to see a diff.`
    return 'No changes.'
  } catch (err) {
    return err instanceof Error ? err.message : 'Could not read the diff.'
  }
}

export async function stage(cwd: string, file: string, host?: SshHost | null): Promise<void> {
  await git(cwd, ['add', '--', file], host)
}

export async function unstage(cwd: string, file: string, host?: SshHost | null): Promise<void> {
  await git(cwd, ['restore', '--staged', '--', file], host)
}

export async function stageAll(cwd: string, host?: SshHost | null): Promise<void> {
  await git(cwd, ['add', '-A'], host)
}

export async function commit(
  cwd: string,
  message: string,
  host?: SshHost | null
): Promise<string> {
  try {
    const out = await git(cwd, ['commit', '-m', message], host)
    return out.trim() || 'Committed.'
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return (e.stdout || e.stderr || e.message || 'Commit failed.').trim()
  }
}

export interface LogEntry {
  hash: string
  subject: string
  when: string
  author: string
}

export async function log(cwd: string, limit = 20, host?: SshHost | null): Promise<LogEntry[]> {
  try {
    const out = await git(
      cwd,
      ['log', `-${limit}`, `--pretty=format:%h${FIELD}%s${FIELD}%cr${FIELD}%an`],
      host
    )
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, when, author] = line.split(FIELD)
        return { hash, subject, when, author }
      })
  } catch {
    return []
  }
}
