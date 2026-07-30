// Smoke test: spawn a PTY over the Eaon WS API, round-trip input/output, then kill.
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8787/ws');
const id = crypto.randomUUID();
let sawEcho = false;
let spawned = false;

const timeout = setTimeout(() => {
  console.error('TIMEOUT — did not see echo output');
  process.exit(1);
}, 8000);

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'list' }));
  ws.send(JSON.stringify({
    t: 'spawn', id, command: '/bin/zsh', args: [], cwd: process.cwd(), cols: 90, rows: 30, title: 'smoke',
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.t === 'sessions') console.log('sessions:', msg.sessions.length);
  if (msg.t === 'spawned') {
    spawned = true;
    console.log('spawned pid:', msg.session.pid);
    ws.send(JSON.stringify({ t: 'input', id, data: 'echo EAON_$((40+2))_OK\r' }));
  }
  if (msg.t === 'output' && msg.id === id) {
    if (msg.data.includes('EAON_42_OK')) {
      sawEcho = true;
      console.log('round-trip OK: saw EAON_42_OK');
      ws.send(JSON.stringify({ t: 'resize', id, cols: 120, rows: 40 }));
      ws.send(JSON.stringify({ t: 'attach', id }));
    }
  }
  if (msg.t === 'replay' && msg.id === id) {
    console.log('replay bytes:', msg.data.length, '| contains marker:', msg.data.includes('EAON_42_OK'));
    ws.send(JSON.stringify({ t: 'remove', id }));
  }
  if (msg.t === 'removed') {
    console.log('removed OK | spawn:', spawned, '| echo:', sawEcho);
    clearTimeout(timeout);
    process.exit(spawned && sawEcho ? 0 : 1);
  }
  if (msg.t === 'error') {
    console.error('server error:', msg.message);
    process.exit(1);
  }
});
