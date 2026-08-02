import { useEffect, useRef } from 'react'
import type { BrainGraph as Graph } from '@shared/brain'

interface Node {
  slug: string
  title: string
  degree: number
  x: number
  y: number
  vx: number
  vy: number
}

/**
 * The memory graph, laid out by a small force simulation on a canvas.
 *
 * Canvas rather than SVG because a few hundred nodes with live physics is a lot
 * of DOM to keep in sync, and none of it needs to be individually stylable.
 */
export function BrainGraph({
  graph,
  selected,
  onSelect
}: {
  graph: Graph
  selected: string | null
  onSelect: (slug: string) => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<Node[]>([])
  const hoverRef = useRef<string | null>(null)
  const selectedRef = useRef(selected)

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    // Seed on a circle so the first frames spread outward instead of exploding
    // out of a single point.
    const previous = new Map(nodesRef.current.map((n) => [n.slug, n]))
    nodesRef.current = graph.nodes.map((n, i) => {
      const kept = previous.get(n.slug)
      const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2
      return (
        kept ?? {
          slug: n.slug,
          title: n.title,
          degree: n.degree,
          x: Math.cos(angle) * 140,
          y: Math.sin(angle) * 140,
          vx: 0,
          vy: 0
        }
      )
    })
    for (const n of nodesRef.current) {
      const fresh = graph.nodes.find((g) => g.slug === n.slug)
      if (fresh) {
        n.degree = fresh.degree
        n.title = fresh.title
      }
    }
  }, [graph])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const style = getComputedStyle(document.documentElement)
    const read = (name: string): string => style.getPropertyValue(name).trim()

    let raf = 0
    let alpha = 1

    const step = (): void => {
      const nodes = nodesRef.current
      const byId = new Map(nodes.map((n) => [n.slug, n]))

      // Repulsion, so unrelated notes drift apart.
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i]
          const b = nodes[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) {
            dx = (Math.random() - 0.5) * 2
            dy = (Math.random() - 0.5) * 2
            d2 = 1
          }
          const force = 2600 / d2
          const d = Math.sqrt(d2)
          const fx = (dx / d) * force
          const fy = (dy / d) * force
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }

      // Springs along links.
      for (const e of graph.edges) {
        const a = byId.get(e.from)
        const b = byId.get(e.to)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.max(1, Math.hypot(dx, dy))
        const force = (d - 96) * 0.012
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      for (const n of nodes) {
        // Weak pull to the middle so nothing escapes entirely.
        n.vx -= n.x * 0.004
        n.vy -= n.y * 0.004
        n.vx *= 0.86
        n.vy *= 0.86
        n.x += n.vx * alpha
        n.y += n.vy * alpha
      }

      // Recentre on the centroid. Without this a lopsided graph slowly drifts
      // into a corner and the empty half of the canvas looks like a bug.
      if (nodes.length) {
        let cx = 0
        let cy = 0
        for (const n of nodes) {
          cx += n.x
          cy += n.y
        }
        cx /= nodes.length
        cy /= nodes.length
        for (const n of nodes) {
          n.x -= cx
          n.y -= cy
        }
      }
      alpha = Math.max(0.12, alpha * 0.995)
    }

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.save()
      ctx.translate(w / 2, h / 2)

      const nodes = nodesRef.current
      const byId = new Map(nodes.map((n) => [n.slug, n]))
      const active = selectedRef.current ?? hoverRef.current
      const neighbours = new Set<string>()
      if (active) {
        for (const e of graph.edges) {
          if (e.from === active) neighbours.add(e.to)
          if (e.to === active) neighbours.add(e.from)
        }
      }

      const line = read('--line-300') || '#333'
      const accent = read('--accent') || '#f17455'
      const textHi = read('--text-hi') || '#eee'
      const textLo = read('--text-lo') || '#888'
      const surface = read('--ink-400') || '#222'

      // Edges first, so nodes sit on top of them.
      for (const e of graph.edges) {
        const a = byId.get(e.from)
        const b = byId.get(e.to)
        if (!a || !b) continue
        const lit = active && (e.from === active || e.to === active)
        ctx.strokeStyle = lit ? accent : line
        ctx.globalAlpha = lit ? 0.75 : active ? 0.13 : 0.35
        ctx.lineWidth = lit ? 1.4 : 1
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      for (const n of nodes) {
        const isActive = n.slug === active
        const isNeighbour = neighbours.has(n.slug)
        const dim = Boolean(active) && !isActive && !isNeighbour
        const r = 6 + Math.min(10, n.degree * 1.6)

        ctx.globalAlpha = dim ? 0.28 : 1
        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fillStyle = isActive ? accent : surface
        ctx.fill()
        if (!isActive) {
          ctx.strokeStyle = isNeighbour ? accent : line
          ctx.lineWidth = 1
          ctx.stroke()
        }

        ctx.fillStyle = isActive ? textHi : textLo
        ctx.font = `${isActive ? 600 : 400} 11px ${read('--font-ui') || 'sans-serif'}`
        ctx.textBaseline = 'middle'
        const label = n.title.length > 26 ? `${n.title.slice(0, 25)}…` : n.title
        ctx.fillText(label, n.x + r + 6, n.y)
      }

      ctx.globalAlpha = 1
      ctx.restore()
    }

    const frame = (): void => {
      step()
      draw()
      raf = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(raf)
  }, [graph])

  const hit = (e: React.MouseEvent): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - rect.width / 2
    const y = e.clientY - rect.top - rect.height / 2
    let best: { slug: string; d: number } | null = null
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x - x, n.y - y)
      const r = 10 + Math.min(10, n.degree * 1.6)
      if (d < r && (!best || d < best.d)) best = { slug: n.slug, d }
    }
    return best?.slug ?? null
  }

  return (
    <canvas
      ref={canvasRef}
      className="brain-canvas"
      onMouseMove={(e) => {
        const slug = hit(e)
        hoverRef.current = slug
        if (canvasRef.current) canvasRef.current.style.cursor = slug ? 'pointer' : 'default'
      }}
      onMouseLeave={() => (hoverRef.current = null)}
      onClick={(e) => {
        const slug = hit(e)
        if (slug) onSelect(slug)
      }}
    />
  )
}
