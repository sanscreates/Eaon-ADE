/* ═══════════════════════════════════════════════════════════════════════════
   eaon-memory — an MCP server over the project's markdown knowledge graph.

   This is what makes the memory *shared*. Every agent the ADE can launch
   speaks MCP, so pointing each of them at this one server gives them all the
   same notes, the same links and the same backlinks — written by one, read by
   the next, and still there in the morning. The store is files on disk, so
   there is no session to lose and nothing to synchronise.

   Runs as its own process, spawned by the agent CLI, not by the ADE: it must
   therefore depend on nothing but Node itself. It is bundled to a single file
   for exactly that reason.

   Transport is stdio: newline-delimited JSON-RPC 2.0 on stdin/stdout. stdout
   carries protocol frames and nothing else — every diagnostic goes to stderr,
   because one stray console.log here corrupts the stream and the agent sees a
   server that "just doesn't work".
   ═══════════════════════════════════════════════════════════════════════════ */

import { existsSync, mkdirSync, statSync } from 'node:fs';
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
  resolveNote,
  searchNotes,
  statsOf,
  suggestConnections,
  tagsOf,
  updateNote,
  type MemoryNote,
} from './store.js';

const SERVER_NAME = 'eaon-memory';
const SERVER_VERSION = '1.0.0';

/** Protocol revisions this server knows how to speak, newest first. */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];

/* ── argv ───────────────────────────────────────────────────────────────── */

function readProjectPath(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project' || arg === '-p') return argv[i + 1] ?? '';
    if (arg.startsWith('--project=')) return arg.slice('--project='.length);
  }
  return process.env.EAON_MEMORY_PROJECT ?? process.env.EAON_PROJECT ?? process.cwd();
}

const projectPath = resolve(expandHome(readProjectPath(process.argv.slice(2)).trim() || process.cwd()));

/* ── JSON-RPC plumbing ──────────────────────────────────────────────────── */

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function respond(id: string | number, result: unknown): void {
  write({ jsonrpc: '2.0', id, result });
}

function fail(id: string | number, code: number, message: string): void {
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

function log(...parts: unknown[]): void {
  process.stderr.write(`[${SERVER_NAME}] ${parts.map(String).join(' ')}\n`);
}

/* ── tool results ───────────────────────────────────────────────────────── */

function text(body: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: body }] };
}

function toolError(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/* ── tool definitions ───────────────────────────────────────────────────── */

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => { content: { type: 'text'; text: string }[]; isError?: true };
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function strList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(args[key]);
  return Number.isFinite(value) ? value : fallback;
}

/** Who is writing. Set from the client's own name at initialize time. */
let clientLabel = 'agent';

function describeNote(note: MemoryNote): string {
  const resolved = note.links.filter((l) => l.resolved);
  const dangling = note.links.filter((l) => !l.resolved);
  const lines = [
    `id: ${note.id}`,
    `title: ${note.title}`,
    note.tags.length ? `tags: ${note.tags.map((t) => `#${t}`).join(' ')}` : 'tags: (none)',
    `source: ${note.source}`,
    `updated: ${note.updated}`,
    `file: ${note.file}`,
  ];
  if (resolved.length) lines.push(`links to: ${resolved.map((l) => l.target).join(', ')}`);
  if (dangling.length) {
    lines.push(`unwritten links: ${dangling.map((l) => l.target).join(', ')} (create these to close the loop)`);
  }
  return lines.join('\n');
}

const TOOLS: ToolDef[] = [
  {
    name: 'create_memory',
    title: 'Create a memory',
    description:
      'Write a new note into the project knowledge graph, stored as markdown at .eaon/memory/<id>.md and shared with every other agent on this project. ' +
      'Use it for anything worth knowing next session: a decision and why it was made, how a subsystem actually works, a constraint, a gotcha, a convention. ' +
      'Reference other notes inline with [[wikilinks]] — linking to a note that does not exist yet is fine and encouraged, it becomes a visible gap in the graph.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human title, e.g. "Session replay buffer".' },
        content: { type: 'string', description: 'Markdown body. Use [[other note]] to link.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase topic tags, e.g. ["auth","server"].' },
        links: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids or titles of related notes; appended as wikilinks if not already present in the body.',
        },
        id: { type: 'string', description: 'Optional explicit id (filename). Defaults to a slug of the title.' },
      },
      required: ['title'],
    },
    run: (args) => {
      const title = str(args, 'title');
      if (!title) return toolError('create_memory needs a non-empty "title".');
      const note = createNote(projectPath, {
        title,
        content: str(args, 'content'),
        tags: strList(args, 'tags'),
        links: strList(args, 'links'),
        id: str(args, 'id') || undefined,
        source: clientLabel,
      });
      return text(`Created memory.\n\n${describeNote(note)}`);
    },
  },
  {
    name: 'search_memories',
    title: 'Search memories',
    description:
      'Search the shared knowledge graph by keyword and/or tag. Do this before assuming something is unknown — another agent, or an earlier session, may already have written it down. ' +
      'Returns ranked matches with a snippet showing where each hit landed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for across titles, tags and bodies.' },
        tag: { type: 'string', description: 'Restrict to notes carrying this tag.' },
        match: { type: 'string', enum: ['all', 'any'], description: 'Require every word (default) or any word.' },
        limit: { type: 'number', description: 'Maximum results (default 20).' },
      },
    },
    run: (args) => {
      const query = str(args, 'query');
      const tag = str(args, 'tag');
      if (!query && !tag) return toolError('search_memories needs a "query", a "tag", or both.');
      const hits = searchNotes(projectPath, query, {
        tag,
        limit: num(args, 'limit', 20),
        match: str(args, 'match') === 'any' ? 'any' : 'all',
      });
      if (!hits.length) {
        const total = listNotes(projectPath).length;
        return text(
          `No memories matched${query ? ` "${query}"` : ''}${tag ? ` with tag #${tag}` : ''}. ` +
            `The graph holds ${total} note${total === 1 ? '' : 's'}${total ? ' — try a broader query or match:"any"' : ' — nothing has been written yet'}.`,
        );
      }
      const body = hits
        .map((hit, i) => {
          const tags = hit.tags.length ? `  [${hit.tags.map((t) => `#${t}`).join(' ')}]` : '';
          return `${i + 1}. ${hit.id} — ${hit.title}${tags}\n   ${hit.snippet}`;
        })
        .join('\n\n');
      return text(`${hits.length} match${hits.length === 1 ? '' : 'es'}:\n\n${body}\n\nRead one in full with read_memory.`);
    },
  },
  {
    name: 'find_backlinks',
    title: 'Find backlinks',
    description:
      'List every note that links *to* the given one, with the line each reference sits on. This is how you find the context a note was written for: what depends on it, what mentions it, and what would be affected by changing it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Note id or title to find references to.' },
      },
      required: ['id'],
    },
    run: (args) => {
      const reference = str(args, 'id');
      if (!reference) return toolError('find_backlinks needs an "id".');
      const note = resolveNote(projectPath, reference);
      if (!note) return toolError(`No memory matching "${reference}". Use search_memories or list_memories to find the right id.`);
      const links = backlinksOf(projectPath, note.id);
      const outgoing = note.links.filter((l) => l.resolved);
      const head = `${note.id} — ${note.title}`;
      if (!links.length) {
        return text(
          `${head}\n\nNothing links to this note yet.` +
            (outgoing.length ? `\nIt links out to: ${outgoing.map((l) => l.target).join(', ')}` : '') +
            `\n\nUse suggest_connections to find notes that probably should link here.`,
        );
      }
      const body = links.map((l) => `- ${l.id} — ${l.title}${l.context ? `\n    “${l.context}”` : ''}`).join('\n');
      return text(
        `${head}\n\n${links.length} backlink${links.length === 1 ? '' : 's'}:\n${body}` +
          (outgoing.length ? `\n\nLinks out to: ${outgoing.map((l) => l.target).join(', ')}` : ''),
      );
    },
  },
  {
    name: 'suggest_connections',
    title: 'Suggest connections',
    description:
      'Propose links that do not exist yet. Given a note id, ranks other notes that look related but are unlinked; with no id, ranks the strongest unlinked pairs across the whole graph. ' +
      'Scored on shared tags, shared neighbours and term overlap, and each suggestion says why. Follow up with link_memories to actually connect them.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Note to find connections for. Omit to scan the whole graph.' },
        limit: { type: 'number', description: 'Maximum suggestions (default 8).' },
      },
    },
    run: (args) => {
      const reference = str(args, 'id');
      const suggestions = suggestConnections(projectPath, reference || null, num(args, 'limit', 8));
      if (!suggestions.length) {
        const total = listNotes(projectPath).length;
        if (total < 2) return text('Fewer than two memories exist, so there is nothing to connect yet.');
        return text(
          reference
            ? `No unlinked notes look related to "${reference}". Either it is already well connected, or the graph has nothing on that topic yet.`
            : 'No strong unlinked pairs found — the graph is already well connected.',
        );
      }
      const body = suggestions
        .map((s, i) =>
          reference
            ? `${i + 1}. ${s.id} — ${s.title}  (score ${s.score})\n   ${s.reasons.join('; ')}`
            : `${i + 1}. ${s.from} → ${s.id}  (score ${s.score})\n   ${s.fromTitle} ⇄ ${s.title}\n   ${s.reasons.join('; ')}`,
        )
        .join('\n\n');
      const head = reference
        ? `Notes related to "${reference}" that are not linked to it yet:`
        : 'Unlinked pairs that look related:';
      return text(`${head}\n\n${body}\n\nConnect any of these with link_memories.`);
    },
  },
  {
    name: 'read_memory',
    title: 'Read a memory',
    description: 'Return one note in full — frontmatter, body, outgoing links and backlinks. Accepts an id or a title.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Note id or title.' } },
      required: ['id'],
    },
    run: (args) => {
      const reference = str(args, 'id');
      if (!reference) return toolError('read_memory needs an "id".');
      const note = resolveNote(projectPath, reference);
      if (!note) return toolError(`No memory matching "${reference}".`);
      const back = backlinksOf(projectPath, note.id);
      return text(
        `${describeNote(note)}\n` +
          (back.length ? `linked from: ${back.map((b) => b.id).join(', ')}\n` : '') +
          `\n---\n${note.body.trim()}`,
      );
    },
  },
  {
    name: 'update_memory',
    title: 'Update a memory',
    description:
      'Revise an existing note. Pass "append" to add to the end (the safe default when adding a finding), or "content" to replace the body outright. Title and tags can be changed independently.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Note id or title.' },
        append: { type: 'string', description: 'Markdown appended to the end of the body.' },
        content: { type: 'string', description: 'Replacement body. Overwrites everything.' },
        title: { type: 'string', description: 'New title.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list.' },
      },
      required: ['id'],
    },
    run: (args) => {
      const reference = str(args, 'id');
      if (!reference) return toolError('update_memory needs an "id".');
      const note = resolveNote(projectPath, reference);
      if (!note) return toolError(`No memory matching "${reference}".`);
      const hasContent = args.content !== undefined && args.content !== null;
      const patch: Record<string, unknown> = { source: clientLabel };
      if (hasContent) patch.content = String(args.content);
      if (str(args, 'append')) patch.append = str(args, 'append');
      if (str(args, 'title')) patch.title = str(args, 'title');
      if (args.tags !== undefined) patch.tags = strList(args, 'tags');
      if (!hasContent && !patch.append && !patch.title && patch.tags === undefined) {
        return toolError('update_memory needs at least one of: append, content, title, tags.');
      }
      const updated = updateNote(projectPath, note.id, patch);
      return text(`Updated memory.\n\n${describeNote(updated)}`);
    },
  },
  {
    name: 'list_memories',
    title: 'List memories',
    description:
      'Everything in the graph, newest first, with tags and link counts. Cheap orientation at the start of a session — call it before deciding what you do and do not already know.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Only notes carrying this tag.' },
        limit: { type: 'number', description: 'Maximum notes (default 50).' },
      },
    },
    run: (args) => {
      const tag = str(args, 'tag').toLowerCase().replace(/^#/, '');
      const limit = Math.max(1, Math.min(500, num(args, 'limit', 50)));
      const all = listNotes(projectPath);
      const notes = (tag ? all.filter((n) => n.tags.some((t) => t.toLowerCase() === tag)) : all).slice(0, limit);
      const stats = statsOf(projectPath);
      if (!notes.length) {
        return text(
          tag
            ? `No memories tagged #${tag}. Tags in use: ${tagsOf(projectPath).map((t) => `#${t.tag}`).join(' ') || '(none)'}`
            : `The knowledge graph is empty. Notes will be written to ${stats.dir}. Use create_memory to start one.`,
        );
      }
      const body = notes
        .map((n) => {
          const tags = n.tags.length ? `  [${n.tags.map((t) => `#${t}`).join(' ')}]` : '';
          const links = n.links.length ? `  ${n.links.length}→` : '';
          return `- ${n.id} — ${n.title}${tags}${links}\n    ${n.excerpt.slice(0, 140)}`;
        })
        .join('\n');
      return text(
        `${notes.length} of ${stats.notes} memories${tag ? ` tagged #${tag}` : ''}:\n\n${body}\n\n` +
          `Graph: ${stats.notes} notes, ${stats.links} links, ${stats.dangling} unwritten, ${stats.orphans} unconnected.`,
      );
    },
  },
  {
    name: 'link_memories',
    title: 'Link two memories',
    description:
      'Add a wikilink from one note to another, editing the markdown so the link lives in the text where a reader will see it. Idempotent — linking twice is a no-op.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Note the link is added to.' },
        to: { type: 'string', description: 'Note it should point at.' },
      },
      required: ['from', 'to'],
    },
    run: (args) => {
      const from = str(args, 'from');
      const to = str(args, 'to');
      if (!from || !to) return toolError('link_memories needs "from" and "to".');
      const result = linkNotes(projectPath, from, to);
      if (result.alreadyLinked) {
        return text(`${result.from.id} already links to ${result.to.id}. Nothing changed.`);
      }
      return text(`Linked ${result.from.id} → ${result.to.id}.\n\n${describeNote(result.from)}`);
    },
  },
  {
    name: 'memory_graph',
    title: 'Inspect the graph',
    description:
      'The shape of the knowledge graph: totals, the most-connected notes, notes nothing links to, and links pointing at notes nobody has written yet. Use it to find what is missing.',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const graph = buildGraph(projectPath);
      const stats = statsOf(projectPath);
      if (!stats.notes) return text(`The knowledge graph is empty (${stats.dir}).`);
      const real = graph.nodes.filter((n) => !n.missing);
      const hubs = [...real].sort((a, b) => b.degree - a.degree).slice(0, 8).filter((n) => n.degree > 0);
      // In-degree, not total degree: a note that links out but that nothing
      // links back to is exactly the one that gets lost, and it would be
      // invisible here if outgoing links counted toward "connected".
      const referenced = new Set(graph.edges.map((e) => e.target));
      const orphans = real.filter((n) => !referenced.has(n.id));
      const ghosts = graph.nodes.filter((n) => n.missing);
      const tags = tagsOf(projectPath);
      return text(
        [
          `${stats.notes} notes · ${stats.links} links · ${stats.dangling} pointing at unwritten notes · ${stats.orphans} unconnected`,
          tags.length ? `\nTags: ${tags.slice(0, 15).map((t) => `#${t.tag}(${t.count})`).join(' ')}` : '',
          hubs.length ? `\nMost connected:\n${hubs.map((n) => `- ${n.id} (${n.degree}) — ${n.title}`).join('\n')}` : '',
          orphans.length ? `\nNothing links to these:\n${orphans.slice(0, 15).map((n) => `- ${n.id} — ${n.title}`).join('\n')}` : '',
          ghosts.length ? `\nReferenced but never written:\n${ghosts.slice(0, 15).map((n) => `- ${n.id}`).join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    },
  },
  {
    name: 'delete_memory',
    title: 'Delete a memory',
    description:
      'Remove a note from the graph. Links pointing at it become unwritten links rather than disappearing, so the reference stays visible. Use sparingly — prefer update_memory when a note is merely out of date.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Exact note id to delete.' } },
      required: ['id'],
    },
    run: (args) => {
      const id = str(args, 'id');
      if (!id) return toolError('delete_memory needs an "id".');
      const note = getNote(projectPath, id);
      if (!note) return toolError(`No memory with id "${id}". delete_memory needs the exact id, not a title.`);
      const back = backlinksOf(projectPath, note.id);
      deleteNote(projectPath, note.id);
      return text(
        `Deleted ${note.id} — ${note.title}.` +
          (back.length ? `\n${back.length} note${back.length === 1 ? '' : 's'} still reference it: ${back.map((b) => b.id).join(', ')}` : ''),
      );
    },
  },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

const INSTRUCTIONS =
  `Shared, persistent project memory for ${projectPath}, stored as markdown at ${memoryDir(projectPath)} and readable by every agent working on this project.\n\n` +
  'Search it before concluding something is unknown, and write to it whenever you learn something that would be expensive to work out again: ' +
  'a decision and its reasoning, how a subsystem really behaves, a constraint, a convention, a dead end worth not repeating. ' +
  'Connect notes with [[wikilinks]] as you go — a linked note is found again, an isolated one is not.';

/* ── dispatch ───────────────────────────────────────────────────────────── */

function handle(msg: RpcMessage): void {
  const { method } = msg;
  const hasId = msg.id !== undefined && msg.id !== null;
  const id = msg.id as string | number;

  // A response or a notification. Neither gets an answer; replying to a
  // notification is a protocol violation some clients treat as fatal.
  if (!method) return;

  switch (method) {
    case 'initialize': {
      if (!hasId) return;
      const params = (msg.params ?? {}) as { protocolVersion?: string; clientInfo?: { name?: string; version?: string } };
      const wanted = String(params.protocolVersion ?? '');
      const name = String(params.clientInfo?.name ?? '').trim();
      if (name) clientLabel = name.toLowerCase().replace(/\s+/g, '-').slice(0, 40);
      log(`initialize from ${name || 'unknown client'} (protocol ${wanted || 'unspecified'})`);
      respond(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(wanted) ? wanted : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: 'Eaon Memory', version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
      return;
    }

    case 'notifications/initialized':
    case 'initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
      return;

    case 'ping': {
      if (hasId) respond(id, {});
      return;
    }

    case 'tools/list': {
      if (!hasId) return;
      respond(id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
      return;
    }

    case 'tools/call': {
      if (!hasId) return;
      const params = (msg.params ?? {}) as { name?: string; arguments?: unknown };
      const tool = BY_NAME.get(String(params.name ?? ''));
      if (!tool) {
        fail(id, ERR_INVALID_PARAMS, `Unknown tool "${params.name}". Available: ${TOOLS.map((t) => t.name).join(', ')}`);
        return;
      }
      const args =
        params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        respond(id, tool.run(args));
      } catch (err) {
        // A failed tool call is data the model should see and recover from,
        // not a transport error — so it comes back as an isError result.
        const message = err instanceof Error ? err.message : String(err);
        log(`tool ${tool.name} failed: ${message}`);
        respond(id, toolError(`${tool.name} failed: ${message}`));
      }
      return;
    }

    // Not advertised in capabilities, but clients probe for them anyway and an
    // error here reads as a broken server. Empty lists are the honest answer.
    case 'resources/list': {
      if (hasId) respond(id, { resources: [] });
      return;
    }
    case 'resources/templates/list': {
      if (hasId) respond(id, { resourceTemplates: [] });
      return;
    }
    case 'prompts/list': {
      if (hasId) respond(id, { prompts: [] });
      return;
    }

    default: {
      if (hasId) fail(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }
}

function receive(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: ERR_PARSE, message: 'Parse error: invalid JSON' } });
    return;
  }

  // Batches were dropped in the 2025-06-18 revision, but an older client may
  // still send one and unpacking it costs three lines.
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const entry of messages) {
    if (!entry || typeof entry !== 'object') {
      write({ jsonrpc: '2.0', id: null, error: { code: ERR_INVALID_REQUEST, message: 'Invalid request' } });
      continue;
    }
    const msg = entry as RpcMessage;
    try {
      handle(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`internal error handling ${msg.method}: ${message}`);
      if (msg.id !== undefined && msg.id !== null) fail(msg.id as string | number, ERR_INTERNAL, message);
    }
  }
}

/* ── boot ───────────────────────────────────────────────────────────────── */

function main(): void {
  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    log(`project path is not a directory: ${projectPath}`);
    process.exit(2);
  }
  try {
    // Created up front so the folder exists for a `ls` even before the first
    // note — an empty memory folder is a much clearer signal than a missing one.
    mkdirSync(memoryDir(projectPath), { recursive: true });
  } catch (err) {
    log(`could not create ${memoryDir(projectPath)}: ${String(err)}`);
  }

  log(`serving ${memoryDir(projectPath)}`);

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      receive(line);
      newline = buffer.indexOf('\n');
    }
  });
  process.stdin.on('end', () => {
    if (buffer.trim()) receive(buffer);
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(0));
  // The client closing the pipe is the normal shutdown path, not a crash.
  process.stdout.on('error', () => process.exit(0));
  process.stdin.resume();
}

main();
