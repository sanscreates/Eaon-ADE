import { useEffect, useMemo, useRef } from 'react';
import type { MemoryGraph as Graph, MemoryGraphEdge, MemoryGraphNode } from '../lib/types';

/* ═══════════════════════════════════════════════════════════════════════════
   Force-directed view of the note graph.

   Canvas rather than SVG: a few hundred nodes plus their labels is thousands
   of DOM elements repainted sixty times a second, and the browser will not
   thank you for it. Canvas also lets the labels fade with zoom, which is what
   makes a dense graph readable at all.

   The simulation is velocity-Verlet with three forces — pairwise repulsion,
   spring links and a weak pull to the middle — cooled by an alpha that decays
   to nothing. When it settles, the render loop stops entirely: an idle graph
   should cost no CPU, because this panel will be left open for hours.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  node: MemoryGraphNode;
  /** Pinned position while dragging; null otherwise. */
  fx: number | null;
  fy: number | null;
}

const REPULSION = -420;
const LINK_DISTANCE = 78;
const LINK_STRENGTH = 0.32;
const GRAVITY = 0.055;
const VELOCITY_DECAY = 0.58;
const ALPHA_DECAY = 0.018;
const ALPHA_MIN = 0.004;

/** Above this many nodes, repulsion samples instead of visiting every pair. */
const EXACT_LIMIT = 420;
const SAMPLE_SIZE = 180;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** Auto-fit never zooms past this, however few nodes there are. */
const FIT_MAX_ZOOM = 1.35;

/** Node colours by first tag, so clusters read as topics without a legend. */
const TAG_COLORS = [
  '#e0a84d', '#5b9cf8', '#4ec26a', '#e06b9b',
  '#b98cf5', '#4dc4c0', '#f0845a', '#7fb4ff',
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

function radiusFor(node: MemoryGraphNode): number {
  return node.missing ? 4.5 : 5 + Math.min(Math.sqrt(node.degree) * 3.2, 13);
}

/**
 * Phyllotaxis, not random: a sunflower spiral has no coincident points and no
 * symmetry for the forces to lock into, so the layout unfolds the same way
 * every time instead of occasionally starting in a knot.
 */
function seedPosition(index: number): { x: number; y: number } {
  const radius = 14 * Math.sqrt(0.5 + index);
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export interface MemoryGraphProps {
  graph: Graph;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Double-click: for a real note, open it; for a ghost, offer to write it. */
  onOpen: (node: MemoryGraphNode) => void;
  /** Ids to keep lit while everything else dims — the current search results. */
  highlight?: Set<string> | null;
}

export function MemoryGraph({ graph, selectedId, onSelect, onOpen, highlight }: MemoryGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Everything the animation loop touches lives in refs: re-rendering React
  // sixty times a second to move a circle would be absurd.
  const bodies = useRef(new Map<string, Body>());
  const edges = useRef<{ a: Body; b: Body; edge: MemoryGraphEdge }[]>([]);
  const neighbours = useRef(new Map<string, Set<string>>());
  const alpha = useRef(1);
  const frame = useRef(0);
  const view = useRef({ zoom: 1, panX: 0, panY: 0 });
  const pointer = useRef({ x: 0, y: 0, inside: false });
  const hovered = useRef<Body | null>(null);
  const dragging = useRef<Body | null>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const selected = useRef(selectedId);
  const highlightRef = useRef(highlight ?? null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });

  selected.current = selectedId;
  highlightRef.current = highlight ?? null;

  /** Rebuilt only when the graph's shape actually changes. */
  const signature = useMemo(
    () =>
      `${graph.nodes.map((n) => `${n.id}:${n.degree}:${n.missing ? 1 : 0}`).join(',')}|${graph.edges
        .map((e) => `${e.source}>${e.target}`)
        .join(',')}`,
    [graph],
  );

  /* ── sync data into the simulation ────────────────────────────────────── */

  useEffect(() => {
    const next = new Map<string, Body>();
    graph.nodes.forEach((node, i) => {
      const existing = bodies.current.get(node.id);
      if (existing) {
        // Keep the position: a note gaining a tag should not teleport.
        existing.node = node;
        existing.r = radiusFor(node);
        next.set(node.id, existing);
        return;
      }
      const seed = seedPosition(i);
      next.set(node.id, {
        id: node.id,
        x: seed.x,
        y: seed.y,
        vx: 0,
        vy: 0,
        r: radiusFor(node),
        node,
        fx: null,
        fy: null,
      });
    });
    bodies.current = next;

    const links: { a: Body; b: Body; edge: MemoryGraphEdge }[] = [];
    const near = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      const a = next.get(edge.source);
      const b = next.get(edge.target);
      if (!a || !b || a === b) continue;
      links.push({ a, b, edge });
      if (!near.has(edge.source)) near.set(edge.source, new Set());
      if (!near.has(edge.target)) near.set(edge.target, new Set());
      near.get(edge.source)!.add(edge.target);
      near.get(edge.target)!.add(edge.source);
    }
    edges.current = links;
    neighbours.current = near;

    alpha.current = Math.max(alpha.current, 0.75);
    start();
  }, [signature]);

  /* ── canvas sizing ────────────────────────────────────────────────────── */

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (rect.width === 0 || rect.height === 0) return;
      size.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      draw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /* ── simulation ───────────────────────────────────────────────────────── */

  function tick(): void {
    const list = [...bodies.current.values()];
    const n = list.length;
    if (n === 0) return;
    const a = alpha.current;

    if (n <= EXACT_LIMIT) {
      for (let i = 0; i < n; i++) {
        const p = list[i];
        for (let j = i + 1; j < n; j++) {
          const q = list[j];
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            // Exactly coincident nodes have no direction to separate along;
            // nudge them deterministically rather than leaving them fused.
            dx = (i % 7) - 3 + 0.5;
            dy = (j % 5) - 2 + 0.5;
            d2 = dx * dx + dy * dy;
          }
          const w = (REPULSION * a) / d2;
          p.vx += dx * w;
          p.vy += dy * w;
          q.vx -= dx * w;
          q.vy -= dy * w;
        }
      }
    } else {
      // Stochastic approximation: each node is repelled by a rotating sample
      // of the others. Over a handful of frames every pair gets considered,
      // and the layout looks identical without the quadratic cost.
      const stride = Math.max(1, Math.floor(n / SAMPLE_SIZE));
      const offset = frame.current % stride;
      const scale = stride;
      for (let i = 0; i < n; i++) {
        const p = list[i];
        for (let j = offset; j < n; j += stride) {
          if (j === i) continue;
          const q = list[j];
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (i % 7) - 3 + 0.5;
            dy = (j % 5) - 2 + 0.5;
            d2 = dx * dx + dy * dy;
          }
          const w = (REPULSION * a * scale) / d2;
          p.vx += dx * w;
          p.vy += dy * w;
        }
      }
    }

    for (const { a: p, b: q } of edges.current) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = ((d - LINK_DISTANCE) / d) * a * LINK_STRENGTH;
      // Heavier nodes move less, which keeps hubs near the middle instead of
      // being flung around by every leaf attached to them.
      const pw = p.r / (p.r + q.r);
      const qw = 1 - pw;
      q.vx -= dx * force * qw;
      q.vy -= dy * force * qw;
      p.vx += dx * force * pw;
      p.vy += dy * force * pw;
    }

    for (const body of list) {
      body.vx -= body.x * GRAVITY * a;
      body.vy -= body.y * GRAVITY * a;
      if (body.fx !== null && body.fy !== null) {
        body.x = body.fx;
        body.y = body.fy;
        body.vx = 0;
        body.vy = 0;
        continue;
      }
      body.vx *= VELOCITY_DECAY;
      body.vy *= VELOCITY_DECAY;
      body.x += body.vx;
      body.y += body.vy;
    }

    alpha.current = a * (1 - ALPHA_DECAY);
  }

  /* ── painting ─────────────────────────────────────────────────────────── */

  function styles() {
    const root = getComputedStyle(document.documentElement);
    const pick = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
    return {
      accent: pick('--accent', '#f17455'),
      edge: pick('--n-700', '#2a2a2a'),
      edgeStrong: pick('--n-600', '#3a3a3a'),
      text: pick('--n-200', '#b8b8b8'),
      textDim: pick('--n-400', '#767676'),
      surface: pick('--n-900', '#101010'),
      ok: pick('--ok', '#4ec26a'),
    };
  }

  function colorOf(body: Body, palette: ReturnType<typeof styles>): string {
    if (body.node.missing) return palette.textDim;
    if (body.node.tags.length) return tagColor(body.node.tags[0]);
    return palette.textDim;
  }

  function draw(): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current;
    const palette = styles();
    const { zoom, panX, panY } = view.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + panX, h / 2 + panY);
    ctx.scale(zoom, zoom);

    const focus = hovered.current ?? (selected.current ? bodies.current.get(selected.current) ?? null : null);
    const lit = focus ? neighbours.current.get(focus.id) ?? new Set<string>() : null;
    const search = highlightRef.current;

    /** How present a node should look: 1 full, lower for "not what you asked". */
    const emphasis = (id: string): number => {
      if (focus) return id === focus.id || lit?.has(id) ? 1 : 0.16;
      if (search) return search.has(id) ? 1 : 0.18;
      return 1;
    };

    ctx.lineCap = 'round';
    for (const { a, b, edge } of edges.current) {
      const strength = Math.min(emphasis(a.id), emphasis(b.id));
      ctx.globalAlpha = strength === 1 ? 0.55 : 0.09;
      ctx.strokeStyle = edge.mutual ? palette.edgeStrong : palette.edge;
      ctx.lineWidth = (edge.mutual ? 1.5 : 1) / zoom;
      // A link to a note nobody has written is drawn as an unfinished line.
      ctx.setLineDash(b.node.missing || a.node.missing ? [3 / zoom, 3 / zoom] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const body of bodies.current.values()) {
      const strength = emphasis(body.id);
      const isSelected = body.id === selected.current;
      const isHovered = hovered.current?.id === body.id;
      const color = colorOf(body, palette);

      ctx.globalAlpha = strength;
      ctx.beginPath();
      ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2);

      if (body.node.missing) {
        ctx.fillStyle = palette.surface;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2 / zoom;
        ctx.setLineDash([2 / zoom, 2 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(body.x, body.y, body.r + 3.5 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1.8 / zoom;
        ctx.stroke();
      }
    }

    /* Labels in a second pass, most important first, skipping any that would
       land on one already drawn. Two overlapping labels are worse than one
       label — you cannot read either, and you cannot tell which node either
       belongs to. Priority is what you are looking at, then how connected a
       note is, which is a decent proxy for how much it matters. */
    // Divided by zoom, and deliberately unclamped: the canvas is scaled, so a
    // constant here would grow with the zoom. 11.5/zoom graph units is 11.5
    // screen pixels at every zoom level, which is what a label size means.
    const fontSize = 11.5 / zoom;
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const labelZoom = zoom > 0.5;
    const ranked = [...bodies.current.values()].sort((a, b) => {
      const rank = (n: Body) =>
        (n.id === selected.current ? 1e6 : 0) + (hovered.current?.id === n.id ? 1e6 : 0) + n.node.degree;
      return rank(b) - rank(a);
    });

    const taken: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const padX = 3 / zoom;
    const padY = 1.5 / zoom;

    for (const body of ranked) {
      const strength = emphasis(body.id);
      if (strength <= 0.3) continue;
      const isSelected = body.id === selected.current;
      const isHovered = hovered.current?.id === body.id;
      if (!labelZoom && !isSelected && !isHovered && body.node.degree < 4) continue;

      const label = body.node.title.length > 26 ? `${body.node.title.slice(0, 25)}…` : body.node.title;
      const halfWidth = ctx.measureText(label).width / 2 + padX;
      const top = body.y + body.r + 3 / zoom;
      const box = { x1: body.x - halfWidth, y1: top - padY, x2: body.x + halfWidth, y2: top + fontSize + padY };
      const collides = taken.some((t) => box.x1 < t.x2 && box.x2 > t.x1 && box.y1 < t.y2 && box.y2 > t.y1);
      // What you are pointing at always gets its label, even over a neighbour.
      if (collides && !isSelected && !isHovered) continue;
      taken.push(box);

      ctx.fillStyle = isSelected || isHovered ? palette.accent : palette.text;
      ctx.globalAlpha = strength * (isSelected || isHovered ? 1 : 0.85);
      ctx.fillText(label, body.x, top);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ── animation loop ───────────────────────────────────────────────────── */

  const running = useRef(false);

  function loop(): void {
    frame.current += 1;
    if (alpha.current > ALPHA_MIN) {
      tick();
      draw();
      requestAnimationFrame(loop);
    } else {
      // Settled. Draw one last frame and stop burning cycles until something
      // changes — this panel stays open for hours.
      draw();
      running.current = false;
    }
  }

  function start(): void {
    if (running.current) return;
    running.current = true;
    requestAnimationFrame(loop);
  }

  function reheat(amount = 0.35): void {
    alpha.current = Math.max(alpha.current, amount);
    start();
  }

  // Selection and search highlighting change how it looks, not how it moves.
  useEffect(() => {
    draw();
  }, [selectedId, highlight]);

  useEffect(() => () => {
    running.current = false;
  }, []);

  /* ── interaction ──────────────────────────────────────────────────────── */

  function toGraph(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { zoom, panX, panY } = view.current;
    return {
      x: (clientX - rect.left - rect.width / 2 - panX) / zoom,
      y: (clientY - rect.top - rect.height / 2 - panY) / zoom,
    };
  }

  function bodyAt(clientX: number, clientY: number): Body | null {
    const { x, y } = toGraph(clientX, clientY);
    let best: Body | null = null;
    let bestDist = Infinity;
    for (const body of bodies.current.values()) {
      const dx = body.x - x;
      const dy = body.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // A generous target: these circles are small, and a graph you have to
      // aim at is a graph nobody explores.
      const reach = body.r + 8 / view.current.zoom;
      if (dist <= reach && dist < bestDist) {
        best = body;
        bestDist = dist;
      }
    }
    return best;
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    moved.current = false;
    const hit = bodyAt(e.clientX, e.clientY);
    if (hit) {
      dragging.current = hit;
      const { x, y } = toGraph(e.clientX, e.clientY);
      hit.fx = x;
      hit.fy = y;
      reheat(0.4);
    } else {
      panning.current = { x: e.clientX - view.current.panX, y: e.clientY - view.current.panY };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointer.current = { x: e.clientX, y: e.clientY, inside: true };

    if (dragging.current) {
      moved.current = true;
      const { x, y } = toGraph(e.clientX, e.clientY);
      dragging.current.fx = x;
      dragging.current.fy = y;
      reheat(0.3);
      return;
    }
    if (panning.current) {
      moved.current = true;
      view.current.panX = e.clientX - panning.current.x;
      view.current.panY = e.clientY - panning.current.y;
      draw();
      return;
    }

    const hit = bodyAt(e.clientX, e.clientY);
    if (hit !== hovered.current) {
      hovered.current = hit;
      if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'grab';
      draw();
    }
  };

  const endGesture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasDragging = dragging.current;
    if (wasDragging) {
      // Release the pin so the layout can absorb where you put it.
      wasDragging.fx = null;
      wasDragging.fy = null;
      dragging.current = null;
      reheat(0.2);
    }
    const wasPanning = panning.current;
    panning.current = null;

    if (!moved.current && !wasPanning) {
      const hit = bodyAt(e.clientX, e.clientY);
      if (hit) onSelect(hit.id);
    }
    moved.current = false;
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = bodyAt(e.clientX, e.clientY);
    if (hit) onOpen(hit.node);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { zoom, panX, panY } = view.current;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * Math.exp(-e.deltaY * 0.0016)));
    if (next === zoom) return;
    // Zoom toward the cursor, not the centre — anything else feels wrong.
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    view.current.panX = cx - ((cx - panX) * next) / zoom;
    view.current.panY = cy - ((cy - panY) * next) / zoom;
    view.current.zoom = next;
    draw();
  };

  const onPointerLeave = () => {
    pointer.current.inside = false;
    if (hovered.current) {
      hovered.current = null;
      draw();
    }
  };

  /* ── view controls, driven from the panel toolbar ─────────────────────── */

  function zoomBy(factor: number): void {
    view.current.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.current.zoom * factor));
    draw();
  }

  /** Frame everything: the one control people actually reach for. */
  function fit(): void {
    const list = [...bodies.current.values()];
    if (list.length === 0) {
      view.current = { zoom: 1, panX: 0, panY: 0 };
      draw();
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const body of list) {
      minX = Math.min(minX, body.x - body.r);
      maxX = Math.max(maxX, body.x + body.r);
      minY = Math.min(minY, body.y - body.r);
      maxY = Math.max(maxY, body.y + body.r);
    }
    const { w, h } = size.current;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    // Capped well below MAX_ZOOM: "fit" means everything is visible, not that
    // four notes should fill the screen as four enormous circles. Zooming in
    // past this is something you ask for, not something you get handed.
    const zoom = Math.max(MIN_ZOOM, Math.min(FIT_MAX_ZOOM, Math.min((w - 110) / spanX, (h - 110) / spanY)));
    view.current.zoom = zoom;
    view.current.panX = -((minX + maxX) / 2) * zoom;
    view.current.panY = -((minY + maxY) / 2) * zoom;
    draw();
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === 'fit') fit();
      else if (action === 'in') zoomBy(1.3);
      else if (action === 'out') zoomBy(1 / 1.3);
      else if (action === 'reheat') reheat(1);
    };
    wrap.addEventListener('eaon:graph', handler);
    return () => wrap.removeEventListener('eaon:graph', handler);
  }, []);

  // Frame the graph once, after the first layout has had a moment to spread.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || graph.nodes.length === 0) return;
    framed.current = true;
    const timer = setTimeout(fit, 700);
    return () => clearTimeout(timer);
  }, [graph.nodes.length]);

  return (
    <div className="mem-graph" ref={wrapRef} data-graph-surface>
      <canvas
        ref={canvasRef}
        className="mem-graph-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
      {graph.nodes.length === 0 && (
        <div className="mem-graph-hint">Nothing to draw yet — write a memory and it appears here.</div>
      )}
    </div>
  );
}

/** Ask the graph inside `el` to fit, zoom or shake itself out. */
export function graphCommand(el: HTMLElement | null, action: 'fit' | 'in' | 'out' | 'reheat'): void {
  el?.querySelector('[data-graph-surface]')?.dispatchEvent(
    new CustomEvent('eaon:graph', { detail: action }),
  );
}
