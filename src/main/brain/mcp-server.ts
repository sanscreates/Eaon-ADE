/**
 * Eaon Brain MCP server.
 *
 * A standalone stdio process that any MCP client — Claude Code, Codex, this app
 * — can attach to in order to read and write the project's memory. Registered
 * per-workspace in `.mcp.json`, so a fresh agent session inherits everything
 * earlier sessions wrote instead of rebuilding context from the source tree.
 *
 * Speaks JSON-RPC 2.0 over newline-delimited stdin/stdout. stdout carries
 * protocol traffic only; anything diagnostic goes to stderr, because a stray
 * console.log here corrupts the stream and the client drops the connection.
 *
 *   node mcp-server.js --root /path/to/workspace
 */
import { createInterface } from 'node:readline'
import { BrainStore } from './store'
import { BRAIN_DIR } from '../../shared/brain'

const PROTOCOL_VERSION = '2024-11-05'
const SERVER = { name: 'eaon-brain', version: '1.0.0' }

const rootArg = process.argv.indexOf('--root')
const workspace = rootArg !== -1 ? process.argv[rootArg + 1] : process.cwd()

// One server process per workspace, pinned to that workspace's folder — which
// is what has always made the agent side of this per-folder.
const store = new BrainStore(workspace)

const log = (...args: unknown[]): void => console.error('[eaon-brain]', ...args)

interface Rpc {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

function send(message: Rpc): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function ok(id: Rpc['id'], result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}

function fail(id: Rpc['id'], code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

/** MCP tool results are a list of content blocks. */
function text(body: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: body }] }
}

/**
 * `isError: true` on the result — not a protocol-level failure, but a tool
 * call that did not do what it says. Distinct from `text()` for exactly one
 * reason: it is the signal a model reliably treats as "this needs fixing and
 * retrying" rather than as data to act on, which a validation failure most
 * certainly is not.
 */
function errorText(body: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: body }], isError: true }
}

const TOOLS = [
  {
    name: 'brain_search',
    description:
      'Search the project memory for anything already known about a topic. Call this FIRST, before reading source files, whenever you need background on this project — architecture, conventions, gotchas, decisions and their reasons.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for in titles, tags and body text.' },
        limit: { type: 'number', description: 'Maximum results. Default 10.' }
      },
      required: ['query']
    }
  },
  {
    name: 'brain_list',
    description:
      'List every memory, newest first, with tags and link counts. Useful for getting oriented at the start of a session.',
    inputSchema: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'Only memories carrying this tag.' } }
    }
  },
  {
    name: 'brain_read',
    description:
      'Read one memory in full, including what it links to and what links back to it. Accepts a title or a slug.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title']
    }
  },
  {
    name: 'brain_write',
    description:
      'Record something worth keeping: an architectural decision and why, a convention, a non-obvious gotcha, how a subsystem fits together. Writing an existing title updates it. Reference other memories inline as [[Their Title]] to build the graph. Do NOT record transient state, task lists, or anything already obvious from reading the code.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short and specific, e.g. "Auth flow end to end".' },
        content: { type: 'string', description: 'Markdown. Use [[Other Memory]] to link.' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'brain_link',
    description:
      'Link one memory to another, creating the target as a stub if it does not exist yet.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to']
    }
  },
  {
    name: 'brain_related',
    description:
      'What links to this memory, plus notes that share vocabulary with it but are not linked yet — useful for finding context you did not know to ask for.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title']
    }
  }
]

function call(name: string, args: Record<string, unknown>): ReturnType<typeof text> | ReturnType<typeof errorText> {
  switch (name) {
    case 'brain_search': {
      const hits = store.search(String(args.query ?? ''), Number(args.limit) || 10)
      if (!hits.length) return text('No memories match that. Nothing has been recorded on this yet.')
      return text(
        `${hits.length} match(es):\n\n` +
          hits.map((h) => `- **${h.title}** (${h.slug})\n  ${h.snippet}`).join('\n')
      )
    }

    case 'brain_list': {
      const tag = args.tag ? String(args.tag) : null
      let all = store.list()
      if (tag) all = all.filter((m) => m.tags.includes(tag))
      if (!all.length) return text('The project memory is empty.')
      const sorted = [...all].sort((a, b) => b.updated.localeCompare(a.updated))
      return text(
        `${sorted.length} memories:\n\n` +
          sorted
            .map(
              (m) =>
                `- **${m.title}** (${m.slug})` +
                `${m.tags.length ? ` · ${m.tags.join(', ')}` : ''}` +
                ` · ${m.links.length} out / ${m.backlinks.length} in`
            )
            .join('\n')
      )
    }

    case 'brain_read': {
      const m = store.get(String(args.title ?? ''))
      if (!m) return text(`No memory called "${args.title}".`)
      const parts = [`# ${m.title}`]
      if (m.tags.length) parts.push(`Tags: ${m.tags.join(', ')}`)
      parts.push('', m.content.trim())
      if (m.links.length) parts.push('', `Links to: ${m.links.join(', ')}`)
      if (m.backlinks.length) parts.push(`Linked from: ${m.backlinks.join(', ')}`)
      return text(parts.join('\n'))
    }

    case 'brain_write': {
      // A missing or malformed `content` used to fall through to
      // `String(undefined ?? '')` and quietly save an empty note — a call
      // that looked like it worked (a title, a saved-to path) while the one
      // thing worth keeping never made it to disk. The model gets no signal
      // something went wrong until a future session opens an empty file, by
      // which point whatever it had learned is already gone. Reject instead,
      // with enough detail that a retry fixes it on the first try.
      const title = String(args.title ?? '').trim()
      if (!title) return errorText('brain_write needs a non-empty "title".')
      if (typeof args.content !== 'string' || !args.content.trim()) {
        // The one mistake worth naming specifically: "body" is the obvious
        // guess for "the text of the note" and it is wrong often enough that
        // a generic "content is required" would leave the actual fix unsaid.
        const gotBodyInstead = typeof (args as { body?: unknown }).body === 'string'
        return errorText(
          gotBodyInstead
            ? 'brain_write takes "content", not "body" — the note was not saved. Retry with the same text under "content".'
            : 'brain_write needs a non-empty "content" (the markdown body of the note) — nothing was saved.'
        )
      }
      const saved = store.write({
        title,
        content: args.content,
        tags: Array.isArray(args.tags) ? (args.tags as string[]).map(String) : undefined
      })
      if (!saved) return errorText('Could not write — no workspace folder is available.')
      const unresolved = saved.unresolved.length
        ? ` ${saved.unresolved.length} link(s) point at memories that do not exist yet: ${saved.unresolved.join(', ')}.`
        : ''
      return text(`Saved "${saved.title}" to ${BRAIN_DIR}/${saved.slug}.md.${unresolved}`)
    }

    case 'brain_link': {
      const from = String(args.from ?? '')
      const linked = store.link(from, String(args.to ?? ''))
      if (!linked) return text(`Could not link — no memory called "${from}".`)
      return text(`"${linked.title}" now links to ${linked.links.length} memory/memories.`)
    }

    case 'brain_related': {
      const { backlinks, suggested } = store.related(String(args.title ?? ''))
      const lines: string[] = []
      lines.push(
        backlinks.length
          ? `Linked from:\n${backlinks.map((m) => `- ${m.title} (${m.slug})`).join('\n')}`
          : 'Nothing links here yet.'
      )
      if (suggested.length) {
        lines.push(
          '',
          `Possibly related, not yet linked:\n${suggested
            .map((s) => `- ${s.meta.title} (${s.meta.slug}) — shares: ${s.terms.join(', ')}`)
            .join('\n')}`
        )
      }
      return text(lines.join('\n'))
    }

    default:
      return text(`Unknown tool: ${name}`)
  }
}

const rl = createInterface({ input: process.stdin })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let msg: Rpc
  try {
    msg = JSON.parse(trimmed)
  } catch {
    log('dropped unparseable line')
    return
  }

  // Notifications carry no id and expect no reply.
  const isNotification = msg.id === undefined || msg.id === null

  try {
    switch (msg.method) {
      case 'initialize':
        ok(msg.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER
        })
        return

      case 'notifications/initialized':
        return

      case 'ping':
        ok(msg.id, {})
        return

      case 'tools/list':
        ok(msg.id, { tools: TOOLS })
        return

      case 'tools/call': {
        const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
        if (!params.name) return fail(msg.id, -32602, 'Missing tool name')
        ok(msg.id, call(params.name, params.arguments ?? {}))
        return
      }

      default:
        if (!isNotification) fail(msg.id, -32601, `Method not found: ${msg.method}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('handler failed:', message)
    if (!isNotification) fail(msg.id, -32603, message)
  }
})

rl.on('close', () => process.exit(0))

log(`serving ${BRAIN_DIR} for ${workspace}`)
