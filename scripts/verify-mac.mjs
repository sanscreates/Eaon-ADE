/**
 * Checks a built .app the way Gatekeeper will.
 *
 * electron-builder reporting success only means it ran `codesign` without an
 * error. This re-reads the result: that the signature is valid and sealed, that
 * it is the Developer ID identity and not a development one, that the hardened
 * runtime and entitlements actually landed, that every native binary inside got
 * signed too, and whether Apple has notarised it yet.
 *
 *   node scripts/verify-mac.mjs [path/to/App.app]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'

/** dist/ holds the .app inside a mac-<arch> folder, alongside .dmg and .zip. */
function findApp() {
  const explicit = process.argv[2]
  if (explicit) return explicit
  if (!existsSync(DIST)) return null
  for (const entry of readdirSync(DIST)) {
    const full = join(DIST, entry)
    if (entry.endsWith('.app')) return full
    if (!statSync(full).isDirectory()) continue
    const app = readdirSync(full).find((f) => f.endsWith('.app'))
    if (app) return join(full, app)
  }
  return null
}

/**
 * codesign and spctl report almost everything on stderr, so both streams are
 * merged. Reading only stdout is why a correctly signed app can look unsigned.
 */
function run(cmd, args) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { ok: true, out }
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() }
  }
}

/** Same, but keeps stderr even when the command succeeds. */
function runMerged(cmd, args) {
  const res = run(cmd, args)
  if (res.ok && !res.out.trim()) {
    try {
      const merged = execFileSync(`${cmd} ${args.map((a) => `'${a}'`).join(' ')} 2>&1`, {
        encoding: 'utf8',
        shell: '/bin/sh'
      })
      return { ok: true, out: merged }
    } catch (err) {
      return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() }
    }
  }
  return res
}

const app = findApp()
if (!app || !existsSync(app)) {
  console.error('No .app found in dist/. Run `npm run dist:mac` first.')
  process.exit(1)
}

console.log(`Checking ${app}\n`)
const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (detail) console.log(`      ${detail.split('\n').join('\n      ')}`)
}

// 1. Signature valid and nothing tampered with since signing.
const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
check('signature valid and sealed', verify.ok, verify.ok ? undefined : verify.out.slice(0, 400))

// 2. Signed by Developer ID, not a development certificate.
const info = runMerged('codesign', ['-dvvv', app])
const authority = (info.out.match(/Authority=(.+)/g) ?? []).map((l) => l.replace('Authority=', ''))
const teamId = info.out.match(/TeamIdentifier=(\S+)/)?.[1] ?? 'none'
const isDeveloperId = authority.some((a) => a.startsWith('Developer ID Application'))
check(
  'signed with a Developer ID certificate',
  isDeveloperId,
  `authority: ${authority[0] ?? 'unsigned'} · team: ${teamId}`
)

// 3. Hardened runtime — Apple refuses to notarise without it.
const flags = info.out.match(/CodeDirectory .*flags=([^ ]+)/)?.[1] ?? ''
check('hardened runtime enabled', flags.includes('runtime'), `flags: ${flags || 'none'}`)

// 4. The entitlements we asked for are the ones on the binary.
const ents = runMerged('codesign', ['-d', '--entitlements', ':-', app])
const NEEDED = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.device.audio-input'
]
const missing = NEEDED.filter((e) => !ents.out.includes(e))
check('entitlements present', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : undefined)

// 5. Native modules. An unsigned .node or .dylib inside the bundle is the most
//    common reason notarisation comes back rejected.
const natives = run('find', [app, '-name', '*.node', '-o', '-name', '*.dylib'])
  .out.split('\n')
  .filter(Boolean)
const unsigned = natives.filter((f) => !run('codesign', ['--verify', '--strict', f]).ok)
check(
  `native binaries signed (${natives.length} found)`,
  natives.length > 0 && unsigned.length === 0,
  unsigned.length ? `unsigned:\n${unsigned.join('\n')}` : natives.map((n) => n.split('/').pop()).join(', ')
)

// 6. Microphone purpose string — dictation silently fails without it.
const plist = join(app, 'Contents', 'Info.plist')
const mic = run('plutil', ['-extract', 'NSMicrophoneUsageDescription', 'raw', '-o', '-', plist])
check('microphone usage description', mic.ok, mic.ok ? mic.out.trim().slice(0, 80) + '…' : 'absent')

// 7. Gatekeeper. Expected to fail until the build has been notarised and
//    stapled, so it is reported separately rather than as a hard failure.
const spctl = runMerged('spctl', ['-a', '-vvv', '-t', 'exec', app])
const notarized = spctl.out.includes('source=Notarized Developer ID')
console.log(
  `\n${notarized ? 'PASS' : '····'}  notarised and stapled${notarized ? '' : '  (not yet — see below)'}`
)
console.log(`      ${spctl.out.trim().split('\n').join('\n      ')}`)

const failed = results.filter((r) => !r.pass)
console.log(
  `\n${results.length - failed.length}/${results.length} signing checks passed` +
    (notarized ? ', notarised.' : '. Not notarised yet.')
)
if (!notarized && !failed.length) {
  console.log('\nReady to notarise:  npm run dist:mac:release')
}
process.exit(failed.length ? 1 : 0)
