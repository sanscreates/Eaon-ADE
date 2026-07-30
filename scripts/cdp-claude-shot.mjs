// CDP screenshots: usage popover + appearance Claude group.
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
let mid = 0;
const pending = new Map();
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
  }
});
await new Promise((r) => ws.on('open', r));
const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return res.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(file) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('saved', file);
}

await send('Page.enable');

// 1. Popover with the account switcher expanded.
const panelOpen = await ev(`!!document.querySelector('.cu-panel')`);
if (!panelOpen) {
  await ev(`document.querySelector('.cu-pill')?.click()`);
  await sleep(500);
}
await ev(`document.querySelector('.cu-account')?.click()`);
await sleep(400);
await shot('/tmp/eaon-claude-popover.png');

// 2. Appearance section with the Claude group in view.
await ev(`document.querySelector('.cu-pill')?.click()`);
await sleep(300);
await ev(`document.querySelector('.icon-btn[title^="Settings"]')?.click()`);
await sleep(700);
await ev(`[...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('Appearance'))?.click()`);
await sleep(400);
await ev(`[...document.querySelectorAll('.st-group-label')].find(x => x.textContent === 'Claude')?.scrollIntoView({ block: 'center' })`);
await sleep(700);
await shot('/tmp/eaon-claude-appearance.png');

ws.close();
process.exit(0);
