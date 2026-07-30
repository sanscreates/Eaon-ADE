/* eaon-memory MCP server — protocol and tool test suite.
   Drives the real bundled server over stdio exactly as an agent CLI would.
   Run: npx tsx scripts/test-memory-mcp.mjs */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from '../server/src/memory/store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = process.env.EAON_TEST_DIR || tmpdir();
const ENTRY = join(ROOT, 'server/dist/memory-mcp.js');

if (!existsSync(ENTRY)) {
  console.error('server/dist/memory-mcp.js missing — run "npm run build:server" first');
  process.exit(1);
}

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
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? `\n      ${String(detail).slice(0, 400)}` : ''}`);
  }
}
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, a === e ? '' : `expected ${e}\n      got      ${a}`);
}

/* ── a minimal MCP stdio client ─────────────────────────────────────────── */

class McpClient {
  constructor(projectPath, { extraArgs = [], env = {} } = {}) {
    this.proc = spawn(process.execPath, [ENTRY, '--project', projectPath, ...extraArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutRaw = '';
    this.stderr = '';
    this.unsolicited = [];
    this.buffer = '';
    this.exited = null;

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.stdoutRaw += chunk;
      this.buffer += chunk;
      let nl = this.buffer.indexOf('\n');
      while (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.#receive(line);
        nl = this.buffer.indexOf('\n');
      }
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => (this.stderr += chunk));
    this.proc.on('exit', (code) => {
      this.exited = code;
      for (const { reject } of this.pending.values()) reject(new Error(`server exited (${code})`));
      this.pending.clear();
    });
  }

  #receive(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.unsolicited.push({ malformed: line });
      return;
    }
    const waiter = msg.id !== undefined && msg.id !== null ? this.pending.get(msg.id) : null;
    if (waiter) {
      this.pending.delete(msg.id);
      waiter.resolve(msg);
    } else {
      this.unsolicited.push(msg);
    }
  }

  /** Send a request and wait for its response. */
  request(method, params, { timeout = 8000 } = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }
      }, timeout).unref?.();
    });
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return promise;
  }

  /** Fire-and-forget: notifications must never be answered. */
  notify(method, params) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  raw(text) {
    this.proc.stdin.write(text);
  }

  /** Wait for a response to an id we constructed by hand. */
  waitForId(id, timeout = 4000) {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout waiting for id ${id}`));
        }
      }, timeout).unref?.();
    });
  }

  async callTool(name, args) {
    const res = await this.request('tools/call', { name, arguments: args });
    return res;
  }

  /** The text a tool returned, which is what the model would actually read. */
  async toolText(name, args) {
    const res = await this.callTool(name, args);
    if (res.error) return `RPC ERROR: ${res.error.message}`;
    return (res.result?.content ?? []).map((c) => c.text ?? '').join('\n');
  }

  async handshake(clientName = 'test-harness', protocolVersion = '2025-06-18') {
    const res = await this.request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0.0' },
    });
    this.notify('notifications/initialized');
    return res;
  }

  close() {
    this.proc.stdin.end();
  }

  kill() {
    try {
      this.proc.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

const projects = [];
function newProject(tag) {
  const dir = mkdtempSync(join(SCRATCH, `eaon-mcp-${tag}-`));
  projects.push(dir);
  return dir;
}

const clients = [];
function connect(projectPath, opts) {
  const client = new McpClient(projectPath, opts);
  clients.push(client);
  return client;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Handshake
   ═══════════════════════════════════════════════════════════════════════════ */

describe('1. initialize handshake');

const projA = newProject('a');
const a = connect(projA);

const init = await a.handshake('claude-code');
eq('responds with jsonrpc 2.0', init.jsonrpc, '2.0');
ok('no error on initialize', !init.error, JSON.stringify(init.error));
eq('echoes the requested protocol version', init.result.protocolVersion, '2025-06-18');
eq('advertises tools capability', typeof init.result.capabilities.tools, 'object');
eq('names itself', init.result.serverInfo.name, 'eaon-memory');
ok('reports a version', /^\d+\.\d+\.\d+$/.test(init.result.serverInfo.version));
ok('sends usage instructions', init.result.instructions.length > 100);
ok('instructions name the memory folder', init.result.instructions.includes('.eaon'));

await new Promise((r) => setTimeout(r, 120));
eq('the initialized notification is not answered', a.unsolicited.length, 0);

const older = connect(newProject('old'));
const initOld = await older.handshake('gemini-cli', '2024-11-05');
eq('an older protocol version is honoured', initOld.result.protocolVersion, '2024-11-05');

const bogus = connect(newProject('bogus'));
const initBogus = await bogus.handshake('mystery', '1999-01-01');
eq('an unknown protocol version falls back to the newest', initBogus.result.protocolVersion, '2025-06-18');

/* ═══════════════════════════════════════════════════════════════════════════
   2. tools/list
   ═══════════════════════════════════════════════════════════════════════════ */

describe('2. tools/list');

const listed = await a.request('tools/list', {});
const tools = listed.result.tools;
const names = tools.map((t) => t.name).sort();

eq(
  'every advertised tool is present',
  names,
  [
    'create_memory',
    'delete_memory',
    'find_backlinks',
    'link_memories',
    'list_memories',
    'memory_graph',
    'read_memory',
    'search_memories',
    'suggest_connections',
    'update_memory',
  ],
);
ok('the four headline tools exist', ['create_memory', 'search_memories', 'find_backlinks', 'suggest_connections'].every((n) => names.includes(n)));
ok('every tool has a description', tools.every((t) => typeof t.description === 'string' && t.description.length > 40));
ok('every tool has an object input schema', tools.every((t) => t.inputSchema?.type === 'object'));
ok('every tool has a properties block', tools.every((t) => typeof t.inputSchema.properties === 'object'));
ok(
  'required fields all exist in properties',
  tools.every((t) => (t.inputSchema.required ?? []).every((r) => r in t.inputSchema.properties)),
);
ok('schemas are JSON-serialisable', (() => { try { JSON.parse(JSON.stringify(tools)); return true; } catch { return false; } })());
eq('create_memory requires a title', tools.find((t) => t.name === 'create_memory').inputSchema.required, ['title']);
eq('link_memories requires from and to', tools.find((t) => t.name === 'link_memories').inputSchema.required, ['from', 'to']);
ok('suggest_connections requires nothing', !tools.find((t) => t.name === 'suggest_connections').inputSchema.required);

/* ═══════════════════════════════════════════════════════════════════════════
   3. The four headline tools
   ═══════════════════════════════════════════════════════════════════════════ */

describe('3. create_memory');

const created = await a.callTool('create_memory', {
  title: 'Session replay buffer',
  content: 'Each PTY keeps a rolling scrollback so reattaching a pane can replay it. See [[pty lifecycle]].',
  tags: ['server', 'sessions'],
});
ok('create returns a result', !created.error, JSON.stringify(created.error));
ok('create is not an error result', created.result.isError !== true, JSON.stringify(created.result));
const createdText = created.result.content[0].text;
ok('create reports the id', createdText.includes('session-replay-buffer'));
ok('create reports the tags', createdText.includes('#server'));
ok('create names the unwritten link', createdText.includes('pty-lifecycle'));
ok('the file exists on disk', existsSync(join(store.memoryDir(projA), 'session-replay-buffer.md')));
eq('content type is text', created.result.content[0].type, 'text');

await a.toolText('create_memory', {
  title: 'PTY lifecycle',
  content: 'A pty is spawned per pane and killed with it. Sessions outlive a disconnect.',
  tags: ['server', 'sessions'],
});
await a.toolText('create_memory', {
  title: 'Theme tokens',
  content: 'Every theme redefines the same CSS custom properties; no component rule changes.',
  tags: ['ui'],
});
await a.toolText('create_memory', {
  title: 'Pane divider colour',
  content: 'The divider reads its colour from theme tokens and can be overridden in settings.',
  tags: ['ui'],
});

const missingTitle = await a.callTool('create_memory', { content: 'no title' });
eq('create without a title is an error result', missingTitle.result.isError, true);
ok('the error explains itself', missingTitle.result.content[0].text.includes('title'));

const badId = await a.callTool('create_memory', { title: 'Escape', id: '../../evil' });
eq('an unsafe id is refused', badId.result.isError, true);
ok('the refusal names the problem', badId.result.content[0].text.includes('Invalid memory id'));
ok('nothing escaped the memory folder', !existsSync(join(projA, '..', 'evil.md')));

describe('4. search_memories');

const searchText = await a.toolText('search_memories', { query: 'replay' });
ok('finds the note', searchText.includes('session-replay-buffer'));
ok('marks the matched word', searchText.includes('**'));
ok('tells the model what to do next', searchText.includes('read_memory'));

const tagSearch = await a.toolText('search_memories', { tag: 'ui' });
ok('tag-only search works', tagSearch.includes('theme-tokens') && tagSearch.includes('pane-divider-colour'));
ok('tag search excludes other tags', !tagSearch.includes('session-replay-buffer'));

eq('AND is the default', (await a.toolText('search_memories', { query: 'replay theme' })).includes('No memories matched'), true);
ok('match:any relaxes it', !(await a.toolText('search_memories', { query: 'replay theme', match: 'any' })).includes('No memories matched'));

const noHits = await a.toolText('search_memories', { query: 'zzzznothing' });
ok('a miss says how big the graph is', /holds 4 notes/.test(noHits));
ok('a miss suggests a way forward', noHits.includes('broader query'));

const emptySearch = await a.callTool('search_memories', {});
eq('search with no arguments is an error result', emptySearch.result.isError, true);

describe('5. find_backlinks');

const backText = await a.toolText('find_backlinks', { id: 'pty-lifecycle' });
ok('lists the referring note', backText.includes('session-replay-buffer'));
ok('quotes the referring line', backText.includes('rolling scrollback'));

const noBack = await a.toolText('find_backlinks', { id: 'theme-tokens' });
ok('says plainly when nothing links in', noBack.includes('Nothing links to this note yet'));
ok('points at suggest_connections', noBack.includes('suggest_connections'));

ok('accepts a title instead of an id', (await a.toolText('find_backlinks', { id: 'PTY lifecycle' })).includes('session-replay-buffer'));
const backMissing = await a.callTool('find_backlinks', { id: 'no-such-note' });
eq('unknown note is an error result', backMissing.result.isError, true);
ok('the error suggests how to find the id', backMissing.result.content[0].text.includes('search_memories'));

describe('6. suggest_connections');

const suggestText = await a.toolText('suggest_connections', { id: 'theme-tokens' });
ok('suggests the related UI note', suggestText.includes('pane-divider-colour'));
ok('explains why', suggestText.includes('#ui') || suggestText.includes('overlapping terms'));
ok('points at link_memories', suggestText.includes('link_memories'));

const globalSuggest = await a.toolText('suggest_connections', {});
ok('global mode works with no arguments', globalSuggest.includes('→'));

const suggestMissing = await a.callTool('suggest_connections', { id: 'nope' });
eq('unknown id is an error result', suggestMissing.result.isError, true);

/* ═══════════════════════════════════════════════════════════════════════════
   7. The supporting tools
   ═══════════════════════════════════════════════════════════════════════════ */

describe('7. read / update / list / link / graph / delete');

const readText = await a.toolText('read_memory', { id: 'session-replay-buffer' });
ok('read returns the body', readText.includes('rolling scrollback'));
ok('read reports outgoing links', readText.includes('links to: pty-lifecycle'));
ok('read reports the file path', readText.includes('.eaon'));
eq('read of a missing note errors', (await a.callTool('read_memory', { id: 'nope' })).result.isError, true);

const appended = await a.toolText('update_memory', { id: 'theme-tokens', append: 'Light themes flip the neutral ramp.' });
ok('update succeeds', appended.includes('Updated memory'));
ok('append lands in the file', readFileSync(join(store.memoryDir(projA), 'theme-tokens.md'), 'utf8').includes('flip the neutral ramp'));

const retagged = await a.toolText('update_memory', { id: 'theme-tokens', tags: ['ui', 'theming'] });
ok('tags can be replaced', retagged.includes('#theming'));

const emptyUpdate = await a.callTool('update_memory', { id: 'theme-tokens' });
eq('an update with nothing to change errors', emptyUpdate.result.isError, true);

const listText = await a.toolText('list_memories', {});
ok('list shows all four', ['session-replay-buffer', 'pty-lifecycle', 'theme-tokens', 'pane-divider-colour'].every((id) => listText.includes(id)));
ok('list summarises the graph', listText.includes('links'));
ok('list can filter by tag', (await a.toolText('list_memories', { tag: 'ui' })).includes('pane-divider-colour'));
ok('an unknown tag lists the real ones', (await a.toolText('list_memories', { tag: 'nope' })).includes('Tags in use'));

const linkText = await a.toolText('link_memories', { from: 'theme-tokens', to: 'pane-divider-colour' });
ok('link succeeds', linkText.includes('Linked theme-tokens'));
ok('the wikilink is in the file', readFileSync(join(store.memoryDir(projA), 'theme-tokens.md'), 'utf8').includes('[[pane-divider-colour]]'));
ok('linking again is a no-op', (await a.toolText('link_memories', { from: 'theme-tokens', to: 'pane-divider-colour' })).includes('already links'));
eq('link with a missing target errors', (await a.callTool('link_memories', { from: 'theme-tokens', to: 'nope' })).result.isError, true);
eq('link with no arguments errors', (await a.callTool('link_memories', {})).result.isError, true);

await a.toolText('create_memory', { title: 'Points nowhere', content: 'Depends on [[a note nobody wrote]].' });
const graphText = await a.toolText('memory_graph', {});
ok('graph reports totals', /5 notes/.test(graphText));
ok('graph lists hubs', graphText.includes('Most connected'));
ok('graph lists notes nothing links to', graphText.includes('Nothing links to these'));
ok('graph lists unwritten targets', graphText.includes('Referenced but never written'));
ok('and names the missing one', graphText.includes('a-note-nobody-wrote'));
await a.toolText('delete_memory', { id: 'points-nowhere' });

const deleted = await a.toolText('delete_memory', { id: 'pane-divider-colour' });
ok('delete reports what went', deleted.includes('Deleted pane-divider-colour'));
ok('delete warns about dangling references', deleted.includes('still reference it'));
ok('the file is gone', !existsSync(join(store.memoryDir(projA), 'pane-divider-colour.md')));
eq('delete needs an exact id', (await a.callTool('delete_memory', { id: 'Theme Tokens' })).result.isError, true);
eq('delete of a missing note errors', (await a.callTool('delete_memory', { id: 'nope' })).result.isError, true);

/* ═══════════════════════════════════════════════════════════════════════════
   8. Protocol robustness
   ═══════════════════════════════════════════════════════════════════════════ */

describe('8. protocol robustness');

const pong = await a.request('ping', {});
eq('ping returns an empty result', pong.result, {});

const unknown = await a.request('totally/unknown', {});
eq('unknown method returns method-not-found', unknown.error.code, -32601);
ok('the error names the method', unknown.error.message.includes('totally/unknown'));

const unknownTool = await a.request('tools/call', { name: 'no_such_tool', arguments: {} });
eq('unknown tool is an invalid-params error', unknownTool.error.code, -32602);
ok('the error lists the real tools', unknownTool.error.message.includes('create_memory'));

eq('resources/list returns an empty list', (await a.request('resources/list', {})).result, { resources: [] });
eq('prompts/list returns an empty list', (await a.request('prompts/list', {})).result, { prompts: [] });
eq('resource templates return an empty list', (await a.request('resources/templates/list', {})).result, { resourceTemplates: [] });

// Malformed JSON must produce a parse error, not a dead server.
const before = a.unsolicited.length;
a.raw('{ this is not json }\n');
await new Promise((r) => setTimeout(r, 200));
const parseErr = a.unsolicited.slice(before).find((m) => m.error?.code === -32700);
ok('malformed JSON returns a parse error', !!parseErr, JSON.stringify(a.unsolicited.slice(before)));
eq('parse errors carry a null id', parseErr?.id, null);
ok('the server is still alive afterwards', (await a.request('ping', {})).result !== undefined);

// A frame split across two writes must still be understood.
const splitId = 90001;
const splitPromise = a.waitForId(splitId);
a.raw(`{"jsonrpc":"2.0","id":${splitId},"method":"too`);
await new Promise((r) => setTimeout(r, 60));
a.raw('ls/list","params":{}}\n');
const splitRes = await splitPromise;
ok('a message split across writes is reassembled', Array.isArray(splitRes.result?.tools));

// Two frames arriving in one write.
const idA = 90002;
const idB = 90003;
const pairA = a.waitForId(idA);
const pairB = a.waitForId(idB);
a.raw(
  `${JSON.stringify({ jsonrpc: '2.0', id: idA, method: 'ping' })}\n${JSON.stringify({ jsonrpc: '2.0', id: idB, method: 'ping' })}\n`,
);
await Promise.all([pairA, pairB]);
ok('two frames in one write both get answers', true);

// A JSON-RPC batch (dropped from the newest spec, still sent by older clients).
const batchA = 90004;
const batchB = 90005;
const bA = a.waitForId(batchA);
const bB = a.waitForId(batchB);
a.raw(
  `${JSON.stringify([
    { jsonrpc: '2.0', id: batchA, method: 'ping' },
    { jsonrpc: '2.0', id: batchB, method: 'tools/list', params: {} },
  ])}\n`,
);
await Promise.all([bA, bB]);
ok('a batch is unpacked and answered', true);

// Notifications are never answered.
const beforeNotify = a.unsolicited.length;
a.notify('notifications/cancelled', { requestId: 1 });
a.notify('notifications/progress', { progressToken: 'x', progress: 1 });
a.notify('some/unknown/notification', {});
await new Promise((r) => setTimeout(r, 200));
eq('notifications produce no response', a.unsolicited.length, beforeNotify);

// A stray response frame from the client must be ignored, not echoed.
a.raw(`${JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} })}\n`);
await new Promise((r) => setTimeout(r, 150));
eq('a response frame is ignored', a.unsolicited.length, beforeNotify);

// Non-object arguments must not crash the tool layer.
const weirdArgs = await a.request('tools/call', { name: 'list_memories', arguments: 'not an object' });
ok('string arguments degrade to empty', !weirdArgs.error && weirdArgs.result.content[0].text.length > 0);
const nullArgs = await a.request('tools/call', { name: 'list_memories' });
ok('omitted arguments are fine', !nullArgs.error);
const arrayArgs = await a.request('tools/call', { name: 'list_memories', arguments: [1, 2, 3] });
ok('array arguments degrade to empty', !arrayArgs.error);

// Wrong-typed fields must not throw.
const numericTitle = await a.callTool('create_memory', { title: 12345, tags: 'a,b', content: 99 });
ok('numbers coerce rather than crash', numericTitle.result.isError !== true, JSON.stringify(numericTitle.result));

// Blank lines between frames.
a.raw('\n\n\n');
await new Promise((r) => setTimeout(r, 100));
ok('blank input lines are ignored', (await a.request('ping', {})).result !== undefined);

// Nothing but JSON-RPC on stdout.
const stdoutLines = a.stdoutRaw.split('\n').filter((l) => l.trim());
ok(
  'stdout carries only JSON-RPC frames',
  stdoutLines.every((l) => {
    try {
      return JSON.parse(l).jsonrpc === '2.0';
    } catch {
      return false;
    }
  }),
  stdoutLines.find((l) => { try { return JSON.parse(l).jsonrpc !== '2.0'; } catch { return true; } }),
);
ok('diagnostics went to stderr', a.stderr.includes('eaon-memory'));

// A big payload round-trips.
const bigBody = 'A finding worth keeping. '.repeat(4000);
const bigCreate = await a.callTool('create_memory', { title: 'Big note', content: bigBody });
ok('a 100kb note is accepted', bigCreate.result.isError !== true);
ok('and reads back in full', (await a.toolText('read_memory', { id: 'big-note' })).length > 90000);

/* ═══════════════════════════════════════════════════════════════════════════
   9. Shared memory across agents
   ═══════════════════════════════════════════════════════════════════════════ */

describe('9. shared memory across agents');

const shared = newProject('shared');
const agent1 = connect(shared);
const agent2 = connect(shared);
await agent1.handshake('claude-code');
await agent2.handshake('codex');

await agent1.toolText('create_memory', {
  title: 'Deploy pipeline',
  content: 'Builds run on tag push. Artifacts land in the release bucket.',
  tags: ['ops'],
});

const seenByTwo = await agent2.toolText('search_memories', { query: 'deploy' });
ok("agent two sees agent one's note immediately", seenByTwo.includes('deploy-pipeline'));

await agent2.toolText('create_memory', {
  title: 'Release bucket',
  content: 'Versioned, lifecycle-expired after 90 days. Written by [[deploy-pipeline]].',
  tags: ['ops'],
});

const backFromOne = await agent1.toolText('find_backlinks', { id: 'deploy-pipeline' });
ok("agent one sees agent two's backlink", backFromOne.includes('release-bucket'));

const whoWrote = readFileSync(join(store.memoryDir(shared), 'deploy-pipeline.md'), 'utf8');
ok('the note records which agent wrote it', whoWrote.includes('source: claude-code'), whoWrote.slice(0, 200));
ok('the second note records its own author', readFileSync(join(store.memoryDir(shared), 'release-bucket.md'), 'utf8').includes('source: codex'));

// The UI writes through the same store — the third participant.
store.createNote(shared, { title: 'Rollback plan', content: 'Re-tag the previous release. See [[deploy-pipeline]].', source: 'you' });
const seesUiNote = await agent1.toolText('list_memories', {});
ok('agents see notes written by the app itself', seesUiNote.includes('rollback-plan'));

const graphAll = await agent2.toolText('memory_graph', {});
ok('the graph counts every writer’s notes', /3 notes/.test(graphAll));

// And a link made by one agent is visible to the other.
await agent1.toolText('link_memories', { from: 'release-bucket', to: 'rollback-plan' });
ok(
  'a link made by one agent shows as a backlink to the other',
  (await agent2.toolText('find_backlinks', { id: 'rollback-plan' })).includes('release-bucket'),
);

/* ═══════════════════════════════════════════════════════════════════════════
   10. Process lifecycle
   ═══════════════════════════════════════════════════════════════════════════ */

describe('10. process lifecycle');

const lifecycle = connect(newProject('life'));
await lifecycle.handshake();
lifecycle.close();
const exitCode = await new Promise((resolve) => {
  lifecycle.proc.on('exit', resolve);
  setTimeout(() => resolve('timeout'), 4000);
});
eq('closing stdin exits cleanly', exitCode, 0);

const badProject = spawn(process.execPath, [ENTRY, '--project', join(SCRATCH, 'definitely-not-there')], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let badStderr = '';
badProject.stderr.on('data', (d) => (badStderr += String(d)));
const badExit = await new Promise((resolve) => {
  badProject.on('exit', resolve);
  setTimeout(() => resolve('timeout'), 4000);
});
eq('a bad project path exits with a distinct code', badExit, 2);
ok('and says why on stderr', badStderr.includes('not a directory'));

/** Wait for the server to announce which folder it is serving. Polling beats a
 *  fixed sleep here: node's own start-up cost swings by hundreds of ms. */
function announcedFolder(proc, timeout = 10000) {
  return new Promise((resolve) => {
    let seen = '';
    const done = setTimeout(() => resolve(seen), timeout);
    proc.stderr.on('data', (chunk) => {
      seen += String(chunk);
      if (seen.includes('serving')) {
        clearTimeout(done);
        resolve(seen);
      }
    });
  });
}

// The project can also come from the environment, which is how some clients
// prefer to configure a server.
const envProject = newProject('env');
const envClient = spawn(process.execPath, [ENTRY], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, EAON_MEMORY_PROJECT: envProject },
});
const envStderr = await announcedFolder(envClient);
ok('EAON_MEMORY_PROJECT is honoured', envStderr.includes(envProject), envStderr);
envClient.kill();

// --project=value form.
const eqForm = spawn(process.execPath, [ENTRY, `--project=${projA}`], { stdio: ['pipe', 'pipe', 'pipe'] });
const eqStderr = await announcedFolder(eqForm);
ok('--project=value is honoured', eqStderr.includes(projA), eqStderr);
eqForm.kill();

// No project at all falls back to the working directory, so a bare
// `node eaon-memory-mcp.mjs` from inside a repo still does the right thing.
const cwdProject = newProject('cwd');
const cwdForm = spawn(process.execPath, [ENTRY], { stdio: ['pipe', 'pipe', 'pipe'], cwd: cwdProject, env: {} });
const cwdStderr = await announcedFolder(cwdForm);
ok('no arguments falls back to cwd', cwdStderr.includes(cwdProject), cwdStderr);
cwdForm.kill();

/* ── report ─────────────────────────────────────────────────────────────── */

for (const client of clients) client.kill();
await new Promise((r) => setTimeout(r, 200));
for (const dir of projects) rmSync(dir, { recursive: true, force: true });

console.log(`\n${'─'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`\x1b[32m✓ all ${passed} assertions passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m✗ ${failures.length} failed, ${passed} passed\x1b[0m\n`);
for (const f of failures) console.log(`  • ${f}`);
process.exit(1);
