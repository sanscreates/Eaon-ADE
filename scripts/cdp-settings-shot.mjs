// Screenshot the settings page in a few themes via CDP.
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
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`/tmp/${name}.png`, Buffer.from(res.data, 'base64'));
  console.log('saved', name);
};

const openSettings = `(() => { document.querySelector('.icon-btn[title^="Settings"]')?.click(); })()`;
const clickTheme = (name) => `(() => { [...document.querySelectorAll('.st-theme-card')].find(x => x.querySelector('.st-theme-name')?.textContent === '${name}')?.click(); })()`;

await ev(openSettings);
await sleep(800);
await ev(`[...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('Appearance'))?.click()`);
await sleep(400);
await shot('settings-eaon');
await ev(clickTheme('Tokyo Night'));
await sleep(500);
await shot('settings-tokyo');
await ev(clickTheme('Daylight'));
await sleep(500);
await shot('settings-daylight');
await ev(clickTheme('Eaon'));
await sleep(300);
await ev(`(() => { [...document.querySelectorAll('.st-nav-item')].find(x => x.textContent.includes('Agents'))?.click(); })()`);
await sleep(400);
await shot('settings-agents');
await ev(`document.querySelector('.st-head .icon-btn')?.click()`);
ws.close();
process.exit(0);
