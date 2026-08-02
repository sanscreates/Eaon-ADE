/**
 * Submits the built artifacts to Apple, waits for the verdict, and staples the
 * ticket onto them.
 *
 * This drives `notarytool` directly rather than using electron-builder's
 * integration. electron-builder always passes `--keychain <file>`, and notarytool
 * on recent macOS keeps `store-credentials` profiles in the data-protection
 * keychain, which that flag skips past — so the integration reports "No Keychain
 * password item found" for a profile that plainly works. Letting notarytool use
 * its own default lookup avoids the whole problem.
 *
 * Credentials never appear here or in the repo; the profile name is a handle to
 * something already in your keychain.
 *
 *   node scripts/notarize-mac.mjs [profile]
 */
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Interactive zsh does not strip `#` comments, and `npm run` shell-escapes
 * whatever follows the script name — so `npm run notarize:mac # do the thing`
 * arrives here as a literal argument. Ignore anything that cannot be a profile
 * name rather than trying to notarise under it.
 */
function profileFromArgs() {
  const arg = process.argv[2]
  if (!arg || arg.startsWith('#') || arg.length < 3) return null
  return arg
}

const PROFILE = profileFromArgs() ?? process.env.APPLE_KEYCHAIN_PROFILE ?? 'eaon'
const DIST = 'dist'

function sh(cmd, args, { quiet = false } = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (!quiet && out.trim()) console.log(out.trim())
    return { ok: true, out }
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    if (!quiet && out) console.error(out)
    return { ok: false, out }
  }
}

if (!existsSync(DIST)) {
  console.error('No dist/. Run `npm run dist:mac` first.')
  process.exit(1)
}

const entries = readdirSync(DIST)
const dmg = entries.find((f) => f.endsWith('.dmg'))
const appDir = entries.find((f) => statSync(join(DIST, f)).isDirectory() && f.startsWith('mac'))
const app = appDir && readdirSync(join(DIST, appDir)).find((f) => f.endsWith('.app'))

if (!dmg || !app) {
  console.error('Expected a .dmg and a .app in dist/. Run `npm run dist:mac` first.')
  process.exit(1)
}

const dmgPath = join(DIST, dmg)
const appPath = join(DIST, appDir, app)

console.log(`Profile:  ${PROFILE}`)
console.log(`Uploading ${dmgPath} — Apple usually answers in a few minutes.\n`)

// The ticket Apple issues is keyed to the code signature, so notarising the
// disk image covers the app inside it; both can then be stapled.
const submit = sh('xcrun', [
  'notarytool',
  'submit',
  dmgPath,
  '--keychain-profile',
  PROFILE,
  '--wait'
])

if (!submit.ok || !/status:\s*Accepted/i.test(submit.out)) {
  console.error('\nNotarisation did not come back Accepted.')
  const id = submit.out.match(/id:\s*([0-9a-f-]{36})/i)?.[1]
  if (id) {
    console.error(`\nWhat Apple objected to (submission ${id}):`)
    sh('xcrun', ['notarytool', 'log', id, '--keychain-profile', PROFILE])
  }
  process.exit(1)
}

console.log('\nAccepted. Stapling…')
// Staple both: the disk image so it passes on download, and the app itself so
// it still passes after being dragged out of the image.
for (const target of [appPath, dmgPath]) {
  const res = sh('xcrun', ['stapler', 'staple', target], { quiet: true })
  console.log(`  ${res.ok ? 'stapled' : 'FAILED '}  ${target}`)
  if (!res.ok) {
    console.error(res.out)
    process.exit(1)
  }
}

// The zip cannot carry a ticket, so rebuild it from the stapled app.
const zip = entries.find((f) => f.endsWith('-mac.zip'))
if (zip) {
  console.log(`\nRepacking ${zip} from the stapled app…`)
  execSync(`cd '${join(DIST, appDir)}' && ditto -c -k --keepParent '${app}' '../${zip}'`, {
    stdio: 'inherit'
  })
}

/*
 * Stapling and repacking both change bytes, and electron-builder wrote
 * latest-mac.yml before either happened. The auto-updater checks the downloaded
 * file against the hash in that manifest and refuses anything that does not
 * match, so it has to be rebuilt from the artifacts as they now stand —
 * otherwise every update fails with a checksum error.
 */
const manifest = join(DIST, 'latest-mac.yml')
if (existsSync(manifest)) {
  console.log('Rewriting latest-mac.yml against the stapled artifacts…')
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const hash = (file) =>
    createHash('sha512').update(readFileSync(file)).digest('base64')

  // Artifact names contain a space; release assets cannot. electron-builder
  // uploads them hyphenated and writes the hyphenated name into the manifest,
  // so the rewritten manifest has to use the same form or every download 404s.
  const assetName = (name) => name.replace(/ /g, '-')

  const listed = [zip, dmg].filter(Boolean)
  const lines = [`version: ${version}`, 'files:']
  for (const name of listed) {
    const full = join(DIST, name)
    lines.push(
      `  - url: ${assetName(name)}`,
      `    sha512: ${hash(full)}`,
      `    size: ${statSync(full).size}`
    )
  }
  // Squirrel.Mac takes the zip, never the disk image.
  const primary = zip ?? dmg
  lines.push(
    `path: ${assetName(primary)}`,
    `sha512: ${hash(join(DIST, primary))}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  )
  writeFileSync(manifest, lines.join('\n'))

  // Block maps describe the pre-staple bytes, so differential download would
  // reconstruct a file that fails its own checksum. Drop them and let the
  // updater fetch whole files.
  for (const stale of readdirSync(DIST).filter((f) => f.endsWith('.blockmap'))) {
    rmSync(join(DIST, stale))
  }
  console.log(`  ${listed.length} artifact(s) hashed, block maps removed`)
}

console.log('\nDone. Verifying…\n')
execSync('node scripts/verify-mac.mjs', { stdio: 'inherit' })
