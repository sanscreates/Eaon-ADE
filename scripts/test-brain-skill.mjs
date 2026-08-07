/* Eaon Brain skill — installer and content tests.
   Run: node scripts/test-brain-skill.mjs

   Bundles the installer with esbuild (it depends on nothing but node:fs and
   node:path, so this works outside Electron) and drives it against throwaway
   folders. Also checks the skill text against the MCP server, because the two
   drift silently otherwise: renaming a tool without updating the skill leaves
   agents being told to call something that no longer exists. */

import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = process.env.EAON_TEST_DIR || os.tmpdir()

let passed = 0
const failures = []
let group = ''

const describe = (name) => {
  group = name
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}
const ok = (label, cond, detail) => {
  if (cond) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  } else {
    failures.push(`${group} › ${label}${detail ? `\n      ${detail}` : ''}`)
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? `\n      ${String(detail).slice(0, 300)}` : ''}`)
  }
}
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  ok(label, a === e, a === e ? '' : `expected ${e}\n      got      ${a}`)
}

/* ── load the installer ─────────────────────────────────────────────────── */

const bundle = path.join(SCRATCH, `eaon-skill-${process.pid}.mjs`)
await build({
  entryPoints: [path.join(ROOT, 'src/main/brain/skill.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent'
})
const skill = await import(pathToFileURL(bundle).href)

const claudeMdBundle = path.join(SCRATCH, `eaon-claudemd-${process.pid}.mjs`)
await build({
  entryPoints: [path.join(ROOT, 'src/main/brain/claude-md.ts')],
  outfile: claudeMdBundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent'
})
const claudeMd = await import(pathToFileURL(claudeMdBundle).href)

const dirs = []
const tempProject = (tag) => {
  const dir = fs.mkdtempSync(path.join(SCRATCH, `eaon-skill-${tag}-`))
  dirs.push(dir)
  return dir
}

const SKILL_REL = path.join('.claude', 'skills', 'eaon-brain', 'SKILL.md')

/* ═══ 1. installing ═══════════════════════════════════════════════════════ */

describe('1. installing into a workspace')

const p1 = tempProject('install')
const first = skill.installSkill(p1)
ok('reports success', first.ok, JSON.stringify(first))
ok('reports that it wrote', first.wrote)
ok('the file is where Claude Code looks', first.path.endsWith(SKILL_REL), first.path)
ok('the file exists', fs.existsSync(first.path))
ok('isSkillInstalled agrees', skill.isSkillInstalled(p1))

const text = fs.readFileSync(first.path, 'utf8')
ok('starts with YAML frontmatter', text.startsWith('---\n'))

const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
ok('frontmatter closes', !!fm)
const front = fm ? fm[1] : ''
ok('declares the skill name', /^name:\s*eaon-brain\s*$/m.test(front), front.slice(0, 200))
ok('has a description', /^description:/m.test(front))

// The description is the only thing in Claude's context until the skill fires,
// so it is what decides whether it ever does.
const description = (() => {
  const m = /description:\s*>-\n([\s\S]*?)(?=\n[a-z-]+:|$)/.exec(front) ?? /description:\s*(.*)/.exec(front)
  return (m ? m[1] : '').replace(/\s+/g, ' ').trim()
})()
ok('the description is substantial', description.length > 200, `${description.length} chars`)
ok('it names the server', /eaon-brain/.test(description))
ok('it says when to search', /before/i.test(description))
ok('it says when to record', /record|remember/i.test(description))

/* ═══ 2. idempotence and upgrades ═════════════════════════════════════════ */

describe('2. re-running, upgrading, and hand edits')

const second = skill.installSkill(p1)
ok('a second install writes nothing', second.ok && second.wrote === false)
eq('and the file is untouched', fs.readFileSync(first.path, 'utf8'), text)

// An older copy from a previous app version must be replaced.
fs.writeFileSync(first.path, '---\nname: eaon-brain\n---\nold\n<!-- eaon-brain-skill v0 -->\n')
const upgraded = skill.installSkill(p1)
ok('an older version is upgraded', upgraded.wrote)
ok('to the current text', fs.readFileSync(first.path, 'utf8') === text)

// Someone tuning the instructions by hand should not lose that work.
fs.writeFileSync(first.path, '---\nname: eaon-brain\ndescription: mine\n---\nMy own wording.\n')
const custom = skill.installSkill(p1)
ok('a hand-edited copy is left alone', custom.wrote === false && custom.keptCustom === true)
ok('their text survives', fs.readFileSync(first.path, 'utf8').includes('My own wording'))

/* ═══ 3. removal ══════════════════════════════════════════════════════════ */

describe('3. removal')

const p2 = tempProject('remove')
skill.installSkill(p2)
ok('installed', skill.isSkillInstalled(p2))
ok('remove reports success', skill.removeSkill(p2))
ok('the skill is gone', !skill.isSkillInstalled(p2))
ok('empty scaffolding is cleaned up', !fs.existsSync(path.join(p2, '.claude')))
ok('removing twice is fine', skill.removeSkill(p2))

// A .claude/ folder holding the user's own settings must survive.
const p3 = tempProject('coexist')
fs.mkdirSync(path.join(p3, '.claude'), { recursive: true })
fs.writeFileSync(path.join(p3, '.claude', 'settings.json'), '{"permissions":{}}')
skill.installSkill(p3)
skill.removeSkill(p3)
ok('an unrelated .claude/settings.json survives removal', fs.existsSync(path.join(p3, '.claude', 'settings.json')))

// So must somebody else's skill.
const p4 = tempProject('other-skill')
fs.mkdirSync(path.join(p4, '.claude', 'skills', 'their-skill'), { recursive: true })
fs.writeFileSync(path.join(p4, '.claude', 'skills', 'their-skill', 'SKILL.md'), '---\nname: their-skill\n---\n')
skill.installSkill(p4)
ok('ours installs alongside theirs', skill.isSkillInstalled(p4))
skill.removeSkill(p4)
ok('theirs survives our removal', fs.existsSync(path.join(p4, '.claude', 'skills', 'their-skill', 'SKILL.md')))

/* ═══ 4. failure handling ═════════════════════════════════════════════════ */

describe('4. hostile conditions')

const p5 = tempProject('readonly')
fs.mkdirSync(path.join(p5, '.claude'), { recursive: true })
fs.chmodSync(path.join(p5, '.claude'), 0o500)
const denied = skill.installSkill(p5)
ok('an unwritable folder fails cleanly', denied.ok === false && typeof denied.error === 'string', JSON.stringify(denied))
ok('and does not throw', true)
fs.chmodSync(path.join(p5, '.claude'), 0o700)

// Unique per run: an earlier run that created this path would otherwise make
// the next run pass for the wrong reason.
const ghost = path.join(SCRATCH, `eaon-ghost-${process.pid}-${Date.now()}`)
const missing = skill.installSkill(ghost)
ok('a missing folder fails cleanly', missing.ok === false, JSON.stringify(missing))
ok('and nothing was created there', !fs.existsSync(ghost))
ok('isSkillInstalled on nothing is false', skill.isSkillInstalled(ghost) === false)

// A file where the workspace should be is not a workspace.
const notADir = path.join(SCRATCH, `eaon-file-${process.pid}`)
fs.writeFileSync(notADir, 'x')
ok('a file in place of a folder is refused', skill.installSkill(notADir).ok === false)
fs.rmSync(notADir, { force: true })

/* ═══ 5. provisioning guards ══════════════════════════════════════════════ */

describe('5. provisioning refuses the wrong folders')

// register.ts pulls in electron for the packaged-path lookup, which cannot load
// outside Electron — stub it, since none of it runs on the paths under test.
const electronStub = path.join(SCRATCH, `eaon-electron-stub-${process.pid}.js`)
fs.writeFileSync(
  electronStub,
  'export const app = { isPackaged: false, getAppPath: () => "/tmp/app" }\n'
)
const regBundle = path.join(SCRATCH, `eaon-register-${process.pid}.mjs`)
await build({
  entryPoints: [path.join(ROOT, 'src/main/brain/register.ts')],
  outfile: regBundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  alias: { electron: electronStub },
  logLevel: 'silent'
})
const register = await import(pathToFileURL(regBundle).href)

// `.claude/skills/` in the home directory is the *personal* skill folder, so
// provisioning there would silently apply this repo's skill to every project
// on the machine. A pane opened in ~ is a scratch shell, not a workspace.
eq('the home directory is refused', register.provisionWorkspace(os.homedir()), null)
eq('the filesystem root is refused', register.provisionWorkspace(path.parse(process.cwd()).root), null)
eq('an empty path is refused', register.provisionWorkspace(''), null)
eq('a missing folder is refused', register.provisionWorkspace(path.join(SCRATCH, `gone-${process.pid}`)), null)

const p6 = tempProject('provision')
const provisioned = register.provisionWorkspace(p6)
ok('a real workspace is provisioned', provisioned !== null)
ok('the MCP entry is written', provisioned?.mcp?.ok && fs.existsSync(path.join(p6, '.mcp.json')))
ok('the skill is written', provisioned?.skill?.ok && fs.existsSync(path.join(p6, SKILL_REL)))
ok('the CLAUDE.md pointer is written', provisioned?.claudeMd?.ok && provisioned.claudeMd.wrote)
ok('CLAUDE.md exists on disk', fs.existsSync(path.join(p6, 'CLAUDE.md')))
ok('isProvisioned agrees', register.isProvisioned(p6))
ok('running it again changes nothing', (() => {
  const again = register.provisionWorkspace(p6)
  return again.mcp.wrote === false && again.skill.wrote === false && again.claudeMd.wrote === false
})())

// isProvisioned must not depend on the CLAUDE.md pointer specifically — that
// one is skipped or removed on purpose in legitimate cases (see group 8), and
// none of those should make an otherwise working workspace read as broken.
// registerWorkspace + installSkill directly, bypassing installClaudeMdPointer
// entirely, is what "the pointer was never even attempted" looks like.
const p6b = tempProject('provision-no-claudemd')
register.registerWorkspace(p6b)
skill.installSkill(p6b)
ok('isProvisioned ignores a missing CLAUDE.md', register.isProvisioned(p6b))

register.deprovisionWorkspace(p6)
ok('deprovision removes the MCP entry and skill', !register.isProvisioned(p6) && !fs.existsSync(path.join(p6, SKILL_REL)))
ok('deprovision removes the CLAUDE.md pointer too', !fs.existsSync(path.join(p6, 'CLAUDE.md')))

fs.rmSync(electronStub, { force: true })
fs.rmSync(regBundle, { force: true })

/* ═══ 6. the skill must match the server ══════════════════════════════════ */

describe('6. skill text agrees with the MCP server')

const serverSrc = fs.readFileSync(path.join(ROOT, 'src/main/brain/mcp-server.ts'), 'utf8')
const serverTools = [...serverSrc.matchAll(/name:\s*'(brain_[a-z_]+)'/g)].map((m) => m[1])
const uniqueTools = [...new Set(serverTools)]
ok('the server defines tools', uniqueTools.length >= 6, uniqueTools.join(', '))

const mentioned = [...new Set([...text.matchAll(/\bbrain_[a-z_]+/g)].map((m) => m[0]))]
const unknown = mentioned.filter((t) => !uniqueTools.includes(t))
eq('every tool the skill names really exists', unknown, [])

const unmentioned = uniqueTools.filter((t) => !mentioned.includes(t))
eq('every tool the server offers is taught', unmentioned, [])

// The brain folder name appears in the skill; if it ever moves, this catches it.
const sharedSrc = fs.readFileSync(path.join(ROOT, 'src/shared/brain.ts'), 'utf8')
const brainDir = /BRAIN_DIR\s*=\s*'([^']+)'/.exec(sharedSrc)?.[1]
ok('the skill names the real brain folder', !!brainDir && text.includes(brainDir), `BRAIN_DIR=${brainDir}`)

/* ═══ 7. content quality ══════════════════════════════════════════════════ */

describe('7. the instructions cover what they promise')

const body = text.slice(fm ? fm[0].length : 0)
const covers = (label, re) => ok(label, re.test(body), 'not found in the skill body')

covers('explains building context first', /brain_list/)
covers('says to search before reading source', /search.{0,60}before|before.{0,60}(grep|explor|read)/i)
covers('says what is worth recording', /Worth recording|worth keeping/i)
covers('says what is NOT worth recording', /Not worth recording|not a log/i)
covers('teaches titling', /Title it|title/i)
covers('teaches tagging', /tag/i)
covers('teaches linking', /\[\[.*\]\]/)
covers('warns about secrets', /secret|token/i)
covers('mentions that writing the same title updates', /updates? (that )?note|rather than creating a second/i)
covers('gives a worked example', /worked example/i)

// The whole reason this turn touched the skill: recording must read as an
// unconditional, every-session obligation, not a nice-to-have for hard tasks.
ok('description names "upload" as a synonym for recording', /upload/i.test(description))
ok('description frames it as every session, not just hard ones', /every session.{0,40}hard/i.test(description))
covers('body repeats that framing, not just the frontmatter', /every time.{0,80}(hard|routine)|every session.{0,80}(hard|routine)/i)
covers('pushes back against staying silent on borderline learnings', /default to silence|upload it anyway/i)
covers('closes with an explicit reminder to upload before finishing', /Before you hand back/i)
covers('the closing reminder names the tool, not just the idea', /upload it with `brain_write`/)

ok('is a reasonable length', body.split('\n').length < 500, `${body.split('\n').length} lines`)
ok('has no unresolved template markers', !/\$\{/.test(body), 'template literal leaked into the output')
ok('the version marker is last', /<!-- eaon-brain-skill v\d+ -->\s*$/.test(text))

/* ═══ 8. the CLAUDE.md pointer ═══════════════════════════════════════════ */

describe('8. CLAUDE.md pointer')

const c1 = tempProject('claudemd-fresh')
const fresh = claudeMd.installClaudeMdPointer(c1)
ok('reports success', fresh.ok, JSON.stringify(fresh))
ok('reports that it wrote', fresh.wrote)
ok('CLAUDE.md is created', fs.existsSync(fresh.path))
ok('hasClaudeMdPointer agrees', claudeMd.hasClaudeMdPointer(c1))

const freshText = fs.readFileSync(fresh.path, 'utf8')
ok('names the brain folder', freshText.includes('.eaonbrain'))
ok('names the MCP tools', freshText.includes('brain_search') && freshText.includes('brain_write'))
ok('points at the skill for the how-to', freshText.includes('eaon-brain` skill'))
ok('tells every session to upload before finishing, not just hard ones', /upload.{0,150}every session.{0,60}hard/is.test(freshText))
ok('is short — a pointer, not the instructions', freshText.split('\n').length < 20, `${freshText.split('\n').length} lines`)
ok('carries a version marker', /<!-- eaon-brain:start v\d+ -->/.test(freshText))

const again1 = claudeMd.installClaudeMdPointer(c1)
ok('a second install writes nothing', again1.ok && again1.wrote === false)
eq('and the file is byte-for-byte the same', fs.readFileSync(fresh.path, 'utf8'), freshText)

describe('8. CLAUDE.md pointer — coexisting with the user’s own content')

const c2 = tempProject('claudemd-existing')
fs.writeFileSync(path.join(c2, 'CLAUDE.md'), '# My project\n\nAlways use tabs, never spaces.\n')
const appended = claudeMd.installClaudeMdPointer(c2)
ok('appends rather than replacing', appended.wrote)
const appendedText = fs.readFileSync(appended.path, 'utf8')
ok('the user’s own content survives, verbatim', appendedText.includes('Always use tabs, never spaces.'))
ok('our block is appended after it', appendedText.indexOf('My project') < appendedText.indexOf('eaon-brain:start'))

describe('8. CLAUDE.md pointer — upgrading a stale version')

const c3 = tempProject('claudemd-stale')
fs.writeFileSync(
  path.join(c3, 'CLAUDE.md'),
  '# Notes\n\nSome context above.\n\n<!-- eaon-brain:start v0 -->\nOld, out of date wording.\n<!-- eaon-brain:end -->\n\nSome context below.\n'
)
const mdUpgraded = claudeMd.installClaudeMdPointer(c3)
ok('an older version is upgraded', mdUpgraded.wrote)
const upgradedText = fs.readFileSync(mdUpgraded.path, 'utf8')
ok('the old wording is gone', !upgradedText.includes('Old, out of date wording'))
ok('current wording is in', upgradedText.includes('.eaonbrain'))
ok('content before the block survives untouched', upgradedText.includes('Some context above.'))
ok('content after the block survives untouched', upgradedText.includes('Some context below.'))

describe('8. CLAUDE.md pointer — respecting the user')

const c4 = tempProject('claudemd-covered')
fs.writeFileSync(
  path.join(c4, 'CLAUDE.md'),
  '# Notes\n\nThis project uses the eaon-brain memory system — search .eaonbrain/ before diving in.\n'
)
const covered = claudeMd.installClaudeMdPointer(c4)
ok('already-covered content is left alone', covered.ok && covered.wrote === false && covered.alreadyCovered === true)
eq('the file is untouched, verbatim', fs.readFileSync(path.join(c4, 'CLAUDE.md'), 'utf8'), '# Notes\n\nThis project uses the eaon-brain memory system — search .eaonbrain/ before diving in.\n')
ok('and stays untouched on every later call too', (() => {
  const again = claudeMd.installClaudeMdPointer(c4)
  return again.wrote === false
})())

const c5 = tempProject('claudemd-removed')
claudeMd.installClaudeMdPointer(c5)
ok('installed the first time', claudeMd.hasClaudeMdPointer(c5))
fs.rmSync(path.join(c5, 'CLAUDE.md'))
const afterDeletion = claudeMd.installClaudeMdPointer(c5)
ok('deleting the whole file is respected, not undone', afterDeletion.wrote === false && afterDeletion.respectedRemoval === true)
ok('the file stays gone', !fs.existsSync(path.join(c5, 'CLAUDE.md')))

const c6 = tempProject('claudemd-block-removed')
claudeMd.installClaudeMdPointer(c6)
// Simulate the user deleting just our block by hand, keeping the rest of the file.
fs.writeFileSync(path.join(c6, 'CLAUDE.md'), '# Notes\n\nKept this, removed the eaon-brain block by hand.\n')
const afterBlockRemoval = claudeMd.installClaudeMdPointer(c6)
ok('deleting only our block is respected too', afterBlockRemoval.wrote === false && afterBlockRemoval.respectedRemoval === true)
eq(
  'their remaining text is untouched',
  fs.readFileSync(path.join(c6, 'CLAUDE.md'), 'utf8'),
  '# Notes\n\nKept this, removed the eaon-brain block by hand.\n'
)

describe('8. CLAUDE.md pointer — removal')

const c7 = tempProject('claudemd-remove-created')
claudeMd.installClaudeMdPointer(c7)
ok('removal reports success', claudeMd.removeClaudeMdPointer(c7))
ok('a file we created outright is deleted entirely, not left empty', !fs.existsSync(path.join(c7, 'CLAUDE.md')))
ok('removing twice is fine', claudeMd.removeClaudeMdPointer(c7))

const c8 = tempProject('claudemd-remove-preserves')
fs.writeFileSync(path.join(c8, 'CLAUDE.md'), '# Their project\n\nImportant context.\n')
claudeMd.installClaudeMdPointer(c8)
claudeMd.removeClaudeMdPointer(c8)
const afterRemove = fs.readFileSync(path.join(c8, 'CLAUDE.md'), 'utf8')
ok('a file with other content survives removal', fs.existsSync(path.join(c8, 'CLAUDE.md')))
ok('our block is gone', !afterRemove.includes('eaon-brain:start'))
ok('their content is still there', afterRemove.includes('Important context.'))

describe('8. CLAUDE.md pointer — hostile conditions')

const ghostMd = path.join(SCRATCH, `eaon-md-ghost-${process.pid}-${Date.now()}`)
const missingMd = claudeMd.installClaudeMdPointer(ghostMd)
ok('a missing folder fails cleanly', missingMd.ok === false, JSON.stringify(missingMd))
ok('nothing was created there', !fs.existsSync(ghostMd))

const c9 = tempProject('claudemd-readonly')
fs.chmodSync(c9, 0o500)
const denied2 = claudeMd.installClaudeMdPointer(c9)
ok('an unwritable folder fails cleanly, not throws', denied2.ok === false)
fs.chmodSync(c9, 0o700)

/* ── report ─────────────────────────────────────────────────────────────── */

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
fs.rmSync(bundle, { force: true })
fs.rmSync(claudeMdBundle, { force: true })

/* ═══ 9. brain_write rejects a malformed call instead of saving nothing ═══
   Found live: a model called brain_write with {title, body, tags} — "body"
   instead of the schema's "content" — and the old handler silently wrote a
   note with an empty body. `String(undefined ?? '')` swallowed the mistake
   completely: the call "succeeded", a file appeared at the expected path, and
   nothing signalled that the one thing worth keeping never made it to disk.
   This spawns the real compiled server and drives it over actual JSON-RPC —
   the same transport a CLI agent uses — so the fix is verified end to end,
   not just unit-tested against a function. */

describe('9. brain_write validates its input instead of saving nothing')

const mcpBundle = path.join(SCRATCH, `eaon-mcpserver-${process.pid}.mjs`)
await build({
  entryPoints: [path.join(ROOT, 'src/main/brain/mcp-server.ts')],
  outfile: mcpBundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'silent'
})

const p9 = tempProject('mcp-validation')

function rpcClient(scriptPath, args) {
  const proc = spawn(process.execPath, [scriptPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  const pending = new Map()
  let nextId = 1
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk) => {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) {
        try {
          const msg = JSON.parse(line)
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)(msg)
            pending.delete(msg.id)
          }
        } catch {
          // ignore malformed lines
        }
      }
      nl = buffer.indexOf('\n')
    }
  })
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`timeout waiting for ${method}`))
      }, 8000)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  const callTool = async (name, args) => {
    const res = await request('tools/call', { name, arguments: args })
    return res.result
  }
  const close = () => proc.kill()
  return { request, callTool, close }
}

const client = rpcClient(mcpBundle, ['--root', p9])
await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } })

const wrongParam = await client.callTool('brain_write', {
  title: 'Should not save',
  body: 'This uses the wrong parameter name.',
  tags: ['x']
})
ok('the wrong-parameter-name call is flagged as an error', wrongParam.isError === true, JSON.stringify(wrongParam))
ok('the error names the actual mistake', wrongParam.content[0].text.includes('"content"') && wrongParam.content[0].text.includes('"body"'))
ok('nothing was written to disk', !fs.existsSync(path.join(p9, '.eaonbrain', 'should-not-save.md')))

const missingContent = await client.callTool('brain_write', { title: 'Also should not save' })
ok('a call with content entirely absent is flagged too', missingContent.isError === true)
ok('nothing was written for that one either', !fs.existsSync(path.join(p9, '.eaonbrain', 'also-should-not-save.md')))

const blankContent = await client.callTool('brain_write', { title: 'Blank content', content: '   ' })
ok('whitespace-only content is rejected, not saved as empty', blankContent.isError === true)

const noTitle = await client.callTool('brain_write', { content: 'Has content but no title.' })
ok('a missing title is rejected too', noTitle.isError === true)

const valid = await client.callTool('brain_write', {
  title: 'This one is fine',
  content: 'A real note with real content in it.',
  tags: ['x']
})
ok('a correctly-shaped call is not flagged as an error', valid.isError !== true, JSON.stringify(valid))
const savedFile = path.join(p9, '.eaonbrain', 'this-one-is-fine.md')
ok('and it actually lands on disk', fs.existsSync(savedFile))
ok('with the real content, not empty', fs.readFileSync(savedFile, 'utf8').includes('A real note with real content in it.'))

client.close()
fs.rmSync(mcpBundle, { force: true })

console.log(`\n${'─'.repeat(60)}`)
if (failures.length === 0) {
  console.log(`\x1b[32m✓ all ${passed} assertions passed\x1b[0m`)
  process.exit(0)
}
console.log(`\x1b[31m✗ ${failures.length} failed, ${passed} passed\x1b[0m\n`)
for (const f of failures) console.log(`  • ${f}`)
process.exit(1)
