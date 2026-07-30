/* Memory knowledge graph — engine + HTTP test suite.
   Run: npx tsx scripts/test-memory.mjs
   Exits non-zero on the first failing assertion group. */

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from '../server/src/memory/store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = process.env.EAON_TEST_DIR || tmpdir();

/* ── tiny harness ───────────────────────────────────────────────────────── */

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
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? `\n      ${detail}` : ''}`);
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, a === e ? '' : `expected ${e}\n      got      ${a}`);
}

function throws(label, fn, match) {
  try {
    fn();
    ok(label, false, 'did not throw');
  } catch (err) {
    const message = String(err?.message ?? err);
    ok(label, !match || message.includes(match), match ? `message was: ${message}` : '');
  }
}

/* ── fixtures ───────────────────────────────────────────────────────────── */

const projects = [];
function newProject(tag) {
  const dir = mkdtempSync(join(SCRATCH, `eaon-mem-${tag}-`));
  projects.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
}

/* ═══════════════════════════════════════════════════════════════════════════
   A. slugs and ids
   ═══════════════════════════════════════════════════════════════════════════ */

describe('A. slugs and id safety');

eq('slugify lowercases and dashes', store.slugify('Auth Flow'), 'auth-flow');
eq('slugify collapses punctuation', store.slugify('Why?! The  server__crashed.'), 'why-the-server-crashed');
eq('slugify strips accents', store.slugify('Café Naïve'), 'cafe-naive');
eq('slugify never returns empty', store.slugify('!!!'), 'note');
eq('slugify handles undefined', store.slugify(undefined), 'note');
ok('slugify caps length', store.slugify('x'.repeat(200)).length <= 80);
ok('slugify has no trailing dash after truncation', !store.slugify(`${'ab '.repeat(40)}`).endsWith('-'));

ok('isSafeId accepts a slug', store.isSafeId('auth-flow'));
ok('isSafeId accepts dots and underscores', store.isSafeId('auth_flow.v2'));
ok('isSafeId rejects traversal', !store.isSafeId('../../etc/passwd'));
ok('isSafeId rejects bare ..', !store.isSafeId('..'));
ok('isSafeId rejects embedded ..', !store.isSafeId('a..b'));
ok('isSafeId rejects slashes', !store.isSafeId('a/b'));
ok('isSafeId rejects backslashes', !store.isSafeId('a\\b'));
ok('isSafeId rejects null bytes', !store.isSafeId('a\0b'));
ok('isSafeId rejects empty', !store.isSafeId(''));
ok('isSafeId rejects leading dash', !store.isSafeId('-x'));
ok('isSafeId rejects non-strings', !store.isSafeId(42));
ok('isSafeId rejects over-long ids', !store.isSafeId('a'.repeat(200)));

/* ═══════════════════════════════════════════════════════════════════════════
   B. create / read round-trip
   ═══════════════════════════════════════════════════════════════════════════ */

describe('B. create and read');

const p1 = newProject('crud');

const n1 = store.createNote(p1, {
  title: 'Auth Flow',
  content: 'Login goes through [[Session Store]] then issues a token.',
  tags: ['Auth', '#backend', 'auth', '  spaced  tag '],
  source: 'you',
});

eq('id is slugified from title', n1.id, 'auth-flow');
ok('file exists on disk', existsSync(n1.file));
ok('file is inside .eaon/memory', n1.file.includes(join('.eaon', 'memory')));
eq('tags normalised and deduped', n1.tags, ['auth', 'backend', 'spaced-tag']);
eq('source recorded', n1.source, 'you');
ok('created and updated are ISO', !Number.isNaN(Date.parse(n1.created)) && !Number.isNaN(Date.parse(n1.updated)));
eq('one outgoing link', n1.links.length, 1);
eq('link is unresolved until the target exists', n1.links[0].resolved, false);
eq('unresolved link targets the slug', n1.links[0].target, 'session-store');
ok('excerpt flattens links', n1.excerpt.includes('Session Store') && !n1.excerpt.includes('[['));

const raw1 = readFileSync(n1.file, 'utf8');
ok('file starts with frontmatter', raw1.startsWith('---\n'));
ok('frontmatter carries the title', raw1.includes('title: Auth Flow'));
ok('frontmatter carries tags inline', raw1.includes('tags: [auth, backend, spaced-tag]'));

const reread = store.getNote(p1, 'auth-flow');
eq('getNote finds it', reread?.id, 'auth-flow');
eq('body survives the round trip', reread?.body.trim(), 'Login goes through [[Session Store]] then issues a token.');

throws('empty title is rejected', () => store.createNote(p1, { title: '   ' }), 'title is required');
throws('unsafe explicit id is rejected', () => store.createNote(p1, { title: 'x', id: '../evil' }), 'Invalid memory id');

const dup = store.createNote(p1, { title: 'Auth Flow', content: 'a second one' });
eq('duplicate title gets a suffixed id', dup.id, 'auth-flow-2');

const explicit = store.createNote(p1, { title: 'Explicit', id: 'my_custom.id-1' });
eq('explicit id honoured', explicit.id, 'my_custom.id-1');

/* ═══════════════════════════════════════════════════════════════════════════
   C. frontmatter edge cases
   ═══════════════════════════════════════════════════════════════════════════ */

describe('C. frontmatter round-trips');

const tricky = [
  ['colon in title', 'Bug: the retry loop'],
  ['quotes in title', 'The "obvious" fix'],
  ['leading dash', '- dashed start'],
  ['hash', '#hashtag title'],
  ['brackets', '[bracketed] title'],
  ['backslash', 'a\\b path'],
  ['unicode', '日本語 タイトル · émoji 🚀'],
  ['single quotes', "it's a 'quoted' thing"],
  ['yaml-ish', 'key: value # comment'],
];

for (const [label, title] of tricky) {
  const note = store.createNote(p1, { title, content: 'body' });
  const back = store.getNote(p1, note.id);
  eq(`${label} survives`, back?.title, title);
}

// A file written by hand, not by us: no frontmatter at all.
const memDir = store.memoryDir(p1);
writeFileSync(join(memDir, 'handwritten.md'), 'Just a plain note that links [[auth-flow]].\n');
store.clearMemoryCache();
const hand = store.getNote(p1, 'handwritten');
ok('note without frontmatter loads', !!hand);
eq('bare note falls back to id for title', hand?.title, 'handwritten');
eq('bare note still parses links', hand?.links[0]?.target, 'auth-flow');
eq('bare note link resolves', hand?.links[0]?.resolved, true);

// CRLF line endings, BOM, and block-list tags — all things a real editor emits.
writeFileSync(
  join(memDir, 'crlf.md'),
  '﻿---\r\ntitle: CRLF note\r\ntags:\r\n  - windows\r\n  - editors\r\n---\r\n\r\nBody with [[auth-flow]].\r\n',
);
store.clearMemoryCache();
const crlf = store.getNote(p1, 'crlf');
eq('CRLF + BOM title parses', crlf?.title, 'CRLF note');
eq('block-list tags parse', crlf?.tags, ['windows', 'editors']);
eq('CRLF body links parse', crlf?.links[0]?.target, 'auth-flow');

writeFileSync(join(memDir, 'quoted.md'), '---\ntitle: "Quoted: with \\"escapes\\""\ntags: ["a b", c]\n---\n\nx\n');
store.clearMemoryCache();
const quoted = store.getNote(p1, 'quoted');
eq('quoted title unescapes', quoted?.title, 'Quoted: with "escapes"');
eq('quoted inline tags parse', quoted?.tags, ['a b', 'c']);

writeFileSync(join(memDir, 'empty.md'), '');
store.clearMemoryCache();
ok('completely empty file does not crash the read', store.listNotes(p1).some((n) => n.id === 'empty'));

/* ═══════════════════════════════════════════════════════════════════════════
   D. links, resolution, backlinks
   ═══════════════════════════════════════════════════════════════════════════ */

describe('D. links and backlinks');

const p2 = newProject('links');

store.createNote(p2, {
  title: 'Session Store',
  content: 'Redis-backed. See [[Auth Flow]] and [[token-refresh|how refresh works]].',
  tags: ['auth', 'infra'],
});
store.createNote(p2, {
  title: 'Auth Flow',
  content: 'Uses [[Session Store]]. Also mentions [[session store]] again, and [[Session Store#redis]].',
  tags: ['auth'],
});
store.createNote(p2, { title: 'Token Refresh', content: 'Refreshes against [[Session Store]].', tags: ['auth'] });

const sess = store.getNote(p2, 'session-store');
eq('resolves a link by title', sess.links.find((l) => l.raw === 'Auth Flow')?.target, 'auth-flow');
eq('title link is resolved', sess.links.find((l) => l.raw === 'Auth Flow')?.resolved, true);
eq('alias is captured', sess.links.find((l) => l.raw === 'token-refresh')?.alias, 'how refresh works');
eq('alias link resolves to the id', sess.links.find((l) => l.raw === 'token-refresh')?.target, 'token-refresh');

const auth = store.getNote(p2, 'auth-flow');
const authTargets = auth.links.map((l) => l.target);
ok('case-insensitive titles collapse to one target', authTargets.every((t) => t === 'session-store'));
ok('heading anchors are stripped from the target', auth.links.every((l) => !l.target.includes('#')));

const back = store.backlinksOf(p2, 'session-store');
eq('backlink count', back.length, 2);
eq('backlinks sorted by title', back.map((b) => b.id), ['auth-flow', 'token-refresh']);
ok('backlink carries context', back[0].context.includes('Uses Session Store'));
ok('backlink context has no wikilink syntax', !back[0].context.includes('[['));

eq('backlinks of an unknown id are empty', store.backlinksOf(p2, 'nope').length, 0);

// Dangling → resolved, retroactively.
const dangling = store.createNote(p2, { title: 'Rate Limiting', content: 'Depends on [[Redis Config]].' });
eq('link to a missing note is unresolved', dangling.links[0].resolved, false);
const ghostGraph = store.buildGraph(p2);
ok('missing target appears as a ghost node', ghostGraph.nodes.some((n) => n.id === 'redis-config' && n.missing));

store.createNote(p2, { title: 'Redis Config', content: 'maxmemory 2gb' });
const healed = store.getNote(p2, 'rate-limiting');
eq('writing the target resolves the old link', healed.links[0].resolved, true);
ok('ghost node is gone from the graph', !store.buildGraph(p2).nodes.some((n) => n.id === 'redis-config' && n.missing));

// Self-links must not create a self-edge in the graph.
store.createNote(p2, { title: 'Self Ref', id: 'self-ref', content: 'I am [[self-ref]].' });
ok('self-link produces no self edge', !store.buildGraph(p2).edges.some((e) => e.source === e.target));

/* ═══════════════════════════════════════════════════════════════════════════
   E. update / delete / link
   ═══════════════════════════════════════════════════════════════════════════ */

describe('E. update, delete, link');

const p3 = newProject('mutate');
const a = store.createNote(p3, { title: 'Alpha', content: 'first', tags: ['x'] });
const b = store.createNote(p3, { title: 'Beta', content: 'second', tags: ['y'] });

await new Promise((r) => setTimeout(r, 8));
const appended = store.updateNote(p3, 'alpha', { append: 'appended line' });
ok('append keeps the original body', appended.body.includes('first'));
ok('append adds the new text', appended.body.includes('appended line'));
eq('append preserves created', appended.created, a.created);
ok('append bumps updated', Date.parse(appended.updated) >= Date.parse(a.updated));
eq('append preserves tags', appended.tags, ['x']);

const replaced = store.updateNote(p3, 'alpha', { content: 'wholly new' });
eq('content replaces the body', replaced.body.trim(), 'wholly new');

const retitled = store.updateNote(p3, 'alpha', { title: 'Alpha Prime', tags: ['x', 'z'] });
eq('title updates', retitled.title, 'Alpha Prime');
eq('tags update', retitled.tags, ['x', 'z']);
eq('id does not change with the title', retitled.id, 'alpha');
throws('update of a missing note throws', () => store.updateNote(p3, 'ghost', { append: 'x' }), 'No memory with id');

const linked = store.linkNotes(p3, 'alpha', 'beta');
eq('link is new', linked.alreadyLinked, false);
ok('link lands in the markdown', linked.from.body.includes('[[beta]]'));
eq('link resolves', linked.from.links.some((l) => l.target === 'beta' && l.resolved), true);

const again = store.linkNotes(p3, 'alpha', 'beta');
eq('linking twice is a no-op', again.alreadyLinked, true);
eq('no duplicate Related lines', (again.from.body.match(/Related:/g) ?? []).length, 1);

const c = store.createNote(p3, { title: 'Gamma' });
store.linkNotes(p3, 'alpha', 'gamma');
eq('second link joins the same Related line', (store.getNote(p3, 'alpha').body.match(/Related:/g) ?? []).length, 1);
eq('both links present', store.getNote(p3, 'alpha').links.filter((l) => l.resolved).length, 2);

throws('self-link is refused', () => store.linkNotes(p3, 'alpha', 'alpha'), 'cannot link to itself');
throws('link from a missing note throws', () => store.linkNotes(p3, 'nope', 'beta'), 'No memory matching');
throws('link to a missing note throws', () => store.linkNotes(p3, 'alpha', 'nope'), 'No memory matching');

ok('link accepts a title as well as an id', store.linkNotes(p3, 'beta', 'Gamma').from.body.includes('[[gamma]]'));

eq('delete returns true', store.deleteNote(p3, 'gamma'), true);
eq('deleted note is gone', store.getNote(p3, 'gamma'), null);
eq('delete of a missing note returns false', store.deleteNote(p3, 'gamma'), false);
eq('links to a deleted note go dangling', store.getNote(p3, 'alpha').links.find((l) => l.target === 'gamma')?.resolved, false);

ok('no temp files left behind', !readdirSync(store.memoryDir(p3)).some((f) => f.includes('.tmp')));

/* ═══════════════════════════════════════════════════════════════════════════
   F. search
   ═══════════════════════════════════════════════════════════════════════════ */

describe('F. search');

const p4 = newProject('search');
store.createNote(p4, {
  title: 'Websocket reconnect',
  content: 'The client backs off exponentially when the socket drops. Reconnect delay caps at five seconds.',
  tags: ['transport', 'client'],
});
store.createNote(p4, {
  title: 'PTY session lifecycle',
  content: 'Sessions are spawned per pane. Killing a pane kills the pty. Replay buffer is capped.',
  tags: ['server', 'sessions'],
});
store.createNote(p4, {
  title: 'Replay buffer',
  content: 'Every session keeps a rolling scrollback so a reattach can replay it. Buffer size matters for memory.',
  tags: ['server'],
});

const hitsReconnect = store.searchNotes(p4, 'reconnect');
eq('title match ranks first', hitsReconnect[0]?.id, 'websocket-reconnect');
ok('snippet marks the match', hitsReconnect[0].snippet.includes('**'));

const hitsReplay = store.searchNotes(p4, 'replay');
eq('body matches are found across notes', hitsReplay.length, 2);
eq('the titled one wins', hitsReplay[0].id, 'replay-buffer');

eq('multi-word defaults to AND', store.searchNotes(p4, 'replay websocket').length, 0);
ok('match:any relaxes to OR', store.searchNotes(p4, 'replay websocket', { match: 'any' }).length >= 2);

eq('tag filter narrows', store.searchNotes(p4, 'session', { tag: 'server' }).length, 2);
eq('tag filter excludes', store.searchNotes(p4, 'reconnect', { tag: 'server' }).length, 0);
eq('bare tag filter lists the tag', store.searchNotes(p4, '', { tag: 'server' }).length, 2);
eq('hash prefix on the tag is tolerated', store.searchNotes(p4, '', { tag: '#server' }).length, 2);
eq('unknown tag returns nothing', store.searchNotes(p4, '', { tag: 'nope' }).length, 0);
eq('empty query with no tag returns everything', store.searchNotes(p4, '').length, 3);
eq('nonsense query returns nothing', store.searchNotes(p4, 'zzzzqqq').length, 0);
eq('search is case-insensitive', store.searchNotes(p4, 'RECONNECT')[0]?.id, 'websocket-reconnect');
ok('limit is respected', store.searchNotes(p4, '', { limit: 1 }).length === 1);
ok('limit is clamped, not trusted', store.searchNotes(p4, '', { limit: 99999 }).length === 3);
ok('a regex-special query does not throw', Array.isArray(store.searchNotes(p4, 'a(b[c')));

/* ═══════════════════════════════════════════════════════════════════════════
   G. suggested connections
   ═══════════════════════════════════════════════════════════════════════════ */

describe('G. suggested connections');

const p5 = newProject('suggest');
store.createNote(p5, { title: 'OAuth callback', content: 'The oauth callback validates state and exchanges the code for a token.', tags: ['auth'] });
store.createNote(p5, { title: 'Token storage', content: 'Tokens are stored encrypted. Token rotation happens on refresh.', tags: ['auth'] });
store.createNote(p5, { title: 'CSS grid layout', content: 'The pane grid uses nested flexbox with a resizable divider.', tags: ['ui'] });
store.createNote(p5, { title: 'Divider colours', content: 'The resizable divider takes its colour from the theme tokens.', tags: ['ui'] });

const forOauth = store.suggestConnections(p5, 'oauth-callback');
ok('suggests something', forOauth.length > 0);
eq('top suggestion is the same-topic note', forOauth[0].id, 'token-storage');
ok('suggestion explains itself', forOauth[0].reasons.length > 0);
ok('reason mentions the shared tag', forOauth[0].reasons.join(' ').includes('#auth'));
ok('never suggests itself', forOauth.every((s) => s.id !== 'oauth-callback'));

store.linkNotes(p5, 'oauth-callback', 'token-storage');
ok('already-linked notes stop being suggested', store.suggestConnections(p5, 'oauth-callback').every((s) => s.id !== 'token-storage'));

const global = store.suggestConnections(p5, null, 5);
ok('global mode returns pairs', global.length > 0);
ok('global pairs are not already linked', global.every((s) => !(s.from === 'oauth-callback' && s.id === 'token-storage')));
ok('global pairs are deduped by direction', new Set(global.map((s) => [s.from, s.id].sort().join('|'))).size === global.length);
ok('ui notes pair with each other', global.some((s) => [s.from, s.id].sort().join('|') === 'css-grid-layout|divider-colours'));

throws('suggest for an unknown note throws', () => store.suggestConnections(p5, 'nope'), 'No memory matching');
eq('empty project suggests nothing', store.suggestConnections(newProject('empty'), null).length, 0);
ok('limit is honoured', store.suggestConnections(p5, null, 1).length <= 1);

/* ═══════════════════════════════════════════════════════════════════════════
   H. graph and stats
   ═══════════════════════════════════════════════════════════════════════════ */

describe('H. graph and stats');

const p6 = newProject('graph');
store.createNote(p6, { title: 'A', id: 'a', content: 'links [[b]] and [[c]]' });
store.createNote(p6, { title: 'B', id: 'b', content: 'links back to [[a]]' });
store.createNote(p6, { title: 'C', id: 'c', content: 'no links out, but points at [[missing-one]]' });
store.createNote(p6, { title: 'D', id: 'd', content: 'an island' });

const graph = store.buildGraph(p6);
eq('node count includes the ghost', graph.nodes.length, 5);
eq('real nodes', graph.nodes.filter((n) => !n.missing).length, 4);
eq('edge count', graph.edges.length, 4);
ok('a↔b is mutual', graph.edges.find((e) => e.source === 'a' && e.target === 'b')?.mutual === true);
ok('a→c is not mutual', graph.edges.find((e) => e.source === 'a' && e.target === 'c')?.mutual === false);
eq('degree counts both directions', graph.nodes.find((n) => n.id === 'a').degree, 3);
eq('island has degree zero', graph.nodes.find((n) => n.id === 'd').degree, 0);
ok('ghost node is flagged', graph.nodes.find((n) => n.id === 'missing-one')?.missing === true);

const stats = store.statsOf(p6);
eq('note count excludes ghosts', stats.notes, 4);
eq('link count', stats.links, 4);
eq('dangling count', stats.dangling, 1);
eq('orphan count', stats.orphans, 1);
ok('stats reports the directory', stats.dir.endsWith(join('.eaon', 'memory')));

eq('tags list is empty here', store.tagsOf(p6).length, 0);
eq('tags are counted and ranked', store.tagsOf(p4).map((t) => `${t.tag}:${t.count}`), ['server:2', 'client:1', 'sessions:1', 'transport:1']);

/* ═══════════════════════════════════════════════════════════════════════════
   I. shared access — external writers
   ═══════════════════════════════════════════════════════════════════════════ */

describe('I. shared access across writers');

const p7 = newProject('shared');
store.createNote(p7, { title: 'First', content: 'one' });
eq('one note to start', store.listNotes(p7).length, 1);

// Simulate another agent's process writing directly into the folder.
writeFileSync(
  join(store.memoryDir(p7), 'from-another-agent.md'),
  '---\ntitle: From another agent\ntags: [shared]\n---\n\nWritten by somebody else, links [[first]].\n',
);
const afterExternal = store.listNotes(p7);
eq('external write is picked up without a restart', afterExternal.length, 2);
eq('external note resolves its link', store.getNote(p7, 'from-another-agent').links[0].resolved, true);
eq('external note shows up as a backlink', store.backlinksOf(p7, 'first').length, 1);

// Same-size rewrite in the same millisecond is the case a coarse cache misses.
const target = join(store.memoryDir(p7), 'from-another-agent.md');
const before = readFileSync(target, 'utf8');
writeFileSync(target, before.replace('Written by somebody else', 'Rewritten by somebody ELSE'));
ok(
  'same-length rewrite is detected',
  store.getNote(p7, 'from-another-agent').body.includes('Rewritten'),
  store.getNote(p7, 'from-another-agent').body,
);

// Deleting behind our back.
rmSync(target);
eq('external delete is picked up', store.listNotes(p7).length, 1);

// A directory inside the memory folder must not be read as a note.
mkdirSync(join(store.memoryDir(p7), 'subdir.md'), { recursive: true });
eq('a directory named *.md is ignored', store.listNotes(p7).length, 1);

// Dot-files are editor scratch, not notes.
writeFileSync(join(store.memoryDir(p7), '.hidden.md'), '---\ntitle: hidden\n---\nx\n');
eq('dotfiles are ignored', store.listNotes(p7).length, 1);

// Non-markdown files are left alone.
writeFileSync(join(store.memoryDir(p7), 'notes.txt'), 'not a note');
eq('non-markdown files are ignored', store.listNotes(p7).length, 1);

/* ═══════════════════════════════════════════════════════════════════════════
   J. missing / hostile inputs
   ═══════════════════════════════════════════════════════════════════════════ */

describe('J. missing and hostile inputs');

const noMemoryDir = newProject('bare');
eq('project with no memory folder lists nothing', store.listNotes(noMemoryDir).length, 0);
eq('stats on an empty project', store.statsOf(noMemoryDir).notes, 0);
eq('graph on an empty project', store.buildGraph(noMemoryDir).nodes.length, 0);
eq('search on an empty project', store.searchNotes(noMemoryDir, 'x').length, 0);

eq('getNote with an unsafe id returns null', store.getNote(p1, '../../../etc/passwd'), null);
eq('getNote with an empty id returns null', store.getNote(p1, ''), null);
eq('resolveNote with nonsense returns null', store.resolveNote(p1, 'definitely not here'), null);

const huge = store.createNote(p1, { title: 'Huge', content: 'x'.repeat(200000) });
eq('a large note round-trips', store.getNote(p1, huge.id).body.length, 200000);
ok('excerpt is capped', store.getNote(p1, huge.id).excerpt.length <= 221);

const manyTags = store.createNote(p1, { title: 'Tagged', tags: Array.from({ length: 60 }, (_, i) => `t${i}`) });
ok('tag count is capped', manyTags.tags.length <= 24);

const weird = store.createNote(p1, { title: 'Weird links', content: '[[]] [[   ]] [[a|b|c]] [[#only-heading]] [[ok]]' });
ok('empty wikilinks are ignored', weird.links.every((l) => l.target.length > 0));
ok('a heading-only link is dropped', !weird.links.some((l) => l.target === 'note' && l.raw === ''));
ok('extra pipes go to the alias', weird.links.some((l) => l.raw === 'a'));

/* ═══════════════════════════════════════════════════════════════════════════
   K. HTTP API against the real server
   ═══════════════════════════════════════════════════════════════════════════ */

describe('K. HTTP API');

const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const serverEntry = join(ROOT, 'server/dist/index.js');
if (!existsSync(serverEntry)) {
  console.error('\nserver/dist/index.js missing — run "npm run build:server" first');
  process.exit(1);
}

const server = spawn(process.execPath, [serverEntry], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const up = await waitForServer();
ok('server starts', up, serverLog.join(''));

const hp = newProject('http');
const q = (path, params = {}) => {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('project', hp);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
};
const getJson = async (path, params) => {
  const res = await fetch(q(path, params));
  return { status: res.status, body: await res.json() };
};
const send = async (method, path, params, body) => {
  const res = await fetch(q(path, params), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

if (up) {
  const empty = await getJson('/api/memory');
  eq('GET /api/memory on an empty project', empty.body.notes.length, 0);
  eq('stats come back with the list', empty.body.stats.notes, 0);

  const created = await send('POST', '/api/memory', {}, {
    title: 'HTTP note',
    content: 'Created over HTTP, links [[second-note]].',
    tags: ['http', 'test'],
  });
  eq('POST creates', created.status, 200);
  eq('POST returns the note', created.body.note.id, 'http-note');
  eq('POST normalises tags', created.body.note.tags, ['http', 'test']);

  const second = await send('POST', '/api/memory', {}, { title: 'Second note', content: 'points at [[http-note]]' });
  eq('second note created', second.body.note.id, 'second-note');

  const list = await getJson('/api/memory');
  eq('GET lists both', list.body.notes.length, 2);
  ok('list omits bodies', list.body.notes.every((n) => n.body === undefined));
  ok('list carries excerpts', list.body.notes.every((n) => typeof n.excerpt === 'string'));
  eq('tags are aggregated', list.body.tags.length, 2);

  const one = await getJson('/api/memory/note', { id: 'http-note' });
  eq('GET note includes the body', one.body.note.body.includes('Created over HTTP'), true);
  eq('GET note includes backlinks', one.body.backlinks.length, 1);
  ok('GET note includes suggestions', Array.isArray(one.body.suggestions));

  const graphRes = await getJson('/api/memory/graph');
  eq('graph nodes', graphRes.body.nodes.length, 2);
  eq('graph edges', graphRes.body.edges.length, 2);
  ok('graph edges are mutual here', graphRes.body.edges.every((e) => e.mutual));

  const searchRes = await getJson('/api/memory/search', { q: 'HTTP' });
  ok('search finds it', searchRes.body.hits.length >= 1);
  const tagSearch = await getJson('/api/memory/search', { q: '', tag: 'http' });
  eq('tag search works over HTTP', tagSearch.body.hits.length, 1);

  const backRes = await getJson('/api/memory/backlinks', { id: 'http-note' });
  eq('backlinks endpoint', backRes.body.backlinks[0].id, 'second-note');

  const suggestRes = await getJson('/api/memory/suggest');
  ok('global suggest responds', Array.isArray(suggestRes.body.suggestions));

  const updated = await send('PUT', '/api/memory/note', { id: 'http-note' }, { append: 'A new finding.' });
  ok('PUT appends', updated.body.note.body.includes('A new finding.'));

  const linkRes = await send('POST', '/api/memory/link', {}, { from: 'second-note', to: 'http-note' });
  eq('already-linked link is reported', linkRes.body.alreadyLinked, true);

  const where = await getJson('/api/memory/where');
  ok('where reports the directory', where.body.dir.endsWith(join('.eaon', 'memory')));

  const del = await send('DELETE', '/api/memory/note', { id: 'second-note' });
  eq('DELETE works', del.body.ok, true);
  eq('DELETE of a missing note is 404', (await send('DELETE', '/api/memory/note', { id: 'second-note' })).status, 404);

  /* error paths */
  eq('missing project is 400', (await fetch(`${BASE}/api/memory`)).status, 400);
  eq('bad project path is 400', (await fetch(`${BASE}/api/memory?project=/nope/nope/nope`)).status, 400);
  eq('unknown note is 404', (await getJson('/api/memory/note', { id: 'nope' })).status, 404);
  eq('unsafe id is 404, not a traversal', (await getJson('/api/memory/note', { id: '../../../../etc/passwd' })).status, 404);
  eq('empty title is 400', (await send('POST', '/api/memory', {}, { title: '' })).status, 400);
  eq('update of a missing note is 404', (await send('PUT', '/api/memory/note', { id: 'nope' }, { append: 'x' })).status, 404);
  eq('link to nothing is 500 with a message', (await send('POST', '/api/memory/link', {}, { from: 'http-note', to: 'nope' })).status, 500);
  eq('suggest for an unknown id errors cleanly', (await getJson('/api/memory/suggest', { id: 'nope' })).status, 500);

  /* concurrency: many writers at once, as several agents would be */
  const parallel = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      send('POST', '/api/memory', {}, { title: `Parallel ${i}`, content: `body ${i} links [[http-note]]` }),
    ),
  );
  eq('all parallel creates succeed', parallel.filter((r) => r.status === 200).length, 40);
  eq('all parallel ids are distinct', new Set(parallel.map((r) => r.body.note.id)).size, 40);
  const afterParallel = await getJson('/api/memory');
  eq('all parallel notes are on disk', afterParallel.body.notes.length, 41);
  eq('parallel backlinks all landed', (await getJson('/api/memory/backlinks', { id: 'http-note' })).body.backlinks.length, 40);
  ok('no temp files survived the storm', !readdirSync(store.memoryDir(hp)).some((f) => f.includes('.tmp')));

  /* MCP wiring */
  const mcpStatus = await getJson('/api/memory/mcp');
  ok('MCP status returns a script path', typeof mcpStatus.body.script === 'string' && mcpStatus.body.script.endsWith('.mjs'));
  ok('the MCP script actually exists', existsSync(mcpStatus.body.script));
  ok('MCP status lists targets', mcpStatus.body.targets.length >= 4);
  ok('nothing is wired yet', mcpStatus.body.targets.every((t) => !t.wired));
  ok('a copyable snippet is offered', mcpStatus.body.snippet.includes('eaon-memory'));

  const wired = await send('POST', '/api/memory/mcp', {}, { targets: ['claude', 'cursor', 'vscode', 'opencode', 'gemini'] });
  eq('wiring reports what changed', wired.body.changed.length, 5);
  eq('wiring reports no errors', wired.body.errors.length, 0);
  ok('.mcp.json was written', existsSync(join(hp, '.mcp.json')));
  ok('.cursor/mcp.json was written', existsSync(join(hp, '.cursor', 'mcp.json')));
  ok('.vscode/mcp.json was written', existsSync(join(hp, '.vscode', 'mcp.json')));
  ok('opencode.json was written', existsSync(join(hp, 'opencode.json')));
  ok('.gemini/settings.json was written', existsSync(join(hp, '.gemini', 'settings.json')));

  const claudeCfg = JSON.parse(readFileSync(join(hp, '.mcp.json'), 'utf8'));
  eq('claude config uses mcpServers', Object.keys(claudeCfg), ['mcpServers']);
  eq('claude config declares stdio', claudeCfg.mcpServers['eaon-memory'].type, 'stdio');
  ok('claude config points at the project', claudeCfg.mcpServers['eaon-memory'].args.includes(hp));
  const vscodeCfg = JSON.parse(readFileSync(join(hp, '.vscode', 'mcp.json'), 'utf8'));
  ok('vscode config uses the servers key', !!vscodeCfg.servers['eaon-memory']);
  const openCfg = JSON.parse(readFileSync(join(hp, 'opencode.json'), 'utf8'));
  eq('opencode config uses a command array', Array.isArray(openCfg.mcp['eaon-memory'].command), true);
  eq('opencode config is enabled', openCfg.mcp['eaon-memory'].enabled, true);
  ok('opencode config gets a schema', typeof openCfg.$schema === 'string');

  const reread2 = await getJson('/api/memory/mcp');
  ok('status now reports wired', reread2.body.targets.filter((t) => t.wired).length === 5);

  /* wiring must merge, not clobber */
  writeFileSync(
    join(hp, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'someone-elses': { command: 'x' } }, otherKey: 1 }, null, 2),
  );
  await send('POST', '/api/memory/mcp', {}, { targets: ['claude'] });
  const merged = JSON.parse(readFileSync(join(hp, '.mcp.json'), 'utf8'));
  ok('an unrelated server survives wiring', !!merged.mcpServers['someone-elses']);
  ok('an unrelated top-level key survives', merged.otherKey === 1);
  ok('our server was added alongside', !!merged.mcpServers['eaon-memory']);

  const unwired = await send('POST', '/api/memory/mcp', {}, { targets: ['claude'], enable: false });
  eq('unwiring reports the change', unwired.body.changed, ['claude']);
  const afterUnwire = JSON.parse(readFileSync(join(hp, '.mcp.json'), 'utf8'));
  ok('unwiring removes only our key', !afterUnwire.mcpServers['eaon-memory'] && !!afterUnwire.mcpServers['someone-elses']);

  writeFileSync(join(hp, '.cursor', 'mcp.json'), '{ this is not json');
  const broken = await send('POST', '/api/memory/mcp', {}, { targets: ['cursor'] });
  eq('a corrupt config is refused, not overwritten', broken.body.errors.length, 1);
  eq('the corrupt file is left alone', readFileSync(join(hp, '.cursor', 'mcp.json'), 'utf8'), '{ this is not json');

  eq('unknown wiring targets are rejected', (await send('POST', '/api/memory/mcp', {}, { targets: ['nonsense'] })).status, 400);
  eq('empty target list is rejected', (await send('POST', '/api/memory/mcp', {}, { targets: [] })).status, 400);
}

server.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 300));

/* ── report ─────────────────────────────────────────────────────────────── */

cleanup();

console.log(`\n${'─'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`\x1b[32m✓ all ${passed} assertions passed\x1b[0m`);
  process.exit(0);
}
console.log(`\x1b[31m✗ ${failures.length} failed, ${passed} passed\x1b[0m\n`);
for (const f of failures) console.log(`  • ${f}`);
process.exit(1);
