import { useEffect, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Loader, TriangleAlert } from 'lucide-react'

/**
 * Markdown, images and PDFs, rendered from a local file path.
 *
 * Local only, for now — matching the boundary `EditorPanel` already draws.
 * Reading a remote workspace's file needs SFTP, which nothing in this app
 * does yet; previewing one is future work on top of that, not a shortcut
 * around it.
 *
 * The three formats take three different routes across the IPC bridge, and
 * the routing is the reason this file exists rather than each caller picking
 * its own: Markdown is plain UTF-8 text, so it goes through the ordinary
 * `fs.read`. Images and PDFs are never valid UTF-8, so they go through
 * `fs.readBinary` and arrive as base64 — the renderer's Content-Security-
 * Policy admits `data:` sources but not `file:`, so this round trip is not
 * an optimisation, it is the only way either format can appear at all.
 */

export type PreviewKind = 'markdown' | 'image' | 'pdf' | 'unsupported'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

export function previewKindFor(filePath: string): PreviewKind {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXT.has(ext)) return 'image'
  return 'unsupported'
}

/**
 * Markdown to sanitized HTML.
 *
 * `marked` is configured with `gfm` for the task-list/table/strikethrough
 * syntax every real README uses, and nothing else — no raw-HTML pass-through
 * option, so the sanitizer is working on marked's own output, not whatever a
 * file's author embedded. DOMPurify's default profile (script tags, event
 * handler attributes, `javascript:` hrefs, `<iframe>`/`<object>`) is used
 * unmodified rather than a hand-picked allowlist: this is exactly the case a
 * general-purpose, audited sanitizer exists for, and a bespoke allowlist here
 * would only be a worse, unaudited copy of it.
 */
function markdownToSafeHtml(source: string): string {
  const raw = marked.parse(source, { async: false, gfm: true, breaks: false }) as string
  return DOMPurify.sanitize(raw)
}

function dataUrlFor(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`
}

export function FilePreviewBody({
  path,
  markdownOverride
}: {
  path: string
  /**
   * Render this text instead of reading `path` from disk. For markdown only —
   * the one format previewed from inside a live editor, where the buffer may
   * hold edits that were never saved. Rendering the saved copy on disk would
   * either show something the user already moved past, or silently discard
   * what they were about to save the moment they toggled back to look at it.
   */
  markdownOverride?: string
}): React.JSX.Element {
  const kind = previewKindFor(path)
  const [html, setHtml] = useState<string | null>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (kind === 'markdown' && markdownOverride !== undefined) {
      setHtml(markdownToSafeHtml(markdownOverride))
      setError(null)
      setLoading(false)
      return
    }

    let live = true
    setLoading(true)
    setError(null)
    setHtml(null)
    setDataUrl(null)

    void (async () => {
      try {
        if (kind === 'markdown') {
          const { text } = await window.eaon.fs.read(path)
          if (live) setHtml(markdownToSafeHtml(text))
        } else if (kind === 'image' || kind === 'pdf') {
          const { base64, mime } = await window.eaon.fs.readBinary(path)
          if (live) setDataUrl(dataUrlFor(mime, base64))
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (live) setLoading(false)
      }
    })()

    return () => {
      live = false
    }
  }, [path, kind, markdownOverride])

  // Rendered links navigate to the outside world, not this window — clicking
  // one inside a README should open a browser, not try to load someone
  // else's site into Eaon's own CSP-locked frame.
  const onClickLink = (e: React.MouseEvent<HTMLDivElement>): void => {
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    const href = link.getAttribute('href')
    if (!href || href.startsWith('#')) return
    e.preventDefault()
    window.eaon.sys.openExternal(href)
  }

  if (kind === 'unsupported') {
    return (
      <div className="fp-empty">
        <TriangleAlert size={16} />
        <span>Eaon can’t preview this file type yet.</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="fp-empty">
        <Loader size={16} className="spin" />
        <span>Reading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fp-empty" data-error="true">
        <TriangleAlert size={16} />
        <span>{error}</span>
      </div>
    )
  }

  if (kind === 'markdown' && html) {
    // Sanitized immediately above, and nowhere else in this component — see
    // markdownToSafeHtml. If this ever renders unsanitized input, that is a
    // security bug in this file, not in whatever called it.
    return (
      <div
        className="fp-markdown"
        onClick={onClickLink}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  if (kind === 'image' && dataUrl) {
    return (
      <div className="fp-image-wrap">
        <img className="fp-image" src={dataUrl} alt={path.split('/').pop()} />
      </div>
    )
  }

  if (kind === 'pdf' && dataUrl) {
    // Chromium's own PDF viewer, the same one the browser panel already
    // trusts — not a new dependency, not a new rendering surface.
    return <iframe className="fp-pdf" src={dataUrl} title={path.split('/').pop()} />
  }

  return <div className="fp-empty" />
}
