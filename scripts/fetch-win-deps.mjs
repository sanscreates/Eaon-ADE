/**
 * Fetches the Windows-only native packages a cross-build needs.
 *
 * Two of the three native dependencies already ship every platform's binaries
 * in one package — node-pty carries prebuilds for win32-x64 and win32-arm64,
 * and onnxruntime-node carries a win32 folder — so a macOS checkout can package
 * a Windows build of those without help.
 *
 * sharp is the exception. It splits per platform and npm installs only the one
 * matching the machine doing the install, refusing the others even when asked
 * for them by name. That would be harmless if sharp were optional at runtime,
 * but @huggingface/transformers imports it at the top of a module the speech
 * engine loads, so a Windows build without it does not fail at the point sharp
 * is used — it fails the moment dictation starts, with an error about a module
 * that nothing in this app calls directly.
 *
 * Building on Windows itself needs none of this. It is only for cross-building.
 *
 *   node scripts/fetch-win-deps.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const MODULES = join(ROOT, 'node_modules')

if (!existsSync(MODULES)) {
  console.error('No node_modules. Run `npm install` first.')
  process.exit(1)
}

function version(pkg) {
  try {
    return JSON.parse(readFileSync(join(MODULES, pkg, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

const sharpVersion = version('sharp')
if (!sharpVersion) {
  console.error('sharp is not installed, so there is nothing to match a version against.')
  process.exit(1)
}

const wanted = [`@img/sharp-win32-x64`, `@img/sharp-win32-arm64`]
let fetched = 0

for (const pkg of wanted) {
  const target = join(MODULES, pkg)
  const have = version(pkg)
  if (have === sharpVersion) {
    console.log(`ok       ${pkg}@${have}`)
    continue
  }
  if (have) {
    console.log(`replace  ${pkg}@${have} → ${sharpVersion}`)
    rmSync(target, { recursive: true, force: true })
  }

  const stage = mkdtempSync(join(tmpdir(), 'eaon-win-dep-'))
  try {
    // npm refuses to *install* a package for another platform, even when told
    // which one. Downloading the tarball and unpacking it is the same bytes
    // without the check, and is what the published package would have been.
    const tarball = execFileSync('npm', ['pack', `${pkg}@${sharpVersion}`, '--silent'], {
      cwd: stage,
      encoding: 'utf8'
    })
      .trim()
      .split('\n')
      .pop()

    mkdirSync(target, { recursive: true })
    execFileSync('tar', ['-xzf', join(stage, tarball), '--strip-components=1', '-C', target])
    console.log(`fetched  ${pkg}@${sharpVersion}`)
    fetched += 1
  } catch (err) {
    console.error(`failed   ${pkg}: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

console.log(
  fetched
    ? `\n${fetched} package(s) fetched. A Windows build can now be packaged from here.`
    : '\nNothing to do — the Windows binaries are already in place.'
)
