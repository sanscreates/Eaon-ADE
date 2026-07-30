// CDP verification for the Settings page.
// Selectors track the current markup (full-page takeover: .st-overlay/.st-shell).
import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('no debuggable page — is the app running with --remote-debugging-port=9222?');
  process.exit(1);
}

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
    errors.push('exception: ' + JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? msg.params));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
await new Promise((r) => ws.on('open', r));
await send('Runtime.enable');

const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(res.exceptionDetails));
  return res.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, actual, expect) => {
  const ok = typeof expect === 'function' ? expect(actual) : actual === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}`);
  if (!ok) failures++;
};

console.log('target:', await ev('location.href'));

console.log('--- open settings via the topbar gear ---');
await ev(`document.querySelector('.icon-btn[title^="Settings"]')?.click()`);
await sleep(700);
check('overlay open', await ev(`!!document.querySelector('.st-overlay')`), true);
// The store remembers the last section — always start from Appearance.
await ev(`[...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('Appearance'))?.click()`);
await sleep(350);
check('nav items', await ev(`document.querySelectorAll('.st-nav-item').length`), 6);
check('theme cards', await ev(`document.querySelectorAll('.st-theme-card').length`), 10);
check('active card', await ev(`document.querySelector('.st-theme-card-active .st-theme-name')?.textContent`), 'Eaon');

console.log('--- switch to Midnight ---');
await ev(`[...document.querySelectorAll('.st-theme-card')].find(x => x.querySelector('.st-theme-name')?.textContent === 'Midnight')?.click()`);
await sleep(500);
check('data-theme', await ev(`document.documentElement.getAttribute('data-theme')`), 'midnight');
// The window is blurred under CDP, so the dimmed accent variant may apply.
check('computed --accent', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), (v) => ['#6e7bff', '#5d639b'].includes(v));
check('topbar follows theme', await ev(`getComputedStyle(document.querySelector('.topbar')).backgroundColor`), 'rgb(13, 16, 23)');
check('persisted', await ev(`JSON.parse(localStorage.getItem('eaon.settings.v1') ?? '{}')?.theme`), 'midnight');

console.log('--- switch to Daylight (light) ---');
await ev(`[...document.querySelectorAll('.st-theme-card')].find(x => x.querySelector('.st-theme-name')?.textContent === 'Daylight')?.click()`);
await sleep(500);
check('data-theme-light', await ev(`document.documentElement.hasAttribute('data-theme-light')`), true);
check('light borders flipped', await ev(`getComputedStyle(document.documentElement).getPropertyValue('--line').trim()`), (v) => /^rgba\(17, 24, 39, 0?\.11\)$/.test(v));
check('chrome is light', await ev(`getComputedStyle(document.querySelector('.topbar')).backgroundColor`), 'rgb(246, 247, 249)');

console.log('--- terminal section + font stepper ---');
await ev(`[...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('Terminal'))?.click()`);
await sleep(400);
check('ansi swatches', await ev(`document.querySelectorAll('.st-ansi i').length`), 12);
const before = await ev(`parseInt(document.querySelector('.st-step-val')?.textContent ?? '0')`);
await ev(`[...document.querySelectorAll('.st-step-btn')].find(b => b.getAttribute('aria-label') === 'Increase')?.click()`);
await sleep(300);
const after = await ev(`parseInt(document.querySelector('.st-step-val')?.textContent ?? '0')`);
check('stepper increments', after - before, 1);
// Terminal font size persists to its own key (eaon.termFontSize), the source
// of truth that openSettings re-syncs from.
check('font size persisted', await ev(`parseInt(localStorage.getItem('eaon.termFontSize') ?? '0')`), after);

console.log('--- shortcuts + about sections render ---');
await ev(`[...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('Shortcuts'))?.click()`);
await sleep(300);
check('shortcut rows', await ev(`document.querySelectorAll('.st-krow').length`), (n) => n >= 10);
await ev(`[...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('About'))?.click()`);
await sleep(300);
check('about rows', await ev(`document.querySelectorAll('.st-kv').length`), (n) => n >= 3);

console.log('--- esc closes, theme reset to Eaon ---');
await ev(`[...document.querySelectorAll('.st-theme-card')].length`); // noop keepalive
await ev(`[...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('Appearance'))?.click()`);
await sleep(250);
await ev(`[...document.querySelectorAll('.st-theme-card')].find(x => x.querySelector('.st-theme-name')?.textContent === 'Eaon')?.click()`);
await sleep(300);
check('data-theme reset', await ev(`document.documentElement.getAttribute('data-theme')`), null);
await ev(`document.querySelector('.st-head .icon-btn[aria-label="Close settings"]')?.click()`);
await sleep(400);
check('overlay closed', await ev(`!document.querySelector('.st-overlay')`), true);

console.log(`--- errors (${errors.length}) ---`);
errors.forEach((e) => console.log(e));
console.log(failures === 0 && errors.length === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES, ${errors.length} errors`);
ws.close();
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
