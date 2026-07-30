// CDP: add-account flow + unsigned-account state + session dialog picker.
import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
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

const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(res.exceptionDetails).slice(0, 400));
  return res.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, actual, expect) => {
  const ok = typeof expect === 'function' ? expect(actual) : actual === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}`);
  if (!ok) failures++;
};

// State-independent panel control: the pill toggles, so only click when the
// panel isn't already in the state we want.
async function ensurePanel(wantOpen) {
  for (let i = 0; i < 4; i++) {
    const isOpen = await ev(`!!document.querySelector('.cu-panel')`);
    if (isOpen === wantOpen) return;
    await ev(`document.querySelector('.cu-pill')?.click()`);
    await sleep(450);
  }
  throw new Error(`panel did not reach open=${wantOpen}`);
}
async function ensureSwitcher() {
  const has = await ev(`!!document.querySelector('.cu-switch')`);
  if (!has) {
    await ev(`document.querySelector('.cu-account')?.click()`);
    await sleep(350);
  }
}

// Precondition: usage pill on (previous run left it on).
check('pill visible (precondition)', await ev(`!!document.querySelector('.cu-pill')`), true);

console.log('--- add account via popover ---');
await ensurePanel(true);
await ensureSwitcher();
check('switcher rows', await ev(`document.querySelectorAll('.cu-switch .dropdown-item').length`), (n) => n >= 2);
await ev(`[...document.querySelectorAll('.cu-switch .dropdown-item')].find(x => x.textContent.includes('Add account'))?.click()`);
await sleep(400);
check('add form shown', await ev(`!!document.querySelector('.cu-add input')`), true);
await ev(`(() => {
  const i = document.querySelector('.cu-add input');
  if (!i) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'Work Test');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(200);
check('add button enabled', await ev(`[...document.querySelectorAll('.cu-add .btn')].find(b => b.textContent.trim() === 'Add')?.disabled`), false);
await ev(`[...document.querySelectorAll('.cu-add .btn')].find(b => b.textContent.trim() === 'Add')?.click()`);
await sleep(1800);
const after = await ev(`fetch('/api/claude/accounts').then(r => r.json())`);
check('profile created server-side', after?.accounts?.some((a) => a.slug === 'work-test'), true);
check('configDir under eaon-ade', after?.accounts?.find((a) => a.slug === 'work-test')?.configDir, (v) => typeof v === 'string' && v.includes('.eaon-ade/claude-accounts'));
check('login pane spawned', await ev(`document.querySelectorAll('.xterm').length`), (n) => n >= 1);
check('popover stays open after add', await ev(`!!document.querySelector('.cu-panel')`), true);

console.log('--- switch to unsigned account ---');
// Panel is still open; the switcher collapsed. Re-open it and pick Work Test.
await ensurePanel(true);
await ensureSwitcher();
await ev(`[...document.querySelectorAll('.cu-switch .dropdown-item')].find(x => x.textContent.includes('Work Test'))?.click()`);
await sleep(2500);
check('not-signed-in note', await ev(`document.querySelector('.cu-note-title')?.textContent`), 'Not signed in');
check('account persisted', await ev(`JSON.parse(localStorage.getItem('eaon.settings.v1') ?? '{}')?.claudeAccountSlug`), 'work-test');
await ensurePanel(false);

console.log('--- session dialog shows Work Test ---');
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('New Agent'))?.click()`);
await sleep(700);
const claudeCardState = await ev(`(() => {
  const c = [...document.querySelectorAll('.agent-card')].find(x => x.querySelector('.agent-card-name')?.textContent === 'Claude Code');
  if (!c) return 'missing';
  if (c.disabled) return 'disabled';
  c.click();
  return 'clicked';
})()`);
check('claude card', claudeCardState, 'clicked');
await sleep(400);
if (claudeCardState === 'clicked') {
  check('picker label', await ev(`[...document.querySelectorAll('.field-label')].some(x => x.textContent === 'Claude account')`), true);
  check('picker includes Work Test', await ev(`(() => { const s = [...document.querySelectorAll('.field select')][0]; return s ? [...s.options].map(o => o.textContent) : []; })()`), (opts) => opts.some((o) => o.includes('Work Test')));
}
await ev(`[...document.querySelectorAll('.modal-actions .btn')].find(b => b.textContent === 'Cancel')?.click()`);
await sleep(300);

console.log('--- switch back to Default ---');
await ensurePanel(true);
await ensureSwitcher();
await ev(`[...document.querySelectorAll('.cu-switch .dropdown-item')].find(x => x.textContent.trim().startsWith('Default'))?.click()`);
await sleep(2200);
check('bars back', await ev(`document.querySelectorAll('.cu-row').length`), (n) => n >= 2);
await ensurePanel(false);

console.log(`--- errors (${errors.length}) ---`);
errors.forEach((e) => console.log(e));
console.log(failures === 0 && errors.length === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES, ${errors.length} errors`);
ws.close();
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
