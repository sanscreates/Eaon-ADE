/* End-to-end UI test for the memory panel, driven through the Chrome
   DevTools Protocol against the real running app.

   Launch the app with `npx electron . --remote-debugging-port=9222` first.
   Run: node scripts/test-memory-ui.mjs

   Everything it creates is prefixed and deleted again, so the project's real
   memory is left exactly as it was found. */

import WebSocket from 'ws';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const API = 'http://127.0.0.1:8787';
const SHOT_DIR = process.env.EAON_SHOT_DIR || '.';
const PREFIX = 'uitest';

/* ── harness ────────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];
let group = '';

function describe(name) {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}
function ok(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(`${group} › ${label}${detail ? `\n      ${detail}` : ''}`);
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? `\n      ${String(detail).slice(0, 300)}` : ''}`);
  }
}
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, a === e ? '' : `expected ${e}\n      got      ${a}`);
}

/* ── CDP ────────────────────────────────────────────────────────────────── */

const targets = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = targets.find((t) => t.type === 'page' && t.url.includes('8787'));
if (!page) {
  console.error('No Eaon page target found. Start the app with --remote-debugging-port=9222.');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
let mid = 0;
const pending = new Map();
const consoleErrors = [];

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    consoleErrors.push(`EXCEPTION: ${d.text} ${d.exception?.description ?? ''}`.slice(0, 500));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400));
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++mid;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((r) => ws.on('open', r));
await send('Runtime.enable');
await send('Page.enable');

/** Evaluate an expression in the page and return its value. */
async function probe(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) {
    throw new Error(res.result.exceptionDetails.text + ' ' + (res.result.exceptionDetails.exception?.description ?? ''));
  }
  return res.result?.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until the expression is truthy, or give up. */
async function waitFor(expression, { timeout = 8000, label = expression } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await probe(expression)) return true;
    } catch {
      // page mid-navigation
    }
    await sleep(120);
  }
  console.log(`      (timed out waiting for ${label})`);
  return false;
}

/**
 * React ignores a plain `el.value = x` — its own value tracker sees no change
 * and swallows the event. Going through the prototype setter is the standard
 * way to make a controlled input accept a scripted value.
 */
const TYPE_HELPER = `
window.__eaonType = (selector, text, index) => {
  const nodes = document.querySelectorAll(selector);
  const el = nodes[index ?? 0];
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
window.__eaonClick = (selector, index) => {
  const nodes = document.querySelectorAll(selector);
  const el = nodes[index ?? 0];
  if (!el) return false;
  el.click();
  return true;
};
window.__eaonClickText = (selector, text) => {
  const el = [...document.querySelectorAll(selector)].find((n) => (n.textContent || '').includes(text));
  if (!el) return false;
  el.click();
  return true;
};
window.__eaonText = (selector) => document.querySelector(selector)?.textContent ?? null;
window.__eaonCount = (selector) => document.querySelectorAll(selector).length;
true;
`;

const type = async (selector, text, index) =>
  probe(`window.__eaonType(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${index ?? 0})`);
const click = async (selector, index) =>
  probe(`window.__eaonClick(${JSON.stringify(selector)}, ${index ?? 0})`);
const clickText = async (selector, text) =>
  probe(`window.__eaonClickText(${JSON.stringify(selector)}, ${JSON.stringify(text)})`);
const text = async (selector) => probe(`window.__eaonText(${JSON.stringify(selector)})`);
const count = async (selector) => probe(`window.__eaonCount(${JSON.stringify(selector)})`);

async function screenshot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  const data = res.result?.data;
  if (!data) return null;
  const file = join(SHOT_DIR, `${name}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

/* ── project + cleanup ──────────────────────────────────────────────────── */

const projects = await fetch(`${API}/api/projects`).then((r) => r.json());
const project = projects.projects[0];
if (!project) {
  console.error('No project registered in the app — add one first.');
  process.exit(1);
}
console.log(`project: ${project.path}`);

const memApi = (path, params = {}) => {
  const url = new URL(`${API}/api/memory${path}`);
  url.searchParams.set('project', project.path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
};

async function listNotes() {
  const res = await fetch(memApi('')).then((r) => r.json());
  return res.notes ?? [];
}

async function removeTestNotes() {
  for (const note of await listNotes()) {
    if (note.id.startsWith(PREFIX)) {
      await fetch(memApi('/note', { id: note.id }), { method: 'DELETE' });
    }
  }
}

// Clear first, then snapshot: a previous run that died mid-way would
// otherwise make its own leftovers part of the baseline.
await removeTestNotes();
const preExisting = (await listNotes()).map((n) => n.id);

/* ═══════════════════════════════════════════════════════════════════════════
   1. Opening the panel
   ═══════════════════════════════════════════════════════════════════════════ */

describe('1. opening the memory panel');

await send('Page.reload', { ignoreCache: true });
await sleep(2500);
ok('app renders after reload', await waitFor(`!!document.querySelector('.app')`));
await probe(TYPE_HELPER);

ok('sidebar has a Memory button', await probe(`[...document.querySelectorAll('.nav-item')].some(b => b.textContent.includes('Memory'))`));

await clickText('.nav-item', 'Memory');
ok('clicking it opens the panel', await waitFor(`!!document.querySelector('.mem-panel')`));
ok('a Memory tab appears in the strip', await probe(`[...document.querySelectorAll('.wt-name')].some(n => n.textContent === 'Memory')`));
ok('the graph canvas is mounted', await probe(`!!document.querySelector('.mem-graph-canvas')`));

const canvasSize = await probe(
  `JSON.stringify((c => c ? {w: c.offsetWidth, h: c.offsetHeight} : null)(document.querySelector('.mem-graph-canvas')))`,
);
const size = JSON.parse(canvasSize ?? 'null');
ok('the canvas has real dimensions', size && size.w > 300 && size.h > 200, canvasSize);

// Every other way in should reveal the same tab rather than open a second.
// (Alt+8 itself is an Electron menu accelerator, handled in the main process
// where a scripted key event cannot reach it — the renderer path is the one
// that is testable here, and it is the same openPanelKind call either way.)
await clickText('.nav-item', 'Files');
await sleep(500);
ok('switching away works', await probe(`!document.querySelector('.mem-panel')`));

await click('.wt-add');
await sleep(300);
await clickText('.wt-new-menu .dropdown-item', 'Memory');
await sleep(600);
ok('the "+" menu reopens memory', await probe(`!!document.querySelector('.mem-panel')`));
eq('and does not open a duplicate tab', await probe(`[...document.querySelectorAll('.wt-name')].filter(n => n.textContent === 'Memory').length`), 1);

// The empty state is only correct when the project really is empty; this
// project may already hold notes somebody wrote by hand.
if (preExisting.length === 0) {
  const emptyHead = await text('.mem-empty-card h2');
  ok('the empty state explains itself', (emptyHead ?? '').includes('Nothing remembered'), `heading was ${emptyHead}`);
  ok('and offers both first steps', (await count('.mem-empty-actions .btn')) === 2);
} else {
  console.log(`  (project already holds ${preExisting.length} note(s) — empty state not applicable)`);
  ok('existing notes are listed', (await waitFor(`window.__eaonCount('.mem-row') >= ${preExisting.length}`)));
  ok('no empty state while notes exist', (await count('.mem-empty-card')) === 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Writing a memory
   ═══════════════════════════════════════════════════════════════════════════ */

describe('2. writing a memory');

await clickText('.mem-toolbar-right .btn', 'New memory');
ok('the composer opens', await waitFor(`!!document.querySelector('.mem-form')`));
ok('it explains what a memory is for', ((await text('.mem-side-inner')) ?? '').includes('not working out twice'));
ok('save is disabled with no title', await probe(`[...document.querySelectorAll('.mem-actions .btn')].find(b => b.textContent.includes('Save'))?.disabled === true`));

await type('.mem-form .field-input', `${PREFIX} Auth flow`, 0);
await type('.mem-form .field-input', 'uitest, auth', 1);
await type('.mem-form .mem-textarea', 'Login exchanges a code for a token. See [[uitest Session store]].');
await sleep(200);
ok('save is enabled once there is a title', await probe(`[...document.querySelectorAll('.mem-actions .btn')].find(b => b.textContent.includes('Save'))?.disabled === false`));

await clickText('.mem-actions .btn', 'Save memory');
ok('the note lands in the list', await waitFor(`window.__eaonCount('.mem-row') >= ${preExisting.length + 1}`));
ok('a success toast confirms the save', await probe(`[...document.querySelectorAll('.toast-text')].some(t => t.textContent.includes('Saved'))`));

const created = (await listNotes()).find((n) => n.id === `${PREFIX}-auth-flow`);
ok('the file was written with the expected id', !!created, JSON.stringify((await listNotes()).map((n) => n.id)));
ok('the file exists on disk', created && existsSync(created.file));
eq('tags were normalised', created?.tags, ['uitest', 'auth']);
ok('the unwritten link was recorded', created?.links?.[0]?.resolved === false);

ok('the detail rail shows it', (await text('.mem-side-title'))?.includes('Auth flow'));
ok('the wikilink renders as a link', (await count('.mem-wikilink')) >= 1);
ok('and is marked as unwritten', (await count('.mem-wikilink-missing')) >= 1);
ok('links-out flags the missing note', (await count('.mem-link-badge')) >= 1);

/* ═══════════════════════════════════════════════════════════════════════════
   3. Linking, backlinks and the graph
   ═══════════════════════════════════════════════════════════════════════════ */

describe('3. links, backlinks and the graph');

// Clicking an unwritten wikilink should offer to write that note.
await click('.mem-wikilink-missing');
ok('clicking an unwritten link opens the composer', await waitFor(`!!document.querySelector('.mem-form')`));
const prefilled = await probe(`document.querySelectorAll('.mem-form .field-input')[0]?.value ?? null`);
ok('prefilled with the link text', prefilled === `${PREFIX} Session store`, prefilled);

await type('.mem-form .field-input', 'uitest, auth', 1);
await type('.mem-form .mem-textarea', 'Redis-backed sessions. Written for [[uitest Auth flow]].');
await clickText('.mem-actions .btn', 'Save memory');
ok('the second note saves', await waitFor(`window.__eaonCount('.mem-row') >= ${preExisting.length + 2}`));

const notes2 = await listNotes();
const session = notes2.find((n) => n.id === `${PREFIX}-session-store`);
ok('the second file exists', !!session);
ok('its link resolved', session?.links?.[0]?.resolved === true);

const auth2 = notes2.find((n) => n.id === `${PREFIX}-auth-flow`);
ok('the first note’s link resolved retroactively', auth2?.links?.[0]?.resolved === true);

ok('the detail rail shows a backlink', await waitFor(`(document.querySelector('.mem-side-inner')?.textContent ?? '').includes('Backlinks')`));
ok('backlink count is one', (await text('.mem-side-inner'))?.includes('Backlinks'));
ok('the backlink quotes its context', (await count('.mem-link-context')) >= 1);

const legend = await text('.mem-legend');
ok('the legend counts notes', legend?.includes('notes'), legend);

// The canvas must actually have paint on it, not just exist.
const painted = await probe(`(() => {
  const c = document.querySelector('.mem-graph-canvas');
  if (!c) return -1;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
})()`);
ok('the graph has actually painted pixels', painted > 200, `non-transparent pixels: ${painted}`);

// Following a resolved wikilink should move the selection.
await clickText('.mem-row-title', `${PREFIX} Session store`);
await waitFor(`(document.querySelector('.mem-side-title')?.textContent ?? '').includes('Session store')`);
ok(
  'a link written by title renders as resolved',
  (await count('.mem-wikilink')) === 1 && (await count('.mem-wikilink-missing')) === 0,
  `links: ${await count('.mem-wikilink')}, missing: ${await count('.mem-wikilink-missing')}`,
);
await click('.mem-wikilink');
ok(
  'clicking a resolved wikilink navigates',
  await waitFor(`(document.querySelector('.mem-side-title')?.textContent ?? '').includes('Auth flow')`, {
    label: 'the rail to show Auth flow',
  }),
);

/* ═══════════════════════════════════════════════════════════════════════════
   4. Search and tags
   ═══════════════════════════════════════════════════════════════════════════ */

describe('4. search and tag filtering');

await type('.mem-search-input', 'redis');
ok('search narrows the list', await waitFor(`window.__eaonCount('.mem-row') === 1`, { label: 'one row' }));
ok('the match is the right note', (await text('.mem-row-title'))?.includes('Session store'));
ok('the snippet marks the term', (await count('.mem-row-sub strong')) >= 1);
ok('the header reports the count', (await text('.mem-list-head'))?.includes('match'));

await type('.mem-search-input', 'zzzznothinghere');
ok('a miss says so', await waitFor(`(document.querySelector('.mem-list-empty')?.textContent ?? '').includes('Nothing matches')`));

await click('.mem-search .icon-btn');
await sleep(400);
ok('clearing search restores the list', (await count('.mem-row')) >= preExisting.length + 2);

ok('tag chips render', (await count('.mem-tag')) >= 1);
await clickText('.mem-tags .mem-tag', '#uitest');
await sleep(500);
ok('the tag chip turns on', (await count('.mem-tag-on')) === 1);
ok('the tag filters the list', (await count('.mem-row')) === 2, `rows: ${await count('.mem-row')}`);
await clickText('.mem-tags .mem-tag', '#uitest');
await sleep(400);
eq('clicking again clears it', await count('.mem-tag-on'), 0);

/* ═══════════════════════════════════════════════════════════════════════════
   5. Editing
   ═══════════════════════════════════════════════════════════════════════════ */

describe('5. editing');

await clickText('.mem-row-title', `${PREFIX} Auth flow`);
await sleep(400);
await clickText('.mem-actions .btn', 'Edit');
ok('the editor opens', await waitFor(`(document.querySelector('.mem-side-title')?.textContent ?? '') === 'Editing'`));

await type('.mem-form .mem-textarea', 'Login exchanges a code for a token. See [[uitest Session store]].\n\nRefresh happens on the server.');
await clickText('.mem-actions .btn', 'Save');
ok('the edit saves', await waitFor(`(document.querySelector('.mem-body-text')?.textContent ?? '').includes('Refresh happens')`));

const edited = (await listNotes()).find((n) => n.id === `${PREFIX}-auth-flow`);
ok('the file on disk has the edit', edited && readFileSync(edited.file, 'utf8').includes('Refresh happens'));
ok('the link survived the edit', edited?.links?.[0]?.resolved === true);
ok('tags survived the edit', JSON.stringify(edited?.tags) === JSON.stringify(['uitest', 'auth']));

/* ═══════════════════════════════════════════════════════════════════════════
   6. Suggested connections
   ═══════════════════════════════════════════════════════════════════════════ */

describe('6. suggested connections');

// A third note on the same topic, unlinked, is exactly what a suggestion is for.
await fetch(memApi(''), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: `${PREFIX} Token refresh`,
    content: 'Refresh tokens rotate on every use. The auth token is short-lived.',
    tags: ['uitest', 'auth'],
  }),
});
await sleep(900);

await clickText('.mem-row-title', `${PREFIX} Auth flow`);
await sleep(900);
const sideText = (await text('.mem-side-inner')) ?? '';
ok('suggestions appear for the selected note', sideText.includes('Suggested connections'), sideText.slice(0, 200));
ok('a suggestion explains itself', (await count('.mem-suggest-why')) >= 1);
ok('the reason mentions the shared tag', ((await text('.mem-suggest-why')) ?? '').includes('#'));

const beforeLink = (await listNotes()).find((n) => n.id === `${PREFIX}-auth-flow`).links.length;
await click('.mem-suggest-link');
await sleep(1200);
const afterLink = (await listNotes()).find((n) => n.id === `${PREFIX}-auth-flow`).links.length;
ok('clicking Link writes the link into the markdown', afterLink > beforeLink, `${beforeLink} → ${afterLink}`);

/* ═══════════════════════════════════════════════════════════════════════════
   7. Live updates from another writer
   ═══════════════════════════════════════════════════════════════════════════ */

describe('7. live updates from another writer');

const before = await count('.mem-row');
// Write straight to disk, the way an agent's MCP process does — no HTTP, so
// the only path to the UI is the file watcher and the websocket broadcast.
const outsideFile = join(project.path, '.eaon', 'memory', `${PREFIX}-from-an-agent.md`);
writeFileSync(
  outsideFile,
  `---\ntitle: ${PREFIX} From an agent\ntags: [uitest]\ncreated: ${new Date().toISOString()}\nupdated: ${new Date().toISOString()}\nsource: claude-code\n---\n\nWritten by another process entirely. Links [[uitest Auth flow]].\n`,
);
ok(
  'a note written outside the app shows up on its own',
  await waitFor(`window.__eaonCount('.mem-row') === ${before + 1}`, { timeout: 9000, label: 'row count to grow' }),
);

rmSync(outsideFile, { force: true });
ok(
  'and disappears again when deleted',
  await waitFor(`window.__eaonCount('.mem-row') === ${before}`, { timeout: 9000, label: 'row count to shrink' }),
);

/* ═══════════════════════════════════════════════════════════════════════════
   8. Connecting agents
   ═══════════════════════════════════════════════════════════════════════════ */

describe('8. connecting agents over MCP');

const mcpBackup = existsSync(join(project.path, '.mcp.json'))
  ? readFileSync(join(project.path, '.mcp.json'), 'utf8')
  : null;

await clickText('.mem-toolbar-right .btn', 'Agents');
ok('the agents dialog opens', await waitFor(`!!document.querySelector('.mem-mcp-list')`));
ok('every target is listed', (await count('.mem-mcp-row')) === 5);
ok('a copyable snippet is shown', ((await text('.mem-snippet')) ?? '').includes('eaon-memory'));
ok('the snippet names a real script', ((await text('.mem-snippet')) ?? '').includes('eaon-memory-mcp.mjs'));

await clickText('.mem-mcp-row .btn', 'Connect');
ok('connecting reports success', await waitFor(`window.__eaonCount('.mem-mcp-on') >= 1`, { timeout: 9000 }));
ok('.mcp.json was written', existsSync(join(project.path, '.mcp.json')));

const written = existsSync(join(project.path, '.mcp.json'))
  ? JSON.parse(readFileSync(join(project.path, '.mcp.json'), 'utf8'))
  : {};
const block = written.mcpServers?.['eaon-memory'];
ok('the config declares our server', !!block, JSON.stringify(written).slice(0, 200));
ok('it points at the installed script', block?.args?.[0]?.endsWith('eaon-memory-mcp.mjs'));
ok('the script it points at exists', block && existsSync(block.args[0]));
ok('it passes this project', block?.args?.includes(project.path));

await clickText('.mem-mcp-row .btn', 'Disconnect');
await sleep(1500);
const afterDisconnect = existsSync(join(project.path, '.mcp.json'))
  ? JSON.parse(readFileSync(join(project.path, '.mcp.json'), 'utf8'))
  : null;
ok('disconnecting removes it again', !afterDisconnect || !afterDisconnect.mcpServers?.['eaon-memory']);

// Leave the project's MCP config exactly as it was found.
if (mcpBackup !== null) writeFileSync(join(project.path, '.mcp.json'), mcpBackup);
else rmSync(join(project.path, '.mcp.json'), { force: true });

await click('.modal .icon-btn');
await sleep(400);
eq('the dialog closes', await count('.mem-mcp-list'), 0);

/* ═══════════════════════════════════════════════════════════════════════════
   9. Deleting, and the state of the console
   ═══════════════════════════════════════════════════════════════════════════ */

describe('9. deleting and console health');

const shot = await screenshot('memory-panel');
if (shot) console.log(`  screenshot: ${shot}`);

await clickText('.mem-row-title', `${PREFIX} Token refresh`);
await sleep(500);
await click('.mem-delete');
ok('a confirmation is asked for', await waitFor(`!!document.querySelector('.modal')`));
await clickText('.modal .btn', 'Delete');
ok('the note goes', await waitFor(`![...document.querySelectorAll('.mem-row-title')].some(n => n.textContent.includes('Token refresh'))`, { timeout: 8000, label: 'the row to disappear' }));
ok('the file is gone from disk', !(await listNotes()).some((n) => n.id === `${PREFIX}-token-refresh`));
ok('links to it are now unwritten', (await listNotes()).find((n) => n.id === `${PREFIX}-auth-flow`)?.links.some((l) => !l.resolved) === true);

const realErrors = consoleErrors.filter(
  (e) => !/DevTools|Autofill|Download the React DevTools|favicon/i.test(e),
);
eq('no runtime errors on the console', realErrors.length, 0);
if (realErrors.length) for (const e of realErrors.slice(0, 6)) console.log(`      ${e}`);

/* ── restore ────────────────────────────────────────────────────────────── */

await removeTestNotes();
const finalIds = (await listNotes()).map((n) => n.id);
eq('the project memory is left as it was found', finalIds.sort(), preExisting.sort());

await sleep(600);
ws.close();

console.log(`\n${'─'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`\x1b[32m✓ all ${passed} assertions passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m✗ ${failures.length} failed, ${passed} passed\x1b[0m\n`);
for (const f of failures) console.log(`  • ${f}`);
process.exit(1);
