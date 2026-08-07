/*
 * Checks the REMOTE half of the worktree engine — the branches in git.ts and
 * worktrees.ts that run when a workspace carries a host.
 *
 * The fake `ssh` on PATH does not simulate anything: it strips ssh's own
 * flags and runs the trailing remote-command string for real, through a
 * plain shell, with $HOME pointed at a throwaway directory standing in for
 * a remote home. Every `git`, `mkdir`, `test -e` the real code issues really
 * runs — this is "ssh to localhost" without needing sshd, real network I/O,
 * or a second machine, and it is what gives this test teeth: a bug in how
 * worktrees.ts builds a remote command would show up as a real failure here,
 * not just a re-statement of what the code is supposed to do.
 *
 * What this does NOT prove: that authentication against a real, distant host
 * succeeds. That gap is real and is not papered over — see check-ssh.mjs's
 * own header for why it is out of scope for an unattended check.
 *
 *   node scripts/check-ssh-worktrees.mjs
 */

import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaon-ssh-wt-'))
const repo = path.join(tmp, 'project')
const fakeRemoteHome = path.join(tmp, 'remote-home')
const binDir = path.join(tmp, 'bin')

let pass = 0
const failures = []
function check(name, ok, extra) {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${extra}` : ''}`)
  }
}

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/* ---- a real repository, and a fake "remote" home to hold checkouts ------ */

fs.mkdirSync(repo, { recursive: true })
fs.mkdirSync(fakeRemoteHome, { recursive: true })
git(repo, 'init', '-b', 'main')
git(repo, 'config', 'user.email', 'test@example.com')
git(repo, 'config', 'user.name', 'Remote Worktree Test')
fs.writeFileSync(path.join(repo, 'app.js'), 'export const answer = 0\n')
git(repo, 'add', '-A')
git(repo, 'commit', '-m', 'initial')

fs.mkdirSync(binDir, { recursive: true })
fs.writeFileSync(
  path.join(binDir, 'ssh'),
  [
    '#!/bin/bash',
    "# Strip ssh's own flags/target; the LAST argument is always the remote",
    '# command line — that is what sshArgv()/remoteCommandLine() build.',
    'last=$#',
    'eval "cmd=\\"\\$$last\\""',
    'exec sh -c "$cmd"'
  ].join('\n')
)
fs.chmodSync(path.join(binDir, 'ssh'), 0o755)

const testHost = {
  id: 'manual:remote-test',
  label: 'remote test box',
  hostname: 'unused.invalid',
  user: null,
  port: null,
  identityFile: null,
  source: 'manual',
  alias: null
}

/* ---- bundle git.ts and worktrees.ts, node-pty-free so no native stub needed */

const outfile = path.join(tmp, 'worktrees.mjs')
await build({
  entryPoints: [path.join(root, 'src/main/worktrees.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent'
})
const wt = await import(outfile)
wt.setBaseDir(path.join(tmp, 'unused-local-base'))

const oldPath = process.env.PATH
const oldHome = process.env.HOME
process.env.PATH = `${binDir}:${oldPath}`
process.env.HOME = fakeRemoteHome

try {
  /* ---- 1. create over the "remote" path ---------------------------------- */

  console.log('\ncreating a remote worktree')
  const a = await wt.create({ cwd: repo, branch: 'eaon/remote-a' }, testHost)
  check('the remote create call succeeds', a.ok, a.error)
  // realpathRemote resolves symlinks — correctly, it is the same fix applied
  // to the local path — so the comparison has to be against the resolved
  // form of fakeRemoteHome too, or a correct answer looks like a wrong one on
  // any machine where the temp dir itself sits behind a symlink (macOS: /var
  // is /private/var).
  const resolvedFakeRemoteHome = fs.realpathSync(fakeRemoteHome)
  check(
    'the checkout landed under the fake remote $HOME, not the local baseDir',
    a.worktree?.path.startsWith(resolvedFakeRemoteHome),
    a.worktree?.path
  )
  check(
    'it used the fixed .eaon-worktrees folder',
    a.worktree?.path.includes('/.eaon-worktrees/'),
    a.worktree?.path
  )
  check('a real directory exists there', fs.existsSync(a.worktree.path))
  check('it is on its own branch', a.worktree.branch === 'eaon/remote-a')

  const dup = await wt.create({ cwd: repo, branch: 'eaon/remote-a' }, testHost)
  check('creating the same remote branch twice is refused', !dup.ok, dup.error)
  check(
    // The slash in the branch name is turned into a dash for the directory
    // name — same as the local path — so this is the slugified form, not the
    // branch name verbatim.
    'the collision message names just the directory, not the whole path',
    dup.error === 'eaon-remote-a already exists.',
    dup.error
  )

  const listed = await wt.list(repo, testHost)
  check('list sees the repo plus the remote worktree', listed.length === 2, listed.length)

  /* ---- 2. isolation, measured the same way the local test measures it ---- */

  console.log('\nisolation still holds over the remote path')
  fs.writeFileSync(path.join(a.worktree.path, 'app.js'), 'export const answer = 42\n')
  fs.writeFileSync(path.join(a.worktree.path, 'NOTES.md'), 'from a remote agent\n')
  // Eaon's own provisioning, exactly as a real pane spawn would leave it.
  fs.mkdirSync(path.join(a.worktree.path, '.claude', 'skills'), { recursive: true })
  fs.writeFileSync(path.join(a.worktree.path, '.mcp.json'), '{}\n')

  check(
    'the repository itself is untouched',
    fs.readFileSync(path.join(repo, 'app.js'), 'utf8').includes('answer = 0')
  )

  const changeA = await wt.change(a.worktree.path, a.baseSha, testHost)
  check('the real edit is counted', changeA.filesChanged === 1, changeA.filesChanged)
  check('the new file is counted', changeA.untracked === 1, changeA.untracked)
  check(
    "Eaon's own provisioning is not counted",
    changeA.filesChanged + changeA.untracked === 2,
    JSON.stringify(changeA)
  )
  check('it reads as dirty before committing', changeA.dirty === true)

  const diffA = await wt.diff(a.worktree.path, a.baseSha, testHost)
  check('the diff shows the real change', diffA.includes('42'))

  /* ---- 3. commit, excluding provisioning, then merge ---------------------- */

  console.log('\ncommitting and merging over the remote path')
  const committed = await wt.commitAll(a.worktree.path, 'Remote trial A', testHost)
  check('commitAll succeeds remotely', committed.ok, committed.error)

  const afterCommit = await wt.change(a.worktree.path, a.baseSha, testHost)
  check('it is no longer dirty after committing', afterCommit.dirty === false)
  check('it has exactly one commit', afterCommit.commits === 1, afterCommit.commits)

  check(
    "Eaon's provisioning was never committed",
    !git(a.worktree.path, 'show', '--name-only', '--pretty=format:').includes('.mcp.json')
  )
  check(
    'the provisioning files are still on disk, just untracked',
    fs.existsSync(path.join(a.worktree.path, '.mcp.json'))
  )

  const merged = await wt.merge(repo, 'eaon/remote-a', testHost)
  check('the remote branch merges into the local repo', merged.ok, merged.message)
  check(
    "the repository now has the remote agent's change",
    fs.readFileSync(path.join(repo, 'app.js'), 'utf8').includes('42')
  )
  check('and its new file', fs.existsSync(path.join(repo, 'NOTES.md')))

  /* ---- 4. cleanup ----------------------------------------------------------- */

  console.log('\ncleaning up the remote checkout')
  const gone = await wt.remove(repo, a.worktree.path, { force: true, deleteBranch: true }, testHost)
  check('remove succeeds remotely', gone.ok, gone.error)
  check('the remote directory is actually gone', !fs.existsSync(a.worktree.path))
  check(
    'the branch is gone from the local repo too',
    !git(repo, 'branch', '--list', 'eaon/remote-a').trim()
  )

  const pruned = await wt.prune(repo, testHost)
  check('prune succeeds remotely', pruned.ok, pruned.error)
  check('the list is back down to just the repository', (await wt.list(repo, testHost)).length === 1)

  /* ---- 5. a local call in the same process is completely unaffected -------- */

  console.log('\nthe local path is untouched by any of the above')
  const local = await wt.create({ cwd: repo, branch: 'eaon/still-local' })
  check('a local create (no host) still works after remote calls', local.ok, local.error)
  const resolvedLocalBase = fs.realpathSync(path.join(tmp, 'unused-local-base'))
  check(
    'it landed under the local baseDir, not the fake remote $HOME',
    local.worktree?.path.startsWith(resolvedLocalBase),
    local.worktree?.path
  )
  await wt.remove(repo, local.worktree.path, { force: true, deleteBranch: true })
} finally {
  process.env.PATH = oldPath
  process.env.HOME = oldHome
}

/* ---- done ---------------------------------------------------------------- */

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
