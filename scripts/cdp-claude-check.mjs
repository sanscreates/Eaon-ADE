// CDP verification: Claude usage pill, account switching, add-account flow.
import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('no debuggable page');
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

console.log('target:', await ev('location.href'));

console.log('--- server API ---');
const accounts = await ev(`fetch('/api/claude/accounts').then(r => r.json())`);
check('accounts endpoint', accounts?.accounts?.length, (n) => n >= 1);
check('system account present', accounts?.accounts?.[0]?.slug, 'system');
check('system has credentials', accounts?.accounts?.[0]?.hasCredentials, true);
const usage = await ev(`fetch('/api/claude/usage?slug=system').then(r => r.json())`);
check('usage endpoint five_hour.utilization', usage?.five_hour?.utilization, (v) => typeof v === 'number');
check('usage endpoint resets_at', usage?.five_hour?.resets_at, (v) => typeof v === 'string');

console.log('--- appearance: Claude group ---');
check('pill hidden by default', await ev(`!!document.querySelector('.cu-pill')`), false);
await ev(`document.querySelector('.icon-btn[title^="Settings"]')?.click()`);
await sleep(700);
await ev(`[...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('Appearance'))?.click()`);
await sleep(400);
check('claude group label', await ev(`[...document.querySelectorAll('.st-group-label')].some(x => x.textContent === 'Claude')`), true);
check('usage switch present', await ev(`!!document.querySelector('.st-switch[aria-label="Toggle Claude token usage"]')`), true);
check('account select present', await ev(`[...document.querySelectorAll('.st-select')].some(s => [...s.options].some(o => o.value === 'system'))`), true);

console.log('--- toggle on → pill appears with real data ---');
await ev(`document.querySelector('.st-switch[aria-label="Toggle Claude token usage"]')?.click()`);
await sleep(2500);
check('pill visible', await ev(`!!document.querySelector('.cu-pill')`), true);
check('pill pct', await ev(`document.querySelector('.cu-pill-pct')?.textContent`), (v) => /^(\d+%|!|…)$/.test(v ?? ''));
await sleep(2000);
check('pill pct after fetch', await ev(`document.querySelector('.cu-pill-pct')?.textContent`), (v) => /^\d+%$/.test(v ?? ''));

console.log('--- popover ---');
await ev(`document.querySelector('.cu-pill')?.click()`);
await sleep(600);
check('popover open', await ev(`!!document.querySelector('.cu-panel')`), true);
check('account name', await ev(`document.querySelector('.cu-account-name')?.textContent`), 'Default');
check('subscription badge', await ev(`document.querySelector('.cu-badge')?.textContent`), (v) => typeof v === 'string' && v.length > 0);
check('usage rows', await ev(`document.querySelectorAll('.cu-row').length`), (n) => n >= 2);
check('reset label', await ev(`document.querySelector('.cu-row-sub')?.textContent`), (v) => /^Resets in /.test(v ?? ''));

// Add-account, switching and session-dialog coverage lives in
// cdp-claude-add.mjs (state-independent sequencing).

console.log('--- cleanup: toggle off ---');
await ev(`document.querySelector('.icon-btn[title^="Settings"]')?.click()`);
await sleep(500);
await ev(`document.querySelector('.st-switch[aria-label="Toggle Claude token usage"]')?.click()`);
await sleep(400);
check('pill hidden after toggle off', await ev(`!!document.querySelector('.cu-pill')`), false);
await ev(`document.querySelector('.st-head .icon-btn[aria-label="Close settings"]')?.click()`);

console.log(`--- errors (${errors.length}) ---`);
errors.forEach((e) => console.log(e));
console.log(failures === 0 && errors.length === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES, ${errors.length} errors`);
ws.close();
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
