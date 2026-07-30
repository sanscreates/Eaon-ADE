// Attach to the running Eaon app via Chrome DevTools Protocol and report
// runtime exceptions, console errors, and key DOM probes.
import WebSocket from 'ws';

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target found');
  process.exit(1);
}
console.log('target:', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let mid = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++mid;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const errors = [];

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(`EXCEPTION: ${d.text} ${d.exception?.description ?? ''}`.slice(0, 600));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    errors.push(`console.${msg.params.type}: ${text}`.slice(0, 400));
  }
});

await new Promise((r) => ws.on('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 5000));

const probe = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return res?.result?.value;
};

console.log('--- DOM probes ---');
console.log('app html length:', await probe(`document.querySelector('.app')?.innerHTML.length ?? 'no .app'`));
console.log('grid state:', await probe(`document.querySelector('.grid-empty') ? 'empty-state' : document.querySelector('.grid-root') ? 'has-grid' : document.querySelector('.leaf') ? 'has-leaf' : 'NONE'`));
console.log('grid-empty visible size:', await probe(`JSON.stringify((e=>e?{w:e.offsetWidth,h:e.offsetHeight}:null)(document.querySelector('.grid-empty')))`));
console.log('main size:', await probe(`JSON.stringify((e=>e?{w:e.offsetWidth,h:e.offsetHeight,display:getComputedStyle(e).display}:null)(document.querySelector('.main')))`));
console.log('right-panel:', await probe(`document.querySelector('.right-panel')?.className ?? 'NONE'`));
console.log('rightTab in storage:', await probe(`localStorage.getItem('eaon.rightTab')`));
console.log('body children:', await probe(`document.getElementById('root')?.children.length`));
console.log('--- errors (' + errors.length + ') ---');
for (const e of errors.slice(0, 12)) console.log(e);

ws.close();
process.exit(0);
