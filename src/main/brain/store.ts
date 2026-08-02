import fs from 'node:fs'
import path from 'node:path'
import {
  BRAIN_DIR,
  keywords,
  parseLinks,
  slugify,
  type BrainGraph,
  type BrainStats,
  type Memory,
  type MemoryMeta,
  type SearchHit
} from '../../shared/brain'

/**
 * Reads and writes the brain folder.
 *
 * Deliberately stateless beyond a short cache: the same files are edited by
 * agents over MCP, by the app, and by whoever runs `git pull`. Re-reading is
 * cheap and always right, which matters more here than shaving milliseconds.
 */

interface Parsed {
  frontmatter: Record<string, unknown>
  body: string
}

/** Minimal YAML frontmatter reader — scalars, and inline or dashed lists. */
function parseFrontmatter(raw: string): Parsed {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: {}, body: raw }

  const head = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const frontmatter: Record<string, unknown> = {}

  let currentKey: string | null = null
  for (const line of head.split('\n')) {
    const listItem = line.match(/^\s*-\s+(.*)$/)
    if (listItem && currentKey) {
      const arr = (frontmatter[currentKey] as string[]) ?? []
      arr.push(unquote(listItem[1]))
      frontmatter[currentKey] = arr
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, rest] = kv
    currentKey = key
    if (rest === '') {
      frontmatter[key] = []
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      frontmatter[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean)
    } else {
      frontmatter[key] = unquote(rest)
    }
  }
  return { frontmatter, body }
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, '').trim()
}

/**
 * Tags as YAML.
 *
 * The inline form reads back by splitting on commas, so a tag containing one
 * would come back as two. Those go on their own lines instead, where nothing
 * needs escaping. Everything else keeps the compact form, because that is what
 * almost every note has and it diffs better.
 */
function serializeTags(tags: string[]): string {
  if (!tags.length) return 'tags: []'
  if (tags.some((t) => /[,[\]"']/.test(t))) {
    return `tags:\n${tags.map((t) => `  - ${t}`).join('\n')}`
  }
  return `tags: [${tags.join(', ')}]`
}

function serialize(meta: {
  title: string
  tags: string[]
  created: string
  updated: string
}, body: string): string {
  return (
    `---\n` +
    `title: ${meta.title}\n` +
    `${serializeTags(meta.tags)}\n` +
    `created: ${meta.created}\n` +
    `updated: ${meta.updated}\n` +
    `---\n\n` +
    body.replace(/^\n+/, '').replace(/\s+$/, '') +
    '\n'
  )
}

export class BrainStore {
  private root: string | null = null

  /** Point the store at a workspace. Creates the folder on first use. */
  setWorkspace(cwd: string | null): void {
    this.root = cwd ? path.join(cwd, BRAIN_DIR) : null
  }

  currentRoot(): string | null {
    return this.root
  }

  private ensure(): string | null {
    if (!this.root) return null
    try {
      fs.mkdirSync(this.root, { recursive: true })
      return this.root
    } catch {
      return null
    }
  }

  private files(): string[] {
    const root = this.root
    if (!root || !fs.existsSync(root)) return []
    try {
      return fs
        .readdirSync(root)
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.join(root, f))
    } catch {
      return []
    }
  }

  /** Every note, with links resolved into a backlink map. */
  all(): Memory[] {
    const raw = this.files().map((file) => this.readFile(file)).filter((m): m is Memory => !!m)

    // Titles and slugs both resolve, so [[Auth flow]] and [[auth-flow]] work.
    const bySlug = new Map(raw.map((m) => [m.slug, m]))
    const byTitle = new Map(raw.map((m) => [m.title.toLowerCase(), m]))
    const resolve = (target: string): string | null => {
      const derived = slugify(target)
      return (
        bySlug.get(target)?.slug ??
        byTitle.get(target.toLowerCase())?.slug ??
        // Skipped for the degenerate slug — see get().
        (derived === 'untitled' ? undefined : bySlug.get(derived)?.slug) ??
        null
      )
    }

    const backlinks = new Map<string, Set<string>>()
    for (const m of raw) {
      const resolved: string[] = []
      const unresolved: string[] = []
      for (const target of m.links) {
        const slug = resolve(target)
        if (slug && slug !== m.slug) resolved.push(slug)
        else if (!slug) unresolved.push(target)
      }
      m.links = [...new Set(resolved)]
      m.unresolved = unresolved
      for (const to of m.links) {
        if (!backlinks.has(to)) backlinks.set(to, new Set())
        backlinks.get(to)!.add(m.slug)
      }
    }
    for (const m of raw) m.backlinks = [...(backlinks.get(m.slug) ?? [])]
    return raw.sort((a, b) => a.title.localeCompare(b.title))
  }

  private readFile(file: string): Memory | null {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const { frontmatter, body } = parseFrontmatter(raw)
      const slug = path.basename(file, '.md')
      const stat = fs.statSync(file)
      const tags = Array.isArray(frontmatter.tags)
        ? (frontmatter.tags as string[])
        : typeof frontmatter.tags === 'string' && frontmatter.tags
          ? [frontmatter.tags as string]
          : []
      return {
        slug,
        title: (frontmatter.title as string) || slug,
        tags,
        created: (frontmatter.created as string) || stat.birthtime.toISOString(),
        updated: (frontmatter.updated as string) || stat.mtime.toISOString(),
        path: file,
        words: body.split(/\s+/).filter(Boolean).length,
        // Raw targets here; all() resolves them.
        links: parseLinks(body),
        backlinks: [],
        unresolved: [],
        content: body
      }
    } catch {
      return null
    }
  }

  list(): MemoryMeta[] {
    return this.all().map(({ content: _content, unresolved: _u, ...meta }) => meta)
  }

  get(slugOrTitle: string): Memory | null {
    const all = this.all()
    // The slugified fallback lets [[Auth Flow]] find auth-flow.md. It is skipped
    // for the degenerate slug, since every title with no latin characters
    // reduces to "untitled" and matching on that would conflate unrelated notes.
    const derived = slugify(slugOrTitle)
    return (
      all.find((m) => m.slug === slugOrTitle) ??
      all.find((m) => m.title.toLowerCase() === slugOrTitle.toLowerCase()) ??
      (derived === 'untitled' ? null : all.find((m) => m.slug === derived)) ??
      null
    )
  }

  /**
   * The note a write should replace, or null to create a new one.
   *
   * Deliberately stricter than get(): only the same slug or the same title
   * counts. get() also falls back to comparing slugified titles, which is right
   * when resolving a [[link]] and catastrophic here — two different titles that
   * slugify alike ("Auth flow?" and "Auth flow!", or any two non-latin titles,
   * which both reduce to "untitled") would make the second write silently
   * overwrite the first and report success. uniqueSlug gives them separate
   * files instead.
   */
  private target(input: { title: string; slug?: string }): Memory | null {
    const all = this.all()
    if (input.slug) return all.find((m) => m.slug === input.slug) ?? null
    const title = input.title.trim().toLowerCase()
    return all.find((m) => m.title.toLowerCase() === title) ?? null
  }

  /** Create or update. Matching an existing title updates it in place. */
  write(input: { title: string; content: string; tags?: string[]; slug?: string }): Memory | null {
    const root = this.ensure()
    if (!root) return null

    const existing = this.target(input)
    const slug = existing?.slug ?? this.uniqueSlug(slugify(input.title))
    const now = new Date().toISOString()

    const file = path.join(root, `${slug}.md`)
    const text = serialize(
      {
        title: input.title.trim() || slug,
        tags: (input.tags ?? existing?.tags ?? []).map((t) => t.trim()).filter(Boolean),
        created: existing?.created ?? now,
        updated: now
      },
      input.content
    )

    // Written beside the target and renamed over it, because rename is atomic.
    // Agents and the app write these files concurrently by design, and a plain
    // write truncates first — a reader arriving in that window would see half a
    // note and, worse, could save the truncated version back.
    const temp = path.join(root, `.${slug}.md.tmp`)
    try {
      fs.writeFileSync(temp, text, 'utf8')
      fs.renameSync(temp, file)
    } catch {
      try {
        fs.rmSync(temp, { force: true })
      } catch {
        // Nothing useful to do; the note simply was not saved.
      }
      return null
    }
    return this.get(slug)
  }

  private uniqueSlug(base: string): string {
    const root = this.root
    if (!root) return base
    let slug = base
    let n = 2
    while (fs.existsSync(path.join(root, `${slug}.md`))) {
      slug = `${base}-${n}`
      n += 1
    }
    return slug
  }

  remove(slug: string): boolean {
    const target = this.get(slug)
    if (!target) return false
    try {
      fs.rmSync(target.path)
      return true
    } catch {
      return false
    }
  }

  /** Appends a [[link]] to `from`, creating the target stub if needed. */
  link(from: string, to: string): Memory | null {
    const source = this.get(from)
    if (!source) return null
    let target = this.get(to)
    if (!target) target = this.write({ title: to, content: `Stub created by a link from [[${source.title}]].` })
    if (!target) return null
    if (source.links.includes(target.slug)) return source

    const body = `${source.content.replace(/\s+$/, '')}\n\nRelated: [[${target.title}]]\n`
    return this.write({ slug: source.slug, title: source.title, content: body, tags: source.tags })
  }

  search(query: string, limit = 20): SearchHit[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const terms = q.split(/\s+/).filter(Boolean)
    const hits: SearchHit[] = []

    for (const m of this.all()) {
      const haystack = `${m.title}\n${m.tags.join(' ')}\n${m.content}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (m.title.toLowerCase().includes(term)) score += 10
        if (m.tags.some((t) => t.toLowerCase().includes(term))) score += 6
        const occurrences = haystack.split(term).length - 1
        score += Math.min(occurrences, 8)
      }
      if (score <= 0) continue

      // Show the first line that actually contains a term.
      const line =
        m.content
          .split('\n')
          .find((l) => terms.some((t) => l.toLowerCase().includes(t)))
          ?.trim() ?? m.content.split('\n').find((l) => l.trim())?.trim() ?? ''
      hits.push({
        slug: m.slug,
        title: m.title,
        snippet: line.length > 180 ? `${line.slice(0, 179)}…` : line,
        score
      })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /** Backlinks plus notes that share vocabulary but are not linked yet. */
  related(slugOrTitle: string, limit = 6): { backlinks: MemoryMeta[]; suggested: { meta: MemoryMeta; terms: string[] }[] } {
    const all = this.all()
    const target = this.get(slugOrTitle)
    if (!target) return { backlinks: [], suggested: [] }

    const strip = ({ content: _c, unresolved: _u, ...meta }: Memory): MemoryMeta => meta
    const backlinks = all.filter((m) => target.backlinks.includes(m.slug)).map(strip)

    const mine = new Set(keywords(`${target.title} ${target.content}`))
    const linked = new Set([...target.links, ...target.backlinks, target.slug])

    const suggested = all
      .filter((m) => !linked.has(m.slug))
      .map((m) => {
        const theirs = keywords(`${m.title} ${m.content}`)
        const shared = theirs.filter((t) => mine.has(t))
        return { meta: strip(m), terms: shared.slice(0, 4), score: shared.length }
      })
      .filter((r) => r.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ meta, terms }) => ({ meta, terms }))

    return { backlinks, suggested }
  }

  graph(): BrainGraph {
    const all = this.all()
    const edges: { from: string; to: string }[] = []
    for (const m of all) for (const to of m.links) edges.push({ from: m.slug, to })
    return {
      nodes: all.map((m) => ({
        slug: m.slug,
        title: m.title,
        tags: m.tags,
        degree: m.links.length + m.backlinks.length
      })),
      edges,
      orphans: all.filter((m) => m.links.length === 0 && m.backlinks.length === 0).map((m) => m.slug)
    }
  }

  stats(): BrainStats {
    const all = this.all()
    return {
      memories: all.length,
      links: all.reduce((n, m) => n + m.links.length, 0),
      orphans: all.filter((m) => m.links.length === 0 && m.backlinks.length === 0).length,
      root: this.root ?? '',
      available: Boolean(this.root)
    }
  }
}
