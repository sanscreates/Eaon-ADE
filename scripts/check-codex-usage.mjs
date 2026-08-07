/*
 * Checks the Codex usage reader against synthetic rollouts.
 *
 * Synthetic on purpose, and worth being clear about why: the Codex CLI is not
 * installed on the machine this was written on, so there are no real rollouts
 * to read. These fixtures encode Codex's *documented* rollout shape plus the
 * plausible spellings the parser deliberately tolerates. That means this file
 * proves the parser does what it was designed to do — it does NOT prove the
 * design matches what Codex actually writes. The first person with the CLI
 * installed should point this at a real `~/.codex/sessions` and check the
 * numbers against `codex` itself.
 *
 *   node scripts/check-codex-usage.mjs
 */

import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaon-codex-usage-'))
const codexHome = path.join(tmp, 'codex')
const sessions = path.join(codexHome, 'sessions', '2026', '08')
fs.mkdirSync(sessions, { recursive: true })

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

const outfile = path.join(tmp, 'codex-usage.mjs')
await build({
  entryPoints: [path.join(root, 'src/main/codex-usage.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent'
})
const mod = await import(outfile)
mod.setCodexUsageHome(() => codexHome)

const now = Date.now()
const iso = (msAgo) => new Date(now - msAgo).toISOString()

/* ---- 1. one line at a time ---------------------------------------------- */

console.log('\nreading a single usage event')

const documented = JSON.stringify({
  timestamp: iso(1000),
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: {
        input_tokens: 1000,
        cached_input_tokens: 800,
        output_tokens: 200,
        total_tokens: 1200
      }
    }
  }
})
const parsed = mod.spendOf(documented, now)
check('the documented shape is understood', Boolean(parsed), JSON.stringify(parsed))
check('input is taken', parsed?.input === 1000, parsed?.input)
check('output is taken', parsed?.output === 200, parsed?.output)
check('cached input is kept separate from fresh input', parsed?.cacheRead === 800, parsed?.cacheRead)

check('a line that is not JSON is ignored', mod.spendOf('not json at all', now) === null)
check(
  'a JSON line with no usage in it is ignored',
  mod.spendOf(JSON.stringify({ type: 'message', payload: { text: 'hello' } }), now) === null
)
check(
  'an all-zero usage object is not counted as a turn',
  mod.spendOf(JSON.stringify({ usage: { input_tokens: 0, output_tokens: 0 } }), now) === null
)
check(
  'an alternative spelling is tolerated',
  mod.spendOf(JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 7 } }), now)?.output === 7
)
check(
  'a line with no timestamp falls back to the file time',
  mod.spendOf(JSON.stringify({ usage: { input_tokens: 1 } }), 12345)?.t === 12345
)

/* ---- 2. cumulative totals become deltas --------------------------------- */

console.log('\ncumulative totals are turned into what each turn added')

// Codex restates the session total on every event. Summing these directly
// would multiply a long session by its own length.
const rollout = [
  { at: iso(3 * 60 * 60 * 1000), input: 100, cached: 0, output: 50 },
  { at: iso(2 * 60 * 60 * 1000), input: 300, cached: 100, output: 150 },
  { at: iso(1 * 60 * 60 * 1000), input: 600, cached: 250, output: 400 }
]
  .map((r) =>
    JSON.stringify({
      timestamp: r.at,
      model: 'gpt-5-codex',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: r.input,
            cached_input_tokens: r.cached,
            output_tokens: r.output
          }
        }
      }
    })
  )
  .join('\n')
fs.writeFileSync(path.join(sessions, 'rollout-a.jsonl'), rollout + '\n')

const report = await mod.codexUsage()
const week = report.windows.find((w) => w.id === 'week')
const session = report.windows.find((w) => w.id === 'session')

// Final totals are 600 input + 250 cached + 400 output. Billed excludes cache
// reads, so the week should be 600 + 400 = 1000, NOT the sum of the three
// cumulative rows (1000 + 550 + 150 = way more).
check('the week counts the final total, not the sum of restatements', week?.used === 1000, week?.used)
check('three events became three turns', report.messages === 3, report.messages)
check('the model label is humanised', week?.models[0]?.label !== undefined, JSON.stringify(week?.models[0]))

// Only the last two events are inside five hours... all three are, here.
check('the session window also sees them', session?.used === 1000, session?.used)

/* ---- 3. a second session in the same window ----------------------------- */

console.log('\na second rollout adds to the same window')
fs.writeFileSync(
  path.join(sessions, 'rollout-b.jsonl'),
  JSON.stringify({
    timestamp: iso(30 * 60 * 1000),
    model: 'gpt-5-codex',
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, output_tokens: 5 } } }
  }) + '\n'
)
const report2 = await mod.codexUsage()
check(
  'both rollouts are counted',
  report2.windows.find((w) => w.id === 'week')?.used === 1015,
  report2.windows.find((w) => w.id === 'week')?.used
)

/* ---- 4. old activity falls out of the window ---------------------------- */

console.log('\nactivity older than the window is not counted')
fs.writeFileSync(
  path.join(sessions, 'rollout-old.jsonl'),
  JSON.stringify({
    timestamp: iso(10 * 24 * 60 * 60 * 1000),
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 999999 } } }
  }) + '\n'
)
// Backdate the file too, since the reader skips files older than the window.
const old = path.join(sessions, 'rollout-old.jsonl')
fs.utimesSync(old, new Date(now - 10 * 24 * 60 * 60 * 1000), new Date(now - 10 * 24 * 60 * 60 * 1000))
const report3 = await mod.codexUsage()
check(
  'a ten-day-old rollout does not appear in the week',
  report3.windows.find((w) => w.id === 'week')?.used === 1015,
  report3.windows.find((w) => w.id === 'week')?.used
)

/* ---- 5. degrading rather than lying ------------------------------------- */

console.log('\nan unrecognised rollout reads as no usage, never as a wrong number')
const empty = path.join(tmp, 'nowhere')
mod.setCodexUsageHome(() => empty)
const none = await mod.codexUsage()
check('a missing sessions directory returns zeroes', none.windows.every((w) => w.used === 0))
check('and does not throw', none.messages === 0)

mod.setCodexUsageHome(() => codexHome)
fs.writeFileSync(path.join(sessions, 'garbage.jsonl'), 'this is not\njsonl at all\n{{{\n')
const survived = await mod.codexUsage()
check(
  'a corrupt rollout does not lose the rest of the report',
  survived.windows.find((w) => w.id === 'week')?.used === 1015,
  survived.windows.find((w) => w.id === 'week')?.used
)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
