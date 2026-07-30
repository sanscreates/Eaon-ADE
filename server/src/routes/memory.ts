import { Router } from 'express';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  backlinksOf,
  buildGraph,
  createNote,
  deleteNote,
  expandHome,
  getNote,
  linkNotes,
  listNotes,
  memoryDir,
  searchNotes,
  statsOf,
  suggestConnections,
  tagsOf,
  updateNote,
  type MemoryNote,
} from '../memory/store.js';
import {
  applyWiring,
  ensureMcpScript,
  nodeBinary,
  readWiring,
  TARGETS,
  type TargetId,
} from '../memory/wiring.js';
import { ensureWatching } from '../memory/watch.js';

export const memoryRouter = Router();

/**
 * Every route is scoped to a project, and every one of them resolves the path
 * the same way. Doing it once here means a bad `?project=` fails with one
 * clear message instead of a different ENOENT per endpoint.
 */
function projectOf(req: { query: Record<string, unknown>; body?: unknown }): string {
  const raw =
    String(req.query.project ?? '') ||
    String((req.body as { project?: unknown } | undefined)?.project ?? '');
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, 'project required');
  const path = resolve(expandHome(trimmed));
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new HttpError(400, `Not a directory: ${path}`);
  }
  ensureWatching(path);
  return path;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Wraps a handler so a thrown HttpError becomes its status, and anything else a 500. */
function guard(handler: (req: any, res: any) => void | Promise<void>) {
  return async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/** The body of a note is big and the list view never shows it. */
function summarize(note: MemoryNote) {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    created: note.created,
    updated: note.updated,
    source: note.source,
    file: note.file,
    excerpt: note.excerpt,
    links: note.links,
    linkCount: note.links.length,
  };
}

/* ── reading ────────────────────────────────────────────────────────────── */

memoryRouter.get('/', guard((req, res) => {
  const project = projectOf(req);
  const notes = listNotes(project);
  res.json({
    notes: notes.map(summarize),
    tags: tagsOf(project),
    stats: statsOf(project),
  });
}));

memoryRouter.get('/note', guard((req, res) => {
  const project = projectOf(req);
  const id = String(req.query.id ?? '');
  const note = getNote(project, id);
  if (!note) throw new HttpError(404, `No memory with id "${id}"`);
  res.json({
    note: { ...summarize(note), body: note.body },
    backlinks: backlinksOf(project, note.id),
    suggestions: suggestConnections(project, note.id, 6),
  });
}));

memoryRouter.get('/graph', guard((req, res) => {
  const project = projectOf(req);
  res.json({ ...buildGraph(project), stats: statsOf(project) });
}));

memoryRouter.get('/search', guard((req, res) => {
  const project = projectOf(req);
  res.json({
    hits: searchNotes(project, String(req.query.q ?? ''), {
      tag: String(req.query.tag ?? ''),
      limit: Number(req.query.limit ?? 30),
      match: req.query.match === 'any' ? 'any' : 'all',
    }),
  });
}));

memoryRouter.get('/backlinks', guard((req, res) => {
  const project = projectOf(req);
  const id = String(req.query.id ?? '');
  if (!getNote(project, id)) throw new HttpError(404, `No memory with id "${id}"`);
  res.json({ backlinks: backlinksOf(project, id) });
}));

memoryRouter.get('/suggest', guard((req, res) => {
  const project = projectOf(req);
  const id = String(req.query.id ?? '').trim();
  res.json({ suggestions: suggestConnections(project, id || null, Number(req.query.limit ?? 8)) });
}));

/* ── writing ────────────────────────────────────────────────────────────── */

memoryRouter.post('/', guard((req, res) => {
  const project = projectOf(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? '').trim();
  if (!title) throw new HttpError(400, 'title required');
  const note = createNote(project, {
    title,
    content: body.content === undefined ? '' : String(body.content),
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    links: Array.isArray(body.links) ? body.links.map(String) : [],
    id: body.id ? String(body.id) : undefined,
    source: String(body.source ?? 'you'),
  });
  res.json({ note: { ...summarize(note), body: note.body } });
}));

memoryRouter.put('/note', guard((req, res) => {
  const project = projectOf(req);
  const id = String(req.query.id ?? '');
  if (!getNote(project, id)) throw new HttpError(404, `No memory with id "${id}"`);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const note = updateNote(project, id, {
    title: body.title === undefined ? undefined : String(body.title),
    content: body.content === undefined ? undefined : String(body.content),
    append: body.append === undefined ? undefined : String(body.append),
    tags: body.tags === undefined ? undefined : (Array.isArray(body.tags) ? body.tags.map(String) : []),
    source: body.source === undefined ? undefined : String(body.source),
  });
  res.json({ note: { ...summarize(note), body: note.body } });
}));

memoryRouter.post('/link', guard((req, res) => {
  const project = projectOf(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = linkNotes(project, String(body.from ?? ''), String(body.to ?? ''));
  res.json({
    from: summarize(result.from),
    to: summarize(result.to),
    alreadyLinked: result.alreadyLinked,
  });
}));

memoryRouter.delete('/note', guard((req, res) => {
  const project = projectOf(req);
  const id = String(req.query.id ?? '');
  if (!deleteNote(project, id)) throw new HttpError(404, `No memory with id "${id}"`);
  res.json({ ok: true });
}));

/* ── MCP wiring ─────────────────────────────────────────────────────────── */

memoryRouter.get('/mcp', guard(async (req, res) => {
  const project = projectOf(req);
  const [script, node] = await Promise.all([ensureMcpScript(), nodeBinary()]);
  res.json(readWiring(project, script, node));
}));

memoryRouter.post('/mcp', guard(async (req, res) => {
  const project = projectOf(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const known = new Set(TARGETS.map((t) => t.id as string));
  const requested = Array.isArray(body.targets) ? body.targets.map(String) : [];
  const targets = requested.filter((t): t is TargetId => known.has(t));
  if (targets.length === 0) throw new HttpError(400, 'targets required');

  const [script, node] = await Promise.all([ensureMcpScript(), nodeBinary()]);
  const enable = body.enable !== false;
  const result = applyWiring(project, targets, script, node, enable);
  res.json({ ...result, status: readWiring(project, script, node) });
}));

/** Where the notes live, for "reveal in Finder" and the empty state's copy. */
memoryRouter.get('/where', guard((req, res) => {
  const project = projectOf(req);
  res.json({ dir: memoryDir(project), stats: statsOf(project) });
}));
