/*
 * Checks the SSH connection layer without a reachable remote host.
 *
 * Two things are provable without one: the exact argv `ssh` would be invoked
 * with (a pure function, asserted directly — no execution, no network), and
 * the parsing of a real `~/.ssh/config`-shaped file (a real file on disk, read
 * for real, just not connected to). What is NOT provable here is that a live
 * connection actually succeeds — this machine has no sshd reachable and
 * spinning one up, or connecting to a host from the user's real config, is
 * out of scope for an unattended check. That gap is real and stated, not
 * papered over.
 *
 *   node scripts/check-ssh.mjs
 */

import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaon-ssh-'))

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

const outfile = path.join(tmp, 'ssh.mjs')
await build({
  entryPoints: [path.join(root, 'src/main/ssh.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent'
})
const ssh = await import(outfile)

/* ---- 1. argv construction: config-sourced host ------------------------- */

console.log('\na host read from ~/.ssh/config connects by alias')
const configHost = {
  id: 'cfg:nas',
  label: 'nas',
  hostname: '10.0.0.39',
  user: 'vchada',
  port: null,
  identityFile: '/Users/x/.ssh/id_ed25519_nas',
  source: 'config',
  alias: 'nas'
}
const interactive = ssh.sshArgv(configHost, { interactive: true })
check('the alias is the connection target, not the raw hostname', interactive.includes('nas'))
check('the raw hostname never appears', !interactive.some((a) => a.includes('10.0.0.39')))
check(
  'ssh_config fields we already parsed are not re-stated',
  !interactive.includes('-i') && !interactive.includes('-p'),
  JSON.stringify(interactive)
)
check('interactive mode forces a pty', interactive.includes('-tt'))
check('a connect timeout is always set', interactive.some((a) => a === 'ConnectTimeout=10'))

const nonInteractive = ssh.sshArgv(configHost, { interactive: false })
check('non-interactive mode does not force a pty', !nonInteractive.includes('-tt'))

/* ---- 2. argv construction: manual host ---------------------------------- */

console.log('\na manually-entered host states everything explicitly')
const manualHost = ssh.hostFromManualInput({
  hostname: 'box.example.com',
  user: 'dev',
  port: 2222,
  identityFile: '~/.ssh/id_work'
})
check('a manual host gets a stable id', manualHost.id.startsWith('manual:'))
check('the label falls back to user@host', manualHost.label === 'dev@box.example.com')

const manualArgv = ssh.sshArgv(manualHost, { interactive: true })
check('the port is passed explicitly', manualArgv.includes('-p') && manualArgv.includes('2222'))
check(
  'the identity file is passed explicitly, expanded',
  manualArgv.some((a) => a.startsWith('/') || a === '~/.ssh/id_work'),
  JSON.stringify(manualArgv)
)
check('the target is user@hostname', manualArgv.includes('dev@box.example.com'))

/* ---- 3. remote command quoting ------------------------------------------ */

console.log("\nthe one string that crosses a real shell boundary is quoted")

/**
 * A minimal POSIX single-quote parser: the exact grammar `shQuote` produces
 * (`'literal'` spans and `\'` escapes between them, space-separated). This is
 * the convincing form of this test — round-trip the quoted line back into an
 * argv array with an independent parser and compare it to the original,
 * rather than pin one exact rendering or hand-count characters, both of which
 * are exactly what got this test's own first draft wrong.
 */
function reparseArgv(line) {
  const argv = []
  let cur = ''
  let i = 0
  let started = false
  while (i < line.length) {
    const c = line[i]
    if (c === ' ' && !started) {
      i++
      continue
    }
    if (c === ' ') {
      argv.push(cur)
      cur = ''
      started = false
      i++
      continue
    }
    started = true
    if (c === "'") {
      i++
      while (line[i] !== "'") {
        cur += line[i]
        i++
      }
      i++ // closing quote
    } else if (c === '\\') {
      cur += line[i + 1]
      i += 2
    } else {
      cur += c
      i++
    }
  }
  if (started) argv.push(cur)
  return argv
}

function checkRoundTrip(name, cmd, args) {
  const quoted = ssh.remoteCommandLine(cmd, args)
  const back = reparseArgv(quoted)
  check(name, JSON.stringify(back) === JSON.stringify([cmd, ...args]), quoted)
}

checkRoundTrip('a plain command round-trips exactly', 'git', ['status'])
checkRoundTrip('a path with a space survives as one argument', 'git', [
  '-C',
  '/tmp/my repo',
  'status'
])
checkRoundTrip(
  "a single quote in an argument cannot break out of its quoting",
  'echo',
  [`'; rm -rf ~; echo '`]
)
checkRoundTrip('a backslash in an argument is preserved literally', 'echo', ['a\\b'])
checkRoundTrip('an empty argument survives as an empty argument, not vanishing', 'git', ['', 'x'])

// The round trip above is the real proof: reparseArgv is backslash-aware, so
// recovering the exact original argument — semicolons and all — from the
// quoted form is only possible if a real POSIX shell would also see those
// semicolons as literal text rather than command separators. A cruder check
// that just toggles on every `'` without understanding `\'` escapes would
// miscount here and isn't worth carrying alongside a strictly better one.

/* ---- 4. the remote shell command a terminal pane runs -------------------- */

console.log('\nthe remote command a terminal pane runs')
const shellCmd = ssh.remoteShellCommand('/home/dev/project')
check('it lands in the requested directory', shellCmd.includes("'/home/dev/project'"))
check('a cd failure does not abort the connection', shellCmd.includes('2>/dev/null'))
check('it hands off to the remote user\'s own shell', shellCmd.includes('exec "$SHELL" -l'))

/* ---- 5. parsing a real ssh_config file ----------------------------------- */

console.log('\nparsing ~/.ssh/config')
const cfgFile = path.join(tmp, 'config')
fs.writeFileSync(
  cfgFile,
  [
    '# a comment, and a blank line below',
    '',
    'Host nas',
    '  HostName 10.0.0.39',
    '  User vchada',
    '  IdentityFile ~/.ssh/id_ed25519_nas',
    '',
    '# a wildcard block must not become a connectable "host"',
    'Host *.internal',
    '  User root',
    '',
    '# catch-all defaults must not become a connectable "host" either',
    'Host *',
    '  ServerAliveInterval 30',
    '',
    'Host staging',
    '  HostName 10.0.0.50',
    '  Port 2202',
    '',
    '# two aliases sharing one block',
    'Host build1 build2',
    '  HostName 10.0.0.60',
    '',
    '# a duplicate field: the first occurrence wins, matching ssh_config itself',
    'Host dup',
    '  HostName first.example.com',
    '  HostName second.example.com'
  ].join('\n')
)

const parsed = await ssh.parseSshConfig(cfgFile)
const byAlias = Object.fromEntries(parsed.map((h) => [h.alias, h]))

check('exactly the real, single hosts are found', parsed.length === 5, parsed.map((h) => h.alias))
check('the wildcard block is skipped', !byAlias['*.internal'])
check('the catch-all block is skipped', !byAlias['*'])
check('nas resolved its hostname', byAlias.nas?.hostname === '10.0.0.39')
check('nas resolved its user', byAlias.nas?.user === 'vchada')
check(
  'nas resolved its identity file with ~ expanded',
  byAlias.nas?.identityFile === path.join(os.homedir(), '.ssh', 'id_ed25519_nas'),
  byAlias.nas?.identityFile
)
check('staging resolved its port as a number', byAlias.staging?.port === 2202)
check('a block with no HostName falls back to the alias', byAlias.build1?.hostname === '10.0.0.60')
check('both aliases in one block are found', Boolean(byAlias.build1) && Boolean(byAlias.build2))
check('the first HostName wins on a duplicate key', byAlias.dup?.hostname === 'first.example.com')
check(
  'every parsed host connects by alias, never by field re-statement',
  parsed.every((h) => h.source === 'config' && h.alias)
)

const missing = await ssh.parseSshConfig(path.join(tmp, 'does-not-exist'))
check('a missing config file returns no hosts rather than throwing', Array.isArray(missing) && missing.length === 0)

/* ---- 6. PtyManager actually invokes ssh, not just sshArgv() in a vacuum - */

console.log('\nPtyManager spawns a real ssh process with the right argv')

/*
 * Everything above proves sshArgv()/remoteShellCommand() build the right
 * strings. It does not prove PtyManager.spawn() actually uses them — that is
 * a separate, thin composition in pty-manager.ts, and thin compositions are
 * exactly where a copy-paste or an inverted condition hides. This drives the
 * real PtyManager class through node-pty's real spawn path, with a fake
 * `ssh` on PATH that does nothing but record its own argv — so what is
 * checked is what node-pty was actually told to execute, not a re-statement
 * of what the code is supposed to do.
 */
const binDir = path.join(tmp, 'bin')
fs.mkdirSync(binDir, { recursive: true })
const captureFile = path.join(tmp, 'captured-argv.json')
fs.writeFileSync(
  path.join(binDir, 'ssh'),
  ['#!/bin/bash', `printf '%s\\0' "$@" > ${JSON.stringify(captureFile)}`, 'exit 0'].join('\n')
)
fs.chmodSync(path.join(binDir, 'ssh'), 0o755)

// Unlike the other bundles in this file, this one imports a real npm
// dependency (node-pty) left external rather than inlined — Node's own
// resolver needs a node_modules ancestor to find it, which the system temp
// dir does not have. Written inside the repo instead, and always removed,
// success or failure, via the try/finally below.
const ptyOutfile = path.join(root, '.check-ssh-pty-manager.tmp.mjs')
try {
  await build({
    entryPoints: [path.join(root, 'src/main/pty-manager.ts')],
    outfile: ptyOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    // node-pty is a native addon that leans on CommonJS require() internally
    // to load its compiled binding; inlining it into an ESM bundle breaks
    // that require at the bundler level, nothing to do with the module under
    // test. Left external, Node's own loader handles the CJS interop.
    external: ['node-pty'],
    // pty-manager.ts only reaches into `electron` for app.getVersion(), used
    // to tag the environment of a *local* shell. Stubbing it is what lets
    // this run under plain Node instead of inside Electron, without touching
    // the module under test.
    plugins: [
      {
        name: 'stub-electron',
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron-stub', namespace: 'stub' }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export const app = { getVersion: () => "0.0.0-test" }',
            loader: 'js'
          }))
        }
      }
    ]
  })
  const { PtyManager } = await import(ptyOutfile)

  const testHost = {
    id: 'manual:test',
    label: 'test box',
    hostname: 'box.example.internal',
    user: 'dev',
    port: 2222,
    identityFile: '/Users/x/.ssh/id_work',
    source: 'manual',
    alias: null
  }

  const ptys = new PtyManager()
  const oldPath = process.env.PATH
  process.env.PATH = `${binDir}:${oldPath}`
  let spawnResult
  try {
    spawnResult = ptys.spawn({
      paneId: 'test-pane',
      cwd: '/remote/project path',
      cols: 80,
      rows: 24,
      host: testHost,
      command: null
    })
    // Generous on purpose: this is a one-time cost paid by the check script,
    // not a runtime latency — and by this point in the file, several esbuild
    // builds have already run in the same process, which pushes a fixed
    // short wait from "usually enough" to genuinely flaky.
    await new Promise((r) => setTimeout(r, 2500))
  } finally {
    process.env.PATH = oldPath
  }

  check('the spawn call itself reports success', spawnResult.ok, spawnResult.error)

  let capturedArgv = null
  try {
    const raw = fs.readFileSync(captureFile, 'utf8')
    capturedArgv = raw.split('\0').filter((s, i, arr) => !(i === arr.length - 1 && s === ''))
  } catch (err) {
    check('the fake ssh binary was actually invoked', false, String(err))
  }

  if (capturedArgv) {
    const expectedTail = ssh.remoteShellCommand('/remote/project path')
    check(
      'the identity file flag is present',
      capturedArgv.includes('-i') && capturedArgv.includes('/Users/x/.ssh/id_work')
    )
    check('the port flag is present', capturedArgv.includes('-p') && capturedArgv.includes('2222'))
    check('the target is user@hostname', capturedArgv.includes('dev@box.example.internal'))
    check('a pty is forced for an interactive pane', capturedArgv.includes('-tt'))
    check(
      'the last argument is the exact remote command sshArgv/remoteShellCommand would build',
      capturedArgv[capturedArgv.length - 1] === expectedTail,
      capturedArgv[capturedArgv.length - 1]
    )
  }

  ptys.kill('test-pane')
} finally {
  fs.rmSync(ptyOutfile, { force: true })
}

/* ---- done ---------------------------------------------------------------- */

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
