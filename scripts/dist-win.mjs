/**
 * Packages the Windows builds, and only the ones this machine can package
 * correctly.
 *
 * Cross-building from macOS or Linux works for x64 and arm64 because node-pty
 * publishes prebuilt binaries for both: nothing has to be compiled, the right
 * one is simply copied in. It publishes none for ia32, so on a 32-bit build the
 * only pty binary in the package is whatever `build/Release` holds — which on
 * this machine is a Mach-O built for macOS.
 *
 * That failure is quiet in every way that matters. The installer builds, it
 * installs, the window opens, and then no pane can start because node-pty
 * checks build/Release, build/Debug and prebuilds/win32-ia32 and finds nothing
 * it can load. Shipping a terminal that cannot open a terminal is worse than
 * shipping one architecture fewer, so ia32 is left to a Windows runner, where
 * it is compiled against this Electron version and works.
 *
 *   npm run dist:win
 */
import { execFileSync } from 'node:child_process'

const WINDOWS = process.platform === 'win32'

/** Architectures node-pty ships a Windows prebuild for. */
const CROSS_BUILDABLE = ['x64', 'arm64']
const ALL = ['x64', 'ia32', 'arm64']

const wanted = WINDOWS ? ALL : CROSS_BUILDABLE
const skipped = ALL.filter((a) => !wanted.includes(a))

console.log(`Packaging for Windows: ${wanted.join(', ')}`)
if (skipped.length) {
  console.log(
    `\nSkipping ${skipped.join(', ')} on ${process.platform}.\n` +
      `node-pty publishes no Windows prebuild for ${skipped.join('/')}, and node-gyp cannot\n` +
      `compile one for another platform, so a build made here would install and\n` +
      `then fail to open a single pane. Build it on Windows — the workflow in\n` +
      `.github/workflows/windows.yml does, and tests the result.\n`
  )
}

const args = ['electron-builder', '--win', ...wanted.map((a) => `--${a}`)]

// Nothing is rebuilt when cross-building: node-gyp cannot target another
// platform, and the prebuilt binaries are N-API, so they do not need it.
if (!WINDOWS) args.push('-c.npmRebuild=false')

try {
  execFileSync('npx', args, { stdio: 'inherit' })
} catch {
  process.exit(1)
}
