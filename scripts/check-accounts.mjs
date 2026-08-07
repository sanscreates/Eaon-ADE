/*
 * Checks the account switcher for both agents.
 *
 * Written because the vendor split refactored code that had no tests at all,
 * and the thing it must never do is disturb an account you already had. Every
 * "home" directory below is a throwaway stand-in for `~/.claude` / `~/.codex`,
 * seeded with files and then checked byte-for-byte afterwards — the guarantee
 * is that nothing this feature does writes to, moves or removes them.
 *
 *   node scripts/check-accounts.mjs
 */

import { build } from 'esbuild'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaon-accounts-'))
const fakeHome = path.join(tmp, 'home')
fs.mkdirSync(fakeHome, { recursive: true })

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

/** A JWT with a readable payload and a signature that is never looked at. */
function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.not-a-real-signature`
}

/* ---- stand-in home directories ------------------------------------------ */

const claudeHome = path.join(fakeHome, '.claude')
fs.mkdirSync(claudeHome, { recursive: true })
fs.writeFileSync(
  path.join(claudeHome, '.credentials.json'),
  JSON.stringify({ claudeAiOauth: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } })
)
fs.writeFileSync(
  path.join(fakeHome, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com', accountUuid: 'uuid-1' } })
)

// Shaped like the ChatGPT Desktop directory found on the machine this was
// written on: real, in the way, and nothing to do with the Codex CLI.
const codexHome = path.join(fakeHome, '.codex')
fs.mkdirSync(codexHome, { recursive: true })
fs.writeFileSync(path.join(codexHome, 'config.toml'), '[features]\njs_repl = true\n')
fs.writeFileSync(path.join(codexHome, '.codex-global-state.json'), '{"desktop-first-seen-at-ms":1}')

const homeFingerprint = () => {
  const files = []
  for (const dir of [claudeHome, codexHome]) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (!fs.statSync(full).isFile()) continue
      files.push(`${full}:${crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex')}`)
    }
  }
  return files.sort().join('\n')
}
const before = homeFingerprint()

/* ---- module under test --------------------------------------------------- */

const outfile = path.join(tmp, 'accounts.mjs')
await build({
  entryPoints: [path.join(root, 'src/main/accounts.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
  plugins: [
    {
      name: 'stub-electron',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'e', namespace: 'stub' }))
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: `export const app = { getPath: () => ${JSON.stringify(path.join(tmp, 'userData'))} }`,
          loader: 'js'
        }))
      }
    }
  ]
})

// os.homedir() is what both specs build their home path from, so it is what
// the stand-in directories have to hijack.
const realHome = os.homedir
os.homedir = () => fakeHome
process.env.HOME = fakeHome

const mod = await import(outfile)
const { Accounts, CLAUDE_SPEC, CODEX_SPEC } = mod

try {
  /* ---- 1. Claude, unchanged by the refactor ----------------------------- */

  console.log('\nClaude accounts still behave exactly as before')
  const claude = new Accounts(path.join(tmp, 'userData'), CLAUDE_SPEC)
  let list = claude.list()
  check('the original account is always listed', list.length === 1, list.length)
  check('it is flagged as the default', list[0].isDefault === true)
  check('it is active to begin with', list[0].active === true)
  check('its plan was read', list[0].plan === 'max', list[0].plan)
  check('its tier was read', list[0].tier === 'default_claude_max_20x', list[0].tier)
  check('it is labelled by email, not by plan', list[0].label === 'me@example.com', list[0].label)
  check('it carries its vendor', list[0].vendor === 'claude', list[0].vendor)
  check('the default account contributes no CLAUDE_CONFIG_DIR', claude.activeConfigDir() === null)
  check('the env var is the Claude one', claude.envVar === 'CLAUDE_CONFIG_DIR', claude.envVar)

  const reserved = claude.reserve()
  check('reserving makes a directory under userData, not under home', reserved.configDir.startsWith(path.join(tmp, 'userData')))
  check('and not inside the original account', !reserved.configDir.startsWith(claudeHome))

  // An abandoned sign-in leaves nothing behind.
  list = claude.commit(reserved.id)
  check('committing a directory nothing signed into is refused', list.length === 1, list.length)
  check('and the empty directory is cleaned up', !fs.existsSync(reserved.configDir))

  // A real one sticks.
  const second = claude.reserve()
  fs.writeFileSync(
    path.join(second.configDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { subscriptionType: 'pro', rateLimitTier: 'default_claude_pro' } })
  )
  fs.writeFileSync(
    path.join(second.configDir, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'other@example.com' } })
  )
  list = claude.commit(second.id)
  check('a signed-in directory is kept', list.length === 2, list.length)
  check('the two accounts are told apart by email', list[1].label === 'other@example.com', list[1].label)

  list = claude.setActive(second.id)
  check('switching marks the new one active', list.find((a) => a.id === second.id)?.active === true)
  check('and now a config dir IS handed to shells', claude.activeConfigDir() === second.configDir)

  list = claude.remove(second.id)
  check('removing drops it from the list', list.length === 1, list.length)
  check('and falls back to the original account', claude.activeConfigDir() === null)

  const refusedRemove = claude.remove('default')
  check('the original account cannot be removed', refusedRemove.length === 1)
  check('and its directory is still there', fs.existsSync(path.join(claudeHome, '.credentials.json')))

  /* ---- 2. Codex, the new vendor ----------------------------------------- */

  console.log('\nCodex accounts ride the same mechanism')
  const codex = new Accounts(path.join(tmp, 'userData'), CODEX_SPEC)
  let codexList = codex.list()
  check('its env var is CODEX_HOME, not the Claude one', codex.envVar === 'CODEX_HOME', codex.envVar)
  check('rows carry the codex vendor', codexList[0].vendor === 'codex', codexList[0].vendor)
  // The real find on this machine: ~/.codex belongs to ChatGPT Desktop.
  check(
    'a ~/.codex that is not a Codex CLI home reads as not signed in',
    codexList[0].signedIn === false && codexList[0].plan === '',
    JSON.stringify({ signedIn: codexList[0].signedIn, plan: codexList[0].plan })
  )
  check('and is labelled generically rather than pretending', codexList[0].label === 'Codex account', codexList[0].label)

  // A genuine Codex sign-in.
  const codexAcct = codex.reserve()
  fs.writeFileSync(
    path.join(codexAcct.configDir, 'auth.json'),
    JSON.stringify({
      OPENAI_API_KEY: null,
      tokens: {
        id_token: fakeJwt({
          email: 'dev@example.com',
          name: 'Dev',
          'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' }
        }),
        access_token: 'SECRET_ACCESS_TOKEN_SHOULD_NEVER_BE_READ',
        refresh_token: 'SECRET_REFRESH_TOKEN_SHOULD_NEVER_BE_READ',
        account_id: 'acct-123'
      }
    })
  )
  codexList = codex.commit(codexAcct.id)
  check('a Codex sign-in is kept', codexList.length === 2, codexList.length)
  const signedIn = codexList.find((a) => a.id === codexAcct.id)
  check('the plan comes out of the token payload', signedIn?.plan === 'plus', signedIn?.plan)
  check('the email comes out of the token payload', signedIn?.email === 'dev@example.com', signedIn?.email)
  check('so it is labelled by email', signedIn?.label === 'dev@example.com', signedIn?.label)

  // The whole point of the security note in the source.
  const wire = JSON.stringify(codexList)
  check(
    'no access or refresh token appears anywhere in the account list',
    !wire.includes('SECRET_ACCESS_TOKEN') && !wire.includes('SECRET_REFRESH_TOKEN'),
    wire.slice(0, 160)
  )

  codexList = codex.setActive(codexAcct.id)
  check('switching Codex accounts hands out a CODEX_HOME', codex.activeConfigDir() === codexAcct.configDir)

  // An API-key sign-in has no token at all.
  const apiAcct = codex.reserve()
  fs.writeFileSync(
    path.join(apiAcct.configDir, 'auth.json'),
    JSON.stringify({ OPENAI_API_KEY: 'sk-SECRET_KEY_SHOULD_NEVER_BE_READ' })
  )
  codexList = codex.commit(apiAcct.id)
  const apiRow = codexList.find((a) => a.id === apiAcct.id)
  check('an API-key sign-in counts as signed in', apiRow?.signedIn === true)
  check('and is described as api rather than a plan it does not have', apiRow?.plan === 'api', apiRow?.plan)
  check(
    'the API key itself never reaches the list',
    !JSON.stringify(codexList).includes('SECRET_KEY_SHOULD_NEVER_BE_READ')
  )

  /* ---- 3. the two vendors do not collide -------------------------------- */

  console.log('\nthe two vendors keep separate books')
  check(
    'they use different index files',
    fs.existsSync(path.join(tmp, 'userData', 'accounts.json')) &&
      fs.existsSync(path.join(tmp, 'userData', 'codex-accounts.json'))
  )
  check(
    'switching Codex did not change which Claude account is active',
    new Accounts(path.join(tmp, 'userData'), CLAUDE_SPEC).activeConfigDir() === null
  )
  check(
    'and Claude still lists only its own accounts',
    new Accounts(path.join(tmp, 'userData'), CLAUDE_SPEC).list().length === 1
  )

  /* ---- 4. the guarantee -------------------------------------------------- */

  console.log('\nnothing touched the accounts that were already on the machine')
  check('every file in both home directories is byte-for-byte unchanged', homeFingerprint() === before)
  check('the ChatGPT Desktop config is still there', fs.existsSync(path.join(codexHome, 'config.toml')))
  check(
    'no account directory was created inside either home',
    fs.readdirSync(claudeHome).length === 1 && fs.readdirSync(codexHome).length === 2,
    `${fs.readdirSync(claudeHome).join(',')} | ${fs.readdirSync(codexHome).join(',')}`
  )
} finally {
  os.homedir = realHome
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
