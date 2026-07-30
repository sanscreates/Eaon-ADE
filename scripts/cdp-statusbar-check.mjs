// Verify the bottom status bar is gone after removal.
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let mid = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++mid;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
await new Promise((r) => ws.on('open', r));
await send('Runtime.enable');
await send('Page.enable');
const ev = (expression) => send('Runtime.evaluate', { expression, returnByValue: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.reload', { ignoreCache: true });
await sleep(4000);

const checks = [
  ['no .statusbar element', `document.querySelector('.statusbar') === null`],
  ['no statusbar text at bottom', `![...document.querySelectorAll('footer')].some(f => /pane|agent/i.test(f.textContent))`],
  ['app fills window height', `(() => { const m = document.querySelector('.main'); return m && Math.abs(m.getBoundingClientRect().bottom - innerHeight) < 2; })()`],
];
let fail = 0;
for (const [name, expr] of checks) {
  const r = await ev(expr);
  const ok = r?.result?.value === true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fail++;
}
const res = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/no-statusbar.png', Buffer.from(res.data, 'base64'));
console.log('saved /tmp/no-statusbar.png');
ws.close();
process.exit(fail ? 1 : 0);
