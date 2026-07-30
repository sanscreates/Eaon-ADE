// CDP verification: workspace tabs — spawn isolation, switching, rename,
// close, persistence across reload. Runs against the temp stack on :8791.
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9223/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page' && t.url.includes('8791'));
if (!page) {
  console.error('no page on 8791');
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
let mid = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++mid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('exception: ' + (msg.params.exceptionDetails?.exception?.description ?? 'unknown').slice(0, 300));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  }
});
await new Promise((r) => ws.on('open', r));
await send('Runtime.enable');
await send('Page.enable');

const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(res.exceptionDetails).slice(0, 400));
  return res.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(file) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
}
let failures = 0;
const check = (name, actual, expect) => {
  const ok = typeof expect === 'function' ? expect(actual) : JSON.stringify(actual) === JSON.stringify(expect);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}`);
  if (!ok) failures++;
};

// Clean slate: no persisted tabs from earlier runs.
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(3500);
const tabNames = () => ev(`[...document.querySelectorAll('.wt-tab .wt-name')].map(x => x.textContent)`);
const leafCount = () => ev(`document.querySelectorAll('.leaf').length`);
const activeTabName = () => ev(`document.querySelector('.wt-tab.wt-active .wt-name')?.textContent`);

console.log('--- initial state (migration) ---');
check('strip rendered', await ev(`!!document.querySelector('.wt-strip')`), true);
check('one migrated tab', await tabNames(), ['Workspace 1']);

// Ensure a project exists so templates can spawn shells.
const projects = await ev(`fetch('/api/projects').then(r => r.json())`);
if (!projects?.projects?.length) {
  await ev(`fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/tmp' }) })`);
  await sleep(800);
  await ev(`location.reload()`);
  await sleep(2500);
  console.log('(added /tmp project and reloaded)');
}

console.log('--- spawn 2 panes in tab 1 ---');
await ev(`document.querySelector('.template-menu .btn')?.click()`);
await sleep(400);
await ev(`[...document.querySelectorAll('.dropdown-item')].find(x => x.textContent.includes('2 panes'))?.click()`);
await sleep(2500);
check('tab 1 has 2 panes', await leafCount(), 2);
check('tab 1 badge', await ev(`document.querySelector('.wt-tab.wt-active .wt-count')?.textContent`), '2');

console.log('--- new tab → empty grid ---');
await ev(`document.querySelector('.wt-add')?.click()`);
await sleep(600);
check('two tabs', (await tabNames()).length, 2);
check('new tab active', await activeTabName(), 'Workspace 2');
check('grid empty in tab 2', await leafCount(), 0);

console.log('--- spawn 1 pane in tab 2 ---');
await ev(`document.querySelector('.template-menu .btn')?.click()`);
await sleep(400);
await ev(`[...document.querySelectorAll('.dropdown-item')].find(x => x.textContent.includes('1 pane'))?.click()`);
await sleep(2200);
check('tab 2 has 1 pane', await leafCount(), 1);

console.log('--- the critical isolation check ---');
await ev(`[...document.querySelectorAll('.wt-tab')][0]?.click()`);
await sleep(1200);
check('tab 1 restores 2 panes', await leafCount(), 2);
await ev(`[...document.querySelectorAll('.wt-tab')][1]?.click()`);
await sleep(1200);
check('tab 2 still has exactly 1 pane (no teleport)', await leafCount(), 1);

console.log('--- rename via double-click ---');
await ev(`(() => { const t = [...document.querySelectorAll('.wt-tab')][1]; t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
await sleep(300);
await ev(`(() => {
  const i = document.querySelector('.wt-rename');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'Backend');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(150);
await ev(`(() => { const i = document.querySelector('.wt-rename'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
await sleep(400);
check('renamed tab', await tabNames(), ['Workspace 1', 'Backend']);

console.log('--- context menu ---');
await ev(`(() => { const t = [...document.querySelectorAll('.wt-tab')][0]; t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); })()`);
await sleep(350);
check('menu items', await ev(`[...document.querySelectorAll('.wt-menu .dropdown-item')].map(x => x.textContent)`), (items) =>
  items.some((x) => x.startsWith('Rename')) && items.includes('New tab') && items.some((x) => x.startsWith('Close tab')) && items.includes('Close other tabs'));
await shot('/tmp/eaon-tabs-menu.png');
await ev(`document.querySelector('.wt-strip')?.click()`);
await sleep(300);

console.log('--- close tab kills only its sessions ---');
await ev(`[...document.querySelectorAll('.wt-tab')][1]?.querySelector('.wt-close')?.click()`);
await sleep(2000);
check('back to one tab', (await tabNames()).length, 1);
check('tab 1 restored with its 2 panes', await leafCount(), 2);
// If Backend's shell had survived, the next reload would reconcile THREE
// sessions into the grid. Two restored panes is the proof the kill landed.

console.log('--- persistence across reload ---');
await ev(`location.reload()`);
await sleep(3000);
check('tabs survive reload', await tabNames(), ['Workspace 1']);
check('panes restored after reload', await leafCount(), 2);

console.log('--- ⌘T + Ctrl+Tab cycle ---');
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', metaKey: true, bubbles: true, cancelable: true }))`);
await sleep(500);
check('⌘T opens tab', (await tabNames()).length, 2);
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }))`);
await sleep(500);
check('Ctrl+Tab cycles to tab 1', await activeTabName(), 'Workspace 1');
await shot('/tmp/eaon-tabs-final.png');

console.log(`--- errors (${errors.length}) ---`);
errors.forEach((e) => console.log(e));
console.log(failures === 0 && errors.length === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES, ${errors.length} errors`);
ws.close();
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
