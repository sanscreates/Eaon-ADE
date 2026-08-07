/*
 * Drives the worktree engine against a real throwaway repository.
 *
 * Everything here is genuine git — no mocks — because the whole value of the
 * feature is a claim about git's behaviour: that two agents editing the same
 * file at the same time cannot see each other, and that the one you pick can
 * still be merged back. That is not provable by reading the code.
 *
 *   node scripts/check-worktrees.mjs
 */

import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaon-worktrees-'))
const repo = path.join(tmp, 'project')
const trees = path.join(tmp, 'trees')

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

/* ---- a real repository ------------------------------------------------ */

fs.mkdirSync(repo, { recursive: true })
git(repo, 'init', '-b', 'main')
git(repo, 'config', 'user.email', 'test@example.com')
git(repo, 'config', 'user.name', 'Worktree Test')
fs.writeFileSync(path.join(repo, 'app.js'), 'export const answer = 1\n')
fs.writeFileSync(path.join(repo, 'README.md'), '# project\n')
git(repo, 'add', '-A')
git(repo, 'commit', '-m', 'initial')
fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true })

/* ---- module under test ------------------------------------------------ */

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
wt.setBaseDir(trees)

/* ---- 1. finding the repository ---------------------------------------- */

console.log('\nfinding the repository')
check('the root is found from the root', (await wt.repoRoot(repo)) === fs.realpathSync(repo))
check(
  'and from a subdirectory several levels down',
  (await wt.repoRoot(path.join(repo, 'src/deep'))) === fs.realpathSync(repo)
)
check('a non-repository reports nothing', (await wt.repoRoot(tmp)) === null)

/* ---- 2. cutting worktrees --------------------------------------------- */

console.log('\ncutting worktrees')
const a = await wt.create({ cwd: repo, branch: 'eaon/trial-a' })
const b = await wt.create({ cwd: path.join(repo, 'src/deep'), branch: 'eaon/trial-b' })

check('worktree A was created', a.ok, a.error)
check('worktree B was created from a subdirectory', b.ok, b.error)
check('both were cut from the same commit', a.baseSha === b.baseSha)
check('A is a real directory', fs.existsSync(path.join(a.worktree.path, 'app.js')))
check('A is on its own branch', a.worktree.branch === 'eaon/trial-a', a.worktree.branch)
check(
  'the slash in the branch did not make a nested directory',
  !a.worktree.path.includes('eaon/trial'),
  a.worktree.path
)

const dup = await wt.create({ cwd: repo, branch: 'eaon/trial-a' })
check('creating the same one twice is refused', !dup.ok, dup.error)

const listed = await wt.list(repo)
check('list reports the repository plus both worktrees', listed.length === 3, listed.length)
check('exactly one is flagged as the main checkout', listed.filter((w) => w.isMain).length === 1)
check(
  'the main checkout is the repository itself',
  fs.realpathSync(listed.find((w) => w.isMain).path) === fs.realpathSync(repo)
)

/* ---- 3. isolation, which is the whole point ---------------------------- */

console.log('\nisolation between parallel agents')
// Two "agents" edit the same file, at the same time, differently.
fs.writeFileSync(path.join(a.worktree.path, 'app.js'), 'export const answer = 42\n')
fs.writeFileSync(path.join(a.worktree.path, 'NOTES.md'), 'A was here\n')
fs.writeFileSync(path.join(b.worktree.path, 'app.js'), 'export const answer = 99\n')

check(
  "A cannot see B's edit",
  fs.readFileSync(path.join(a.worktree.path, 'app.js'), 'utf8').includes('42')
)
check(
  "B cannot see A's edit",
  fs.readFileSync(path.join(b.worktree.path, 'app.js'), 'utf8').includes('99')
)
check(
  'the repository itself is untouched by either',
  fs.readFileSync(path.join(repo, 'app.js'), 'utf8').includes('answer = 1')
)
check('and the repository has no uncommitted changes', git(repo, 'status', '--porcelain').trim() === '')

/* ---- 4. measuring what each did ---------------------------------------- */

console.log('\nmeasuring the work')
const changeA = await wt.change(a.worktree.path, a.baseSha)
check('A shows one changed file', changeA.filesChanged === 1, changeA.filesChanged)
check('A shows an insertion and a deletion', changeA.insertions === 1 && changeA.deletions === 1)
check('A shows its untracked file', changeA.untracked === 1, changeA.untracked)
check('A is dirty before committing', changeA.dirty === true)
check('A has no commits of its own yet', changeA.commits === 0, changeA.commits)

// Uncommitted work must still count, or the comparison is useless exactly
// when you need it: while the agents are still running.
check('uncommitted work is counted', changeA.filesChanged > 0)

const diffA = await wt.diff(a.worktree.path, a.baseSha)
check('the diff shows the new value', diffA.includes('42'))
check('the diff mentions the file', diffA.includes('app.js'))

/* ---- 5. the base does not move ----------------------------------------- */

console.log('\nthe base is pinned')
fs.writeFileSync(path.join(repo, 'README.md'), '# project\n\nunrelated later commit\n')
git(repo, 'add', '-A')
git(repo, 'commit', '-m', 'later work on main')

const afterMove = await wt.change(a.worktree.path, a.baseSha)
check(
  "a later commit on main does not change what A appears to have done",
  afterMove.filesChanged === changeA.filesChanged &&
    afterMove.insertions === changeA.insertions,
  `${afterMove.filesChanged}/${afterMove.insertions}`
)

/* ---- 6. committing and merging the winner ------------------------------ */

console.log('\nmerging the winner')
const committed = await wt.commitAll(a.worktree.path, 'Trial A: set the answer to 42')
check('A committed cleanly', committed.ok, committed.error)

const afterCommit = await wt.change(a.worktree.path, a.baseSha)
check('A is no longer dirty', afterCommit.dirty === false)
check('A now has a commit', afterCommit.commits === 1, afterCommit.commits)
check('the untracked file was included', afterCommit.untracked === 0, afterCommit.untracked)
// The two are different questions: this worktree has now diverged from the
// base commit permanently (filesChanged stays truthful), but nothing is
// *uncommitted* right now. A version that derived "dirty" from the base diff
// instead of the working tree got this permanently wrong once anything was
// committed — dirty would never go false again for the rest of the trial.
check(
  'diverged-from-base and dirty-right-now are answered separately',
  afterCommit.filesChanged > 0 && afterCommit.dirty === false,
  JSON.stringify(afterCommit)
)

// The real case this exists for: an agent keeps going after an intermediate
// commit. Dirty has to be able to go true again, which a definition anchored
// to "has this branch diverged from base" could never do once true.
// Keeps "42" as a substring, since a later check still expects to find it in
// the merged repository — this is a further edit, not a reversal of the first.
fs.writeFileSync(path.join(a.worktree.path, 'app.js'), 'export const answer = 42 // tweaked\n')
const afterFurtherEdit = await wt.change(a.worktree.path, a.baseSha)
check('a further edit after the commit is dirty again', afterFurtherEdit.dirty === true)
await wt.commitAll(a.worktree.path, 'Trial A: one more tweak')
check(
  'and committing it clears dirty again',
  (await wt.change(a.worktree.path, a.baseSha)).dirty === false
)

const merged = await wt.merge(repo, 'eaon/trial-a')
check('the merge succeeded', merged.ok, merged.message)
check(
  "the repository now has A's change",
  fs.readFileSync(path.join(repo, 'app.js'), 'utf8').includes('42')
)
check('and A\'s new file', fs.existsSync(path.join(repo, 'NOTES.md')))
check(
  'the merge was recorded as a merge, not a fast-forward',
  git(repo, 'log', '-1', '--pretty=%P').trim().split(' ').length === 2
)

/* ---- 7. a losing branch that conflicts --------------------------------- */

console.log('\na conflicting merge')
await wt.commitAll(b.worktree.path, 'Trial B: set the answer to 99')
const clash = await wt.merge(repo, 'eaon/trial-b')
check('the conflicting merge reports failure', !clash.ok)
check('and names the conflicted file', clash.conflicts.includes('app.js'), JSON.stringify(clash.conflicts))
check('the conflict is left in the tree to resolve', git(repo, 'status', '--porcelain').includes('U'))
git(repo, 'merge', '--abort')

/* ---- 8. cleaning up ---------------------------------------------------- */

console.log('\ncleaning up')
const refuseMain = await wt.remove(repo, repo, { force: true })
check('removing the repository itself is refused', !refuseMain.ok, refuseMain.error)
// Specifically by our own guard. Git would refuse too, but relying on that
// leaves the guard untested — and it was in fact broken while this passed.
check(
  'refused by our own check, not incidentally by git',
  refuseMain.error === 'That is the repository itself.',
  refuseMain.error
)
check('so the repository is still there', fs.existsSync(path.join(repo, 'app.js')))

const gone = await wt.remove(repo, b.worktree.path, { force: true, deleteBranch: true })
check('a dirty losing worktree is removed', gone.ok, gone.error)
check('its directory is gone', !fs.existsSync(b.worktree.path))
check(
  'its branch is gone too',
  !git(repo, 'branch', '--list', 'eaon/trial-b').trim()
)
check('the list is down to two', (await wt.list(repo)).length === 2)

// A directory deleted behind git's back leaves a stale registration.
fs.rmSync(a.worktree.path, { recursive: true, force: true })
const pruned = await wt.prune(repo)
check('prune succeeds', pruned.ok, pruned.error)
check('and the stale entry is forgotten', (await wt.list(repo)).length === 1)

/* ---- 9. Eaon's own files do not count as the agent's work -------------- */

console.log("\nEaon's own provisioning is not mistaken for an agent's work")
const c = await wt.create({ cwd: repo, branch: 'eaon/trial-c' })
check('worktree C was created', c.ok, c.error)

// What a pane spawn actually provisions into a worktree: memory tooling the
// app puts there, not anything an agent wrote.
fs.mkdirSync(path.join(c.worktree.path, '.claude', 'skills'), { recursive: true })
fs.writeFileSync(path.join(c.worktree.path, '.claude', 'skills', 'eaon-brain.md'), 'skill\n')
fs.writeFileSync(path.join(c.worktree.path, '.mcp.json'), '{}\n')

const provisionedOnly = await wt.change(c.worktree.path, c.baseSha)
check(
  'a worktree touched only by provisioning reads as untouched',
  provisionedOnly.filesChanged === 0 && provisionedOnly.untracked === 0,
  JSON.stringify(provisionedOnly)
)
check('and is not considered dirty', provisionedOnly.dirty === false)

const provisionedDiff = await wt.diff(c.worktree.path, c.baseSha)
check(
  'its diff reads as no changes, not a list of our own files',
  provisionedDiff === 'No changes yet.',
  provisionedDiff
)

const committedEmpty = await wt.commitAll(c.worktree.path, 'Trial C: nothing to commit')
check('committing an all-provisioning worktree succeeds', committedEmpty.ok, committedEmpty.error)
check(
  'and makes no commit at all',
  (await wt.change(c.worktree.path, c.baseSha)).commits === 0
)
check(
  "the provisioning files were never staged, let alone committed",
  !git(c.worktree.path, 'log', '--all', '--name-only').includes('.mcp.json')
)

// Now give the same worktree a real edit alongside the provisioning.
fs.writeFileSync(path.join(c.worktree.path, 'app.js'), 'export const answer = 7\n')
const mixed = await wt.change(c.worktree.path, c.baseSha)
check(
  'a real edit is counted even with provisioning files present',
  mixed.filesChanged === 1 && mixed.untracked === 0,
  JSON.stringify(mixed)
)
check('and the worktree now reads as dirty', mixed.dirty === true)

const committedMixed = await wt.commitAll(c.worktree.path, 'Trial C: real change')
check('committing with a real change succeeds', committedMixed.ok, committedMixed.error)
check(
  'the commit contains the real file',
  git(c.worktree.path, 'show', '--name-only', '--pretty=format:').trim() === 'app.js'
)
check(
  'and does not contain our provisioning',
  !git(c.worktree.path, 'show', '--name-only', '--pretty=format:').includes('.mcp.json')
)
check(
  "the provisioning files are still on disk, just not tracked",
  fs.existsSync(path.join(c.worktree.path, '.mcp.json')) &&
    git(c.worktree.path, 'status', '--porcelain', '--', '.mcp.json').startsWith('??')
)

await wt.remove(repo, c.worktree.path, { force: true, deleteBranch: true })

/* ---- 10. failure paths -------------------------------------------------- */

console.log('\nfailure paths')
const notRepo = await wt.create({ cwd: tmp, branch: 'nope' })
check('creating outside a repository fails cleanly', !notRepo.ok && !!notRepo.error, notRepo.error)
const badBase = await wt.create({ cwd: repo, branch: 'x', baseRef: 'no-such-ref' })
check('an unresolvable base fails cleanly', !badBase.ok && !!badBase.error, badBase.error)
const badMerge = await wt.merge(repo, 'no-such-branch')
check('merging a missing branch fails cleanly', !badMerge.ok && !!badMerge.message)

/* ---- done -------------------------------------------------------------- */

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
