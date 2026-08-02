/**
 * Eaon Brain — project memory that outlives any one agent session.
 *
 * Everything is plain markdown in `.eaonbrain/` next to the repo, so it diffs,
 * reviews and commits like code. Notes reference each other with [[wiki links]],
 * which makes the folder a graph rather than a pile of files. Agents reach it
 * over MCP, so what one session learns the next one starts with.
 */

export const BRAIN_DIR = '.eaonbrain'

export interface MemoryMeta {
  /** Filename without extension. Stable; the title can change freely. */
  slug: string
  title: string
  tags: string[]
  created: string
  updated: string
  /** Absolute path on disk. */
  path: string
  words: number
  /** Slugs this note links out to, resolved and deduped. */
  links: string[]
  /** Slugs that link here. */
  backlinks: string[]
}

export interface Memory extends MemoryMeta {
  content: string
  /** [[targets]] that do not resolve to a file yet. */
  unresolved: string[]
}

export interface GraphNode {
  slug: string
  title: string
  tags: string[]
  /** links + backlinks, used for node size. */
  degree: number
}

export interface GraphEdge {
  from: string
  to: string
}

export interface BrainGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Notes with no links in either direction. */
  orphans: string[]
}

export interface SearchHit {
  slug: string
  title: string
  /** Matching line, trimmed, with surrounding context. */
  snippet: string
  score: number
}

export interface BrainStats {
  memories: number
  links: number
  orphans: number
  /** Absolute path of the brain folder. */
  root: string
  /** False when no workspace is open or the folder cannot be created. */
  available: boolean
}

/** Filesystem-safe id derived from a title. */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return base || 'untitled'
}

/**
 * Pulls [[wiki links]] out of markdown, ignoring anything inside a fenced or
 * inline code span — a link in an example is documentation, not an edge.
 */
export function parseLinks(markdown: string): string[] {
  const withoutCode = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
  const out: string[] = []
  const re = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(withoutCode)) !== null) {
    const target = m[1].trim()
    if (target) out.push(target)
  }
  return [...new Set(out)]
}

/** Words that carry no signal when looking for related notes. */
const STOP = new Set([
  'the','a','an','and','or','but','if','then','else','for','of','to','in','on','at','by','with',
  'is','are','was','were','be','been','it','its','this','that','these','those','as','from','into',
  'we','you','they','he','she','not','no','can','will','would','should','could','has','have','had',
  'do','does','did','so','than','when','while','which','what','how','why','all','any','each','more'
])

/** Content terms for the "related" heuristic. */
export function keywords(text: string, limit = 24): string[] {
  const counts = new Map<string, number>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOP.has(raw)) continue
    counts.set(raw, (counts.get(raw) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w)
}
