/*
 * Checks the integrations layer without launching the app.
 *
 * Two things are worth proving here and neither is provable by reading the
 * code. The first is that a credential cannot reach the renderer: every value
 * used below is a distinctive canary, and the whole reply is searched for it.
 * The second is that the login-shell read survives a real profile — one that
 * prints a banner before anything else and holds a value with a newline in it —
 * which is why this drives a stand-in shell rather than mocking the function.
 *
 *   node scripts/check-integrations.mjs
 */

import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaon-integrations-'))

let pass = 0
const failures = []

function check(name, ok, extra) {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

/* ---- canaries -------------------------------------------------------- */

const LINEAR = 'lin_CANARY_a1b2c3_never_leaves_main'
const JIRA_TOKEN = 'jira_CANARY_d4e5f6_never_leaves_main'
// A value with a newline in it: proves the NUL framing, which a line-based
// reader would split into two variables and get silently wrong.
const BITBUCKET = 'bb_CANARY_line1\nbb_CANARY_line2'
const ALL_CANARIES = [LINEAR, JIRA_TOKEN, 'bb_CANARY_line1', 'bb_CANARY_line2']

/* ---- a stand-in login shell ------------------------------------------ */

/*
 * Invoked as `shell -lic <script>`, so the script is $2. The banner on the
 * first line is the point: a real profile prints things, and the sentinel is
 * what keeps that noise from shifting every value by one.
 */
const fakeShell = path.join(tmp, 'noisy-shell')
fs.writeFileSync(
  fakeShell,
  [
    '#!/bin/bash',
    'echo "welcome to your shell — 3 updates available"',
    `export LINEAR_API_KEY=${JSON.stringify(LINEAR)}`,
    `export JIRA_API_TOKEN=${JSON.stringify(JIRA_TOKEN)}`,
    'export JIRA_BASE_URL="https://example.atlassian.net"',
    // $'...' rather than "...", because bash does not expand \n inside double
    // quotes — with those this would export the two characters and the newline
    // case would pass without ever having been tried.
    `export BITBUCKET_APP_PASSWORD=$'${BITBUCKET.replace(/\n/g, '\\n')}'`,
    'exec /bin/bash -c "$2" -- "$2"'
  ].join('\n')
)
fs.chmodSync(fakeShell, 0o755)

/* ---- bundle the module under test ------------------------------------ */

const outfile = path.join(tmp, 'integrations.mjs')
await build({
  entryPoints: [path.join(root, 'src/main/integrations.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent'
})

const mod = await import(outfile)

/** Nothing on PATH, so CLI-backed providers resolve deterministically. */
const noWhich = async () => null
/** Everything on PATH, to exercise the signed-out branch. */
const yesWhich = async (bin) => `/usr/bin/${bin}`

function clearCanaryEnv() {
  for (const n of [
    'LINEAR_API_KEY',
    'JIRA_API_TOKEN',
    'JIRA_BASE_URL',
    'JIRA_EMAIL',
    'BITBUCKET_APP_PASSWORD',
    'BITBUCKET_USERNAME',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'GITLAB_TOKEN',
    'AZURE_DEVOPS_EXT_PAT'
  ])
    delete process.env[n]
}

/* ---- 1. ground truth on this machine --------------------------------- */

console.log('\nreal detection on this machine')
const realWhich = async (bin) => {
  try {
    return execFileSync(process.env.SHELL || '/bin/zsh', ['-lic', `command -v ${bin}`], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}
const real = await mod.detectProviders(realWhich)
for (const s of real) {
  console.log(`  ${s.id.padEnd(10)} ${s.status.padEnd(15)} ${s.account ?? ''} — ${s.detail}`)
}
check('every provider reports a state', real.length === 6, `got ${real.length}`)
check(
  'a real gh/glab check never returns a value in `account`',
  real.every((s) => !s.account || s.account.length < 60)
)

/* ---- 2. the login shell read ----------------------------------------- */

console.log('\nlogin-shell capture')
clearCanaryEnv()
process.env.SHELL = fakeShell
const captured = await mod.refreshProviders(noWhich)
const byId = Object.fromEntries(captured.map((s) => [s.id, s]))

check(
  'a value read past a noisy profile banner',
  byId.linear.status === 'connected',
  `linear was ${byId.linear.status}`
)
check(
  'a value containing a newline stays one value',
  byId.bitbucket.env.find((e) => e.name === 'BITBUCKET_APP_PASSWORD')?.set === true
)
check(
  'a partly-filled credential set is not called connected',
  byId.jira.status === 'needs-auth',
  `jira was ${byId.jira.status}`
)
check(
  'the missing half of that set is named',
  byId.jira.detail.includes('JIRA_EMAIL'),
  byId.jira.detail
)
check(
  'bitbucket, missing its username, is not connected',
  byId.bitbucket.status === 'needs-auth',
  `bitbucket was ${byId.bitbucket.status}`
)

/* ---- 3. the guarantee ------------------------------------------------- */

console.log('\nno credential crosses the bridge')
const wire = JSON.stringify(captured)
for (const canary of ALL_CANARIES) {
  check(`the reply does not contain ${canary.slice(0, 18)}…`, !wire.includes(canary))
}
check(
  'variable names are still reported, so this is not vacuous',
  wire.includes('LINEAR_API_KEY') && wire.includes('JIRA_EMAIL')
)
check(
  'every env entry is a name and a boolean only',
  captured.every((s) =>
    s.env.every(
      (e) =>
        typeof e.name === 'string' &&
        typeof e.set === 'boolean' &&
        Object.keys(e).length === 2
    )
  )
)

/* ---- 4. what panes actually receive ----------------------------------- */

console.log('\npane environment')
const env = mod.sessionEnv()
check('the captured token is handed to panes', env.LINEAR_API_KEY === LINEAR)
check('a multi-line value reaches the pane intact', env.BITBUCKET_APP_PASSWORD === BITBUCKET)

// A token already in our own environment is inherited by the pane anyway;
// re-setting it from a stale capture is how you end up pushing as the wrong user.
process.env.LINEAR_API_KEY = 'live_value_from_the_launching_terminal'
const env2 = mod.sessionEnv()
check('a live value is not overridden by the captured one', env2.LINEAR_API_KEY === undefined)
delete process.env.LINEAR_API_KEY

/* ---- 5. CLI-backed providers ------------------------------------------ */

console.log('\nCLI-backed providers')
clearCanaryEnv()
const missing = await mod.detectProviders(noWhich)
const gh = missing.find((s) => s.id === 'github')
check('github with no gh on PATH reads not-installed', gh.status === 'not-installed', gh.status)
check('and says which binary is missing', gh.detail.includes('gh'), gh.detail)

process.env.GITHUB_TOKEN = 'ghp_CANARY_token_beats_the_cli'
const tokened = await mod.detectProviders(noWhich)
const gh2 = tokened.find((s) => s.id === 'github')
check('a token connects github even with no CLI', gh2.status === 'connected', gh2.status)
check('and the token itself is not in the reply', !JSON.stringify(gh2).includes('ghp_CANARY'))
delete process.env.GITHUB_TOKEN

const signedOut = await mod.detectProviders(yesWhich)
const gl = signedOut.find((s) => s.id === 'gitlab')
check(
  'a present but signed-out CLI reads needs-auth',
  ['needs-auth', 'connected'].includes(gl.status),
  gl.status
)

/* ---- done ------------------------------------------------------------- */

fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
