/**
 * Publishes the built artifacts as a GitHub release, then checks that the
 * result is actually usable by the auto-updater.
 *
 * The trap this exists to avoid: artifact filenames contain a space, and GitHub
 * rewrites spaces in asset names to dots — `Eaon ADE-1.0.0…` becomes
 * `Eaon.ADE-1.0.0…`. But `latest-mac.yml` refers to the hyphenated form, so a
 * hand-uploaded release resolves its manifest fine and then 404s on the download.
 * Uploading files that are already hyphenated leaves nothing for GitHub to
 * rewrite.
 *
 *   node scripts/publish-release.mjs [--draft]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DIST = 'dist'
const draft = process.argv.includes('--draft')

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = pkg.version
const tag = `v${version}`

const cfg = readFileSync('electron-builder.yml', 'utf8')
const owner = cfg.match(/^\s*owner:\s*(\S+)/m)?.[1]
const repo = cfg.match(/^\s*repo:\s*(\S+)/m)?.[1]
if (!owner || !repo) {
  console.error('No publish owner/repo in electron-builder.yml')
  process.exit(1)
}
const slug = `${owner}/${repo}`

function sh(cmd, args, { capture = false } = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  })
}

const manifest = join(DIST, 'latest-mac.yml')
if (!existsSync(manifest)) {
  console.error('No dist/latest-mac.yml. Run `npm run dist:mac:release` first.')
  process.exit(1)
}

const manifestText = readFileSync(manifest, 'utf8')
if (!manifestText.includes(`version: ${version}`)) {
  console.error(`dist/latest-mac.yml is not for ${version}. Rebuild before publishing.`)
  process.exit(1)
}

// Stage copies whose names already match what the manifest asks for.
const staging = join(tmpdir(), `eaon-release-${version}`)
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

// This version only. dist/ holds every build ever made here, and uploading a
// previous release's dmg alongside this one would attach files to the tag that
// the manifest never mentions — and that nobody could tell apart by name.
const thisVersion = (f) => f.includes(`-${version}-`) || f.includes(`-${version}.`)
const artifacts = readdirSync(DIST).filter(
  (f) => (f.endsWith('.dmg') || f.endsWith('-mac.zip')) && thisVersion(f)
)
if (!artifacts.length) {
  console.error(`No artifacts for ${version} in dist/. Run \`npm run dist:mac:release\` first.`)
  process.exit(1)
}
const uploads = [manifest]
for (const name of artifacts) {
  const target = join(staging, name.replace(/ /g, '-'))
  copyFileSync(join(DIST, name), target)
  uploads.push(target)
}

console.log(`Publishing ${tag} to ${slug}${draft ? ' (draft)' : ''}`)
for (const u of uploads) console.log(`  ${u.split('/').pop()}`)

const exists = (() => {
  try {
    sh('gh', ['release', 'view', tag, '--repo', slug], { capture: true })
    return true
  } catch {
    return false
  }
})()

if (exists) {
  console.log('\nRelease exists — replacing its assets.')
  sh('gh', ['release', 'upload', tag, '--repo', slug, '--clobber', ...uploads])
} else {
  sh('gh', [
    'release',
    'create',
    tag,
    '--repo',
    slug,
    '--title',
    `Eaon ADE ${version}`,
    '--generate-notes',
    ...(draft ? ['--draft'] : []),
    ...uploads
  ])
}

if (draft) {
  console.log('\nDraft created. Assets are not reachable until it is published.')
  process.exit(0)
}

// Prove the published release is what the updater needs, rather than assuming.
console.log('\nVerifying the published release…')
const base = `https://github.com/${owner}/${repo}/releases/download/${tag}`
const wantHash = manifestText.match(/^sha512: (.+)$/m)[1]
const zipName = manifestText.match(/^path: (.+)$/m)[1]

const live = await fetch(`${base}/latest-mac.yml`)
console.log(`  latest-mac.yml   HTTP ${live.status}`)

const zip = await fetch(`${base}/${zipName}`)
console.log(`  ${zipName}   HTTP ${zip.status}`)
if (!zip.ok) {
  console.error('\nThe update asset is not reachable under the name the manifest uses.')
  process.exit(1)
}

const got = createHash('sha512').update(Buffer.from(await zip.arrayBuffer())).digest('base64')
if (got !== wantHash) {
  console.error('\nPublished file does not match the manifest hash — updates would be rejected.')
  process.exit(1)
}
console.log('  checksum         matches')
console.log(`\nReleased: https://github.com/${owner}/${repo}/releases/tag/${tag}`)
