/* ═══════════════════════════════════════════════════════════════════════════
   Memory store — a knowledge graph made of markdown files.

   Everything lives in `<project>/.eaon/memory/*.md`: plain notes with YAML
   frontmatter and [[wikilinks]] in the body. That choice is the whole design.
   Files beside the code mean the graph is greppable, diffable, reviewable and
   committable like anything else in the repo — and it means several agents
   plus the UI can share one memory without a database, a daemon or a lock:
   the filesystem already arbitrates that, and every writer here goes through
   an atomic write-then-rename so a reader never sees half a note.

   Links are resolved late rather than stored. A note that links [[Auth flow]]
   before that note exists keeps a *dangling* link, and the moment someone
   writes the note the edge appears on its own. Storing resolved ids instead
   would make writing order matter, which is exactly the friction that stops
   people writing things down.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/* ── types ──────────────────────────────────────────────────────────────── */

export interface MemoryLink {
  /** The text between the brackets, exactly as written. */
  raw: string;
  /** Id of the note this points at — real when resolved, a slug when not. */
  target: string;
  /** Display text after a `|`, when the author gave one. */
  alias: string;
  resolved: boolean;
}

export interface MemoryNote {
  id: string;
  title: string;
  tags: string[];
  /** ISO timestamps. Preserved from the file when present. */
  created: string;
  updated: string;
  /** Who wrote it: an agent id, "you", or anything the caller passes. */
  source: string;
  /** Absolute path of the markdown file. */
  file: string;
  body: string;
  /** First plain-text line or two, links flattened — for lists and tooltips. */
  excerpt: string;
  links: MemoryLink[];
}

export interface Backlink {
  id: string;
  title: string;
  /** The line the link appears on, so the reference explains itself. */
  context: string;
}

export interface SearchHit {
  id: string;
  title: string;
  tags: string[];
  updated: string;
  source: string;
  score: number;
  /** Where the match was found, with the matched run marked by **bold**. */
  snippet: string;
}

export interface Suggestion {
  /** The note the suggestion is *for* — set in global mode, where it varies. */
  from: string;
  fromTitle: string;
  id: string;
  title: string;
  score: number;
  /** Plain-language why: shared tags, shared terms, shared neighbours. */
  reasons: string[];
}

export interface GraphNode {
  id: string;
  title: string;
  tags: string[];
  source: string;
  updated: string;
  degree: number;
  /** True for a link target that has no note yet — drawn as a ghost. */
  missing: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  /** True when both notes link to each other. */
  mutual: boolean;
}

export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MemoryStats {
  notes: number;
  links: number;
  dangling: number;
  orphans: number;
  tags: number;
  dir: string;
}

export interface CreateInput {
  title: string;
  content?: string;
  tags?: string[];
  source?: string;
  /** Explicit id; otherwise slugified from the title. */
  id?: string;
  /** Notes to link to, appended as a "Related" line when not already linked. */
  links?: string[];
}

export interface UpdateInput {
  title?: string;
  content?: string;
  /** Appended to the existing body instead of replacing it. */
  append?: string;
  tags?: string[];
  source?: string;
}

/* ── paths & ids ────────────────────────────────────────────────────────── */

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export function memoryDir(projectPath: string): string {
  return join(resolve(expandHome(String(projectPath ?? '').trim())), '.eaon', 'memory');
}

/**
 * A title reduced to a filename. Deliberately lossy and stable: two ways of
 * writing the same name ("Auth Flow", "auth flow") have to land on one id or
 * links would only resolve for whoever typed them.
 */
export function slugify(text: string): string {
  const base = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return base || 'note';
}

/**
 * Ids reach the filesystem, so anything that could escape the memory folder is
 * rejected outright rather than sanitised — a silently rewritten id would make
 * "the note I just wrote isn't there" the user's problem to debug.
 */
export function isSafeId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const value = id.trim();
  if (!value || value.length > 120) return false;
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) return false;
  if (value === '.' || value === '..' || value.includes('..')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function noteFile(projectPath: string, id: string): string {
  return join(memoryDir(projectPath), `${id}.md`);
}

/* ── frontmatter ────────────────────────────────────────────────────────── */

type FrontValue = string | string[];

/**
 * A deliberately small YAML reader: scalars, inline `[a, b]` arrays and `- x`
 * block lists, which is the whole of what this frontmatter ever holds. A real
 * YAML dependency would buy nothing here and would happily accept documents
 * this format has no way to write back.
 */
function parseFrontmatter(raw: string): { data: Record<string, FrontValue>; body: string } {
  const text = raw.replace(/^﻿/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { data: {}, body: text.replace(/^\s*\n/, '') };

  const data: Record<string, FrontValue> = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey: string | null = null;

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item && currentKey) {
      const existing = data[currentKey];
      const value = unquote(item[1]);
      if (!value) continue;
      if (Array.isArray(existing)) existing.push(value);
      else data[currentKey] = [value];
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1];
    const rest = pair[2].trim();
    currentKey = key;

    if (!rest) {
      // Either a block list follows, or the key is simply empty. Start as an
      // array; a scalar can never follow, so nothing is lost by guessing here.
      data[key] = [];
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest
        .slice(1, -1)
        .split(',')
        .map((part) => unquote(part))
        .filter(Boolean);
      continue;
    }
    data[key] = unquote(rest);
  }

  return { data, body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  return trimmed;
}

/** Quote only when a bare scalar would round-trip wrong. */
function yamlScalar(value: string): string {
  const text = String(value ?? '');
  if (!text) return '""';
  if (/^[\s]|[\s]$|[:#\[\]{}",'&*!|>%@`]|^-|^\?/.test(text) || /\r|\n/.test(text)) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
  }
  return text;
}

function serialize(note: {
  title: string;
  tags: string[];
  created: string;
  updated: string;
  source: string;
  body: string;
}): string {
  const tags = note.tags.length ? `[${note.tags.map(yamlScalar).join(', ')}]` : '[]';
  const head = [
    '---',
    `title: ${yamlScalar(note.title)}`,
    `tags: ${tags}`,
    `created: ${note.created}`,
    `updated: ${note.updated}`,
    `source: ${yamlScalar(note.source)}`,
    '---',
  ].join('\n');
  const body = note.body.replace(/^\s*\n+/, '').replace(/\s*$/, '');
  return `${head}\n\n${body}\n`;
}

/* ── links ──────────────────────────────────────────────────────────────── */

const WIKILINK = /\[\[([^\[\]\n]+?)\]\]/g;

interface RawLink {
  raw: string;
  alias: string;
}

function extractLinks(body: string): RawLink[] {
  const out: RawLink[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(WIKILINK)) {
    const inner = match[1];
    const bar = inner.indexOf('|');
    // `[[note#heading]]` — the heading is display detail, the note is the edge.
    const targetRaw = (bar >= 0 ? inner.slice(0, bar) : inner).split('#')[0].trim();
    const alias = bar >= 0 ? inner.slice(bar + 1).trim() : '';
    if (!targetRaw) continue;
    const key = `${targetRaw.toLowerCase()}|${alias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: targetRaw, alias });
  }
  return out;
}

/** Strips wikilink syntax down to the words a human would read. */
export function flattenLinks(body: string): string {
  return body.replace(WIKILINK, (_m, inner: string) => {
    const bar = inner.indexOf('|');
    return (bar >= 0 ? inner.slice(bar + 1) : inner).split('#')[0].trim();
  });
}

interface Resolver {
  resolve: (raw: string) => { target: string; resolved: boolean };
}

function buildResolver(notes: { id: string; title: string }[]): Resolver {
  const byId = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const bySlug = new Map<string, string>();
  for (const note of notes) {
    byId.set(note.id.toLowerCase(), note.id);
    const title = note.title.trim().toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, note.id);
    const slug = slugify(note.title);
    if (!bySlug.has(slug)) bySlug.set(slug, note.id);
  }
  return {
    resolve(raw: string) {
      const key = raw.trim().toLowerCase();
      const slug = slugify(raw);
      const hit = byId.get(key) ?? byTitle.get(key) ?? byId.get(slug) ?? bySlug.get(slug);
      return hit ? { target: hit, resolved: true } : { target: slug, resolved: false };
    },
  };
}

/* ── reading ────────────────────────────────────────────────────────────── */

interface Cached {
  signature: string;
  notes: MemoryNote[];
}

const cache = new Map<string, Cached>();

/**
 * A fingerprint of the folder: names, sizes and nanosecond mtimes. Statting is
 * an order of magnitude cheaper than reading and parsing, and nanosecond
 * precision means two writes inside the same millisecond still invalidate —
 * which matters here, because the other writer is usually another process.
 */
function signatureOf(dir: string): { signature: string; files: string[] } {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { signature: '', files: [] };
  }
  const files = entries
    .filter((name) => name.endsWith('.md') && !name.startsWith('.'))
    .sort();
  const parts: string[] = [];
  const kept: string[] = [];
  for (const name of files) {
    try {
      const st = statSync(join(dir, name), { bigint: true });
      if (!st.isFile()) continue;
      kept.push(name);
      parts.push(`${name}:${st.mtimeNs}:${st.size}`);
    } catch {
      // Vanished between readdir and stat — another writer is mid-rename.
    }
  }
  return { signature: parts.join('|'), files: kept };
}

function parseNote(file: string, id: string, raw: string): MemoryNote {
  const { data, body: rawBody } = parseFrontmatter(raw);
  // Drop the blank line serialize() puts after the frontmatter and the newline
  // it puts at the end, so `content in → body out` is byte-for-byte the same
  // string. A caller that writes a note and reads it back should get what it
  // wrote, not what the file format needed around it.
  const body = rawBody.replace(/^\n/, '').replace(/\s+$/, '');
  const asString = (key: string, fallback = ''): string => {
    const value = data[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length) return String(value[0]);
    return fallback;
  };
  const asArray = (key: string): string[] => {
    const value = data[key];
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  };

  let stamp = '';
  try {
    stamp = new Date(statSync(file).mtimeMs).toISOString();
  } catch {
    stamp = new Date(0).toISOString();
  }

  const title = asString('title').trim() || id;
  const created = asString('created') || stamp;
  const updated = asString('updated') || stamp;
  const plain = flattenLinks(body)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    id,
    title,
    tags: asArray('tags').map((t) => t.replace(/^#/, '')),
    created,
    updated,
    source: asString('source') || 'unknown',
    file,
    body,
    excerpt: plain.length > 220 ? `${plain.slice(0, 219)}…` : plain,
    // Filled in by listNotes once every note is known — a note cannot resolve
    // its own links without the rest of the folder in hand.
    links: [],
  };
}

/** Every note in the project, links resolved against each other. */
export function listNotes(projectPath: string): MemoryNote[] {
  const dir = memoryDir(projectPath);
  const { signature, files } = signatureOf(dir);
  const hit = cache.get(dir);
  if (hit && hit.signature === signature) return hit.notes;

  const notes: MemoryNote[] = [];
  for (const name of files) {
    const file = join(dir, name);
    try {
      notes.push(parseNote(file, name.slice(0, -3), readFileSync(file, 'utf8')));
    } catch {
      // Unreadable file (permissions, or deleted mid-scan). Skipping keeps the
      // rest of the graph usable, which is better than failing the whole read.
    }
  }

  const resolver = buildResolver(notes);
  for (const note of notes) {
    note.links = extractLinks(note.body).map((link) => {
      const { target, resolved } = resolver.resolve(link.raw);
      return { raw: link.raw, alias: link.alias, target, resolved };
    });
  }

  notes.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id.localeCompare(b.id)));
  cache.set(dir, { signature, notes });
  return notes;
}

export function getNote(projectPath: string, id: string): MemoryNote | null {
  if (!isSafeId(id)) return null;
  const wanted = id.trim().toLowerCase();
  return listNotes(projectPath).find((n) => n.id.toLowerCase() === wanted) ?? null;
}

/** Find a note the way a link does — by id, by title, or by slug of either. */
export function resolveNote(projectPath: string, reference: string): MemoryNote | null {
  const notes = listNotes(projectPath);
  const { target, resolved } = buildResolver(notes).resolve(String(reference ?? ''));
  if (!resolved) return null;
  return notes.find((n) => n.id === target) ?? null;
}

/* ── writing ────────────────────────────────────────────────────────────── */

/**
 * Write via a temp file in the same folder and rename over the target. Rename
 * is atomic within a filesystem, so a reader — the UI polling, another agent
 * mid-search — sees either the old note or the new one, never a torn file.
 */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best effort
    }
    throw err;
  }
}

function invalidate(projectPath: string): void {
  cache.delete(memoryDir(projectPath));
}

function uniqueId(dir: string, base: string): string {
  let id = base;
  let n = 2;
  while (existsSync(join(dir, `${id}.md`))) {
    id = `${base}-${n++}`;
    if (n > 999) {
      id = `${base}-${Date.now().toString(36)}`;
      break;
    }
  }
  return id;
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    if (typeof tags === 'string') {
      return cleanTags(tags.split(','));
    }
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const value = String(tag ?? '')
      .trim()
      .replace(/^#/, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value.slice(0, 40));
  }
  return out.slice(0, 24);
}

export function createNote(projectPath: string, input: CreateInput): MemoryNote {
  const dir = memoryDir(projectPath);
  const title = String(input.title ?? '').trim();
  if (!title) throw new Error('title is required');

  if (input.id !== undefined && input.id !== null && String(input.id).trim() && !isSafeId(String(input.id).trim())) {
    throw new Error(`Invalid memory id "${input.id}" — use letters, numbers, dots, dashes or underscores`);
  }

  mkdirSync(dir, { recursive: true });
  const wanted = input.id && String(input.id).trim() ? String(input.id).trim() : slugify(title);
  const id = uniqueId(dir, wanted);

  const now = new Date().toISOString();
  let body = String(input.content ?? '').trim();

  const extra = (input.links ?? [])
    .map((l) => String(l ?? '').trim())
    .filter(Boolean)
    .filter((l) => !new RegExp(`\\[\\[\\s*${escapeRegExp(l)}\\s*(\\||#|\\]\\])`, 'i').test(body));
  if (extra.length) {
    const line = `Related: ${extra.map((l) => `[[${l}]]`).join(' · ')}`;
    body = body ? `${body}\n\n${line}` : line;
  }

  const content = serialize({
    title,
    tags: cleanTags(input.tags),
    created: now,
    updated: now,
    source: String(input.source ?? '').trim() || 'unknown',
    body,
  });
  writeAtomic(join(dir, `${id}.md`), content);
  invalidate(projectPath);
  return getNote(projectPath, id)!;
}

export function updateNote(projectPath: string, id: string, patch: UpdateInput): MemoryNote {
  const note = getNote(projectPath, id);
  if (!note) throw new Error(`No memory with id "${id}"`);

  const append = String(patch.append ?? '').trim();
  let body = patch.content !== undefined ? String(patch.content ?? '') : note.body;
  if (append) body = `${body.replace(/\s*$/, '')}\n\n${append}`;

  const content = serialize({
    title: patch.title !== undefined && String(patch.title).trim() ? String(patch.title).trim() : note.title,
    tags: patch.tags !== undefined ? cleanTags(patch.tags) : note.tags,
    created: note.created,
    updated: new Date().toISOString(),
    source: patch.source !== undefined && String(patch.source).trim() ? String(patch.source).trim() : note.source,
    body,
  });
  writeAtomic(note.file, content);
  invalidate(projectPath);
  return getNote(projectPath, note.id)!;
}

export function deleteNote(projectPath: string, id: string): boolean {
  const note = getNote(projectPath, id);
  if (!note) return false;
  rmSync(note.file, { force: true });
  invalidate(projectPath);
  return true;
}

/**
 * Add a link from one note to another by appending a Related line. Editing the
 * markdown is the point: the link has to live in the text, or the note stops
 * being the source of truth and the graph starts drifting from what you read.
 */
export function linkNotes(projectPath: string, fromRef: string, toRef: string): { from: MemoryNote; to: MemoryNote; alreadyLinked: boolean } {
  const from = resolveNote(projectPath, fromRef);
  if (!from) throw new Error(`No memory matching "${fromRef}"`);
  const to = resolveNote(projectPath, toRef);
  if (!to) throw new Error(`No memory matching "${toRef}"`);
  if (from.id === to.id) throw new Error('A memory cannot link to itself');

  if (from.links.some((l) => l.resolved && l.target === to.id)) {
    return { from, to, alreadyLinked: true };
  }

  const related = /^Related:\s*(.*)$/m.exec(from.body);
  const body = related
    ? from.body.replace(related[0], `${related[0].replace(/\s*$/, '')} · [[${to.id}]]`)
    : `${from.body.replace(/\s*$/, '')}\n\nRelated: [[${to.id}]]`;

  const updated = updateNote(projectPath, from.id, { content: body });
  return { from: updated, to: getNote(projectPath, to.id)!, alreadyLinked: false };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── graph ──────────────────────────────────────────────────────────────── */

export function backlinksOf(projectPath: string, id: string): Backlink[] {
  const note = getNote(projectPath, id);
  if (!note) return [];
  const out: Backlink[] = [];
  for (const other of listNotes(projectPath)) {
    if (other.id === note.id) continue;
    if (!other.links.some((l) => l.resolved && l.target === note.id)) continue;
    out.push({ id: other.id, title: other.title, context: contextFor(other.body, note) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** The line the link sits on, trimmed to something readable. */
function contextFor(body: string, target: MemoryNote): string {
  const lines = body.split(/\r?\n/);
  const candidates = [target.id, target.title, slugify(target.title)].map((s) => s.toLowerCase());
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!lower.includes('[[')) continue;
    if (!candidates.some((c) => lower.includes(c))) continue;
    const clean = flattenLinks(line).replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();
    if (clean) return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
  }
  return '';
}

export function buildGraph(projectPath: string): MemoryGraph {
  const notes = listNotes(projectPath);
  const nodes = new Map<string, GraphNode>();
  for (const note of notes) {
    nodes.set(note.id, {
      id: note.id,
      title: note.title,
      tags: note.tags,
      source: note.source,
      updated: note.updated,
      degree: 0,
      missing: false,
    });
  }

  const edges = new Map<string, GraphEdge>();
  for (const note of notes) {
    for (const link of note.links) {
      if (link.target === note.id) continue;
      if (!nodes.has(link.target)) {
        // A link to a note nobody has written yet. Showing it as a ghost is
        // the useful behaviour: it is a list of what the graph is missing.
        nodes.set(link.target, {
          id: link.target,
          title: link.alias || link.raw,
          tags: [],
          source: '',
          updated: '',
          degree: 0,
          missing: true,
        });
      }
      const key = `${note.id} ${link.target}`;
      const existing = edges.get(key);
      if (existing) existing.weight += 1;
      else edges.set(key, { source: note.id, target: link.target, weight: 1, mutual: false });
    }
  }

  for (const edge of edges.values()) {
    if (edges.has(`${edge.target} ${edge.source}`)) edge.mutual = true;
    const a = nodes.get(edge.source);
    const b = nodes.get(edge.target);
    if (a) a.degree += 1;
    if (b) b.degree += 1;
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function statsOf(projectPath: string): MemoryStats {
  const notes = listNotes(projectPath);
  const tags = new Set<string>();
  let links = 0;
  let dangling = 0;
  const linked = new Set<string>();
  for (const note of notes) {
    for (const tag of note.tags) tags.add(tag);
    for (const link of note.links) {
      links += 1;
      if (link.resolved) {
        linked.add(note.id);
        linked.add(link.target);
      } else {
        dangling += 1;
      }
    }
  }
  return {
    notes: notes.length,
    links,
    dangling,
    orphans: notes.filter((n) => !linked.has(n.id)).length,
    tags: tags.size,
    dir: memoryDir(projectPath),
  };
}

/* ── search ─────────────────────────────────────────────────────────────── */

const STOPWORDS = new Set(
  ('the a an and or but if then else for to of in on at by with from as is are was were be been being this that these those ' +
    'it its it\'s we you they he she i not no do does did have has had will would can could should may might must about into ' +
    'over under out up down off again more most some such only own same than too very just also our your their his her them ' +
    'when where which who whom what how why all any both each few other because while during before after above below use used ' +
    'using make makes made get gets got set sets like via per etc note notes memory')
    .split(' '),
);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9_+#.-]*/g) ?? [])
    .map((t) => t.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((t) => t.length >= 3 && t.length <= 32 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

interface SearchOptions {
  limit?: number;
  tag?: string;
  /** 'all' requires every term (the default); 'any' is a loose OR. */
  match?: 'all' | 'any';
}

export function searchNotes(projectPath: string, query: string, opts: SearchOptions = {}): SearchHit[] {
  const notes = listNotes(projectPath);
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  const tagFilter = String(opts.tag ?? '').trim().toLowerCase().replace(/^#/, '');
  const raw = String(query ?? '').trim();
  const terms = [...new Set(raw.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean))];

  const pool = tagFilter ? notes.filter((n) => n.tags.some((t) => t.toLowerCase() === tagFilter)) : notes;

  // A bare tag filter is a legitimate query — "everything tagged auth".
  if (terms.length === 0) {
    return pool.slice(0, limit).map((note) => ({
      id: note.id,
      title: note.title,
      tags: note.tags,
      updated: note.updated,
      source: note.source,
      score: 1,
      snippet: note.excerpt,
    }));
  }

  const hits: SearchHit[] = [];
  for (const note of pool) {
    const title = note.title.toLowerCase();
    const id = note.id.toLowerCase();
    const plain = flattenLinks(note.body).toLowerCase();
    const tags = note.tags.map((t) => t.toLowerCase());

    let score = 0;
    let matchedTerms = 0;
    let bestTerm = '';

    if (title.includes(raw.toLowerCase())) score += 60;

    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) termScore += 24;
      if (id.includes(term)) termScore += 10;
      if (tags.some((t) => t.includes(term))) termScore += 16;
      const occurrences = countOccurrences(plain, term);
      if (occurrences > 0) termScore += 6 + Math.min(occurrences - 1, 8) * 1.5;
      if (termScore > 0) {
        matchedTerms += 1;
        score += termScore;
        if (!bestTerm) bestTerm = term;
      }
    }

    if (matchedTerms === 0) continue;
    if ((opts.match ?? 'all') === 'all' && matchedTerms < terms.length) continue;

    hits.push({
      id: note.id,
      title: note.title,
      tags: note.tags,
      updated: note.updated,
      source: note.source,
      score: Math.round(score * 10) / 10,
      snippet: snippetFor(note, bestTerm || terms[0]),
    });
  }

  hits.sort((a, b) => b.score - a.score || (a.updated < b.updated ? 1 : -1));
  return hits.slice(0, limit);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
    if (count > 50) return count;
  }
}

function snippetFor(note: MemoryNote, term: string): string {
  const plain = flattenLinks(note.body).replace(/\s+/g, ' ').trim();
  const at = plain.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return note.excerpt;
  const start = Math.max(0, at - 70);
  const end = Math.min(plain.length, at + term.length + 90);
  const head = start > 0 ? '…' : '';
  const tail = end < plain.length ? '…' : '';
  const slice = plain.slice(start, end);
  const local = at - start;
  const marked = `${slice.slice(0, local)}**${slice.slice(local, local + term.length)}**${slice.slice(local + term.length)}`;
  return `${head}${marked}${tail}`;
}

/* ── suggested connections ──────────────────────────────────────────────── */

interface Vector {
  id: string;
  terms: Map<string, number>;
  norm: number;
  tags: Set<string>;
  neighbours: Set<string>;
}

/**
 * TF-IDF cosine over the note text, plus two graph-shaped signals: notes that
 * share a tag, and notes that already point at the same third note. Term
 * overlap alone keeps proposing pairs that merely share vocabulary — "both
 * mention the word server" — while the graph signals are the ones that
 * actually read as "these two belong together".
 */
function vectorsFor(notes: MemoryNote[]): Map<string, Vector> {
  const docFreq = new Map<string, number>();
  const raw = new Map<string, Map<string, number>>();

  for (const note of notes) {
    const counts = new Map<string, number>();
    const text = `${note.title} ${note.tags.join(' ')} ${flattenLinks(note.body)}`;
    for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
    raw.set(note.id, counts);
    for (const token of counts.keys()) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
  }

  const total = Math.max(1, notes.length);
  const out = new Map<string, Vector>();
  for (const note of notes) {
    const counts = raw.get(note.id)!;
    const terms = new Map<string, number>();
    let sumSq = 0;
    for (const [token, count] of counts) {
      const df = docFreq.get(token) ?? 1;
      // A term in every note carries no signal; one in two notes carries a lot.
      const idf = Math.log((total + 1) / (df + 0.5));
      if (idf <= 0) continue;
      const weight = (1 + Math.log(count)) * idf;
      terms.set(token, weight);
      sumSq += weight * weight;
    }
    out.set(note.id, {
      id: note.id,
      terms,
      norm: Math.sqrt(sumSq) || 1,
      tags: new Set(note.tags.map((t) => t.toLowerCase())),
      neighbours: new Set(note.links.filter((l) => l.resolved).map((l) => l.target)),
    });
  }

  // Neighbours are undirected for this purpose: two notes both referenced by a
  // third are related whichever way the arrows happen to point.
  for (const note of notes) {
    for (const link of note.links) {
      if (!link.resolved) continue;
      out.get(link.target)?.neighbours.add(note.id);
    }
  }
  return out;
}

function cosine(a: Vector, b: Vector): { score: number; shared: string[] } {
  const [small, large] = a.terms.size <= b.terms.size ? [a, b] : [b, a];
  let dot = 0;
  const contributions: [string, number][] = [];
  for (const [token, weight] of small.terms) {
    const other = large.terms.get(token);
    if (other === undefined) continue;
    const product = weight * other;
    dot += product;
    contributions.push([token, product]);
  }
  if (dot === 0) return { score: 0, shared: [] };
  contributions.sort((x, y) => y[1] - x[1]);
  return { score: dot / (a.norm * b.norm), shared: contributions.slice(0, 4).map(([t]) => t) };
}

export function suggestConnections(
  projectPath: string,
  reference: string | null,
  limit = 8,
): Suggestion[] {
  const notes = listNotes(projectPath);

  // Validate the reference before the size check: "no such note" is the same
  // mistake whether the graph holds one note or a thousand, and silently
  // returning nothing for a typo'd id is how a caller loses an afternoon.
  const focus = reference ? resolveNote(projectPath, reference) : null;
  if (reference && !focus) throw new Error(`No memory matching "${reference}"`);

  if (notes.length < 2) return [];
  const vectors = vectorsFor(notes);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const cap = Math.max(1, Math.min(50, limit));

  const sources = focus ? [focus] : notes;
  const out: Suggestion[] = [];
  const seenPair = new Set<string>();

  for (const from of sources) {
    const fromVec = vectors.get(from.id)!;
    const linked = new Set(from.links.filter((l) => l.resolved).map((l) => l.target));

    for (const to of notes) {
      if (to.id === from.id) continue;
      if (linked.has(to.id)) continue;
      const toVec = vectors.get(to.id)!;
      // In global mode a pair is one suggestion, not two.
      const pairKey = focus ? `${from.id} ${to.id}` : [from.id, to.id].sort().join(' ');
      if (!focus && toVec.neighbours.has(from.id)) continue;
      if (seenPair.has(pairKey)) continue;

      const { score: sim, shared } = cosine(fromVec, toVec);
      const sharedTags = [...fromVec.tags].filter((t) => toVec.tags.has(t));
      const sharedNeighbours = [...fromVec.neighbours].filter(
        (n) => toVec.neighbours.has(n) && n !== from.id && n !== to.id,
      );

      const score = sim * 100 + sharedTags.length * 14 + Math.min(sharedNeighbours.length, 4) * 9;
      if (score < 6) continue;

      const reasons: string[] = [];
      if (sharedTags.length) reasons.push(`shares ${sharedTags.length === 1 ? 'the tag' : 'tags'} ${sharedTags.slice(0, 3).map((t) => `#${t}`).join(', ')}`);
      if (sharedNeighbours.length) {
        const names = sharedNeighbours.slice(0, 2).map((n) => byId.get(n)?.title ?? n);
        reasons.push(`both connect to ${names.join(' and ')}`);
      }
      if (shared.length) reasons.push(`overlapping terms: ${shared.join(', ')}`);
      if (!reasons.length) reasons.push('similar wording');

      seenPair.add(pairKey);
      out.push({
        from: from.id,
        fromTitle: from.title,
        id: to.id,
        title: to.title,
        score: Math.round(score * 10) / 10,
        reasons,
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, cap);
}

/** Every tag in use, most-used first — the panel's filter row. */
export function tagsOf(projectPath: string): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of listNotes(projectPath)) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Test seam: drops the stat-signature cache so a fresh read hits disk. */
export function clearMemoryCache(): void {
  cache.clear();
}
