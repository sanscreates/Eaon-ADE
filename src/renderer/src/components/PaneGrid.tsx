import { useCallback, useEffect, useRef, useState } from 'react'
import { paneKind, tracksFor, type GridTracks, type Workspace } from '@shared/types'
import { useStore } from '../store/useStore'
import { terminals } from '../lib/terminals'
import { TerminalPane } from './TerminalPane'
import { PreviewGridPane } from './PreviewGridPane'
import { DiffGridPane } from './DiffGridPane'

/**
 * The panes, and the dividers between them.
 *
 * Tiled rather than floating. Panes cannot overlap, cannot be dropped behind
 * one another and cannot be dragged off the edge into somewhere you have to go
 * looking for them — a workspace full of agents is not a desktop, and losing
 * one behind another is worse than not being able to overlap them at all.
 *
 * The dividers are real cells in the grid rather than something drawn on top of
 * it. Laying them out as tracks — column, divider, column — means their
 * positions come from the same rules that place the panes, so there is nothing
 * to measure, nothing to keep in step on a window resize, and no arithmetic
 * that can put a divider a few pixels away from the seam it belongs to.
 */

/** Matches the gap the grid used before the dividers sat in it. */
const SEAM = 6

/** No pane may be squeezed below this share of its axis. */
const MIN_FRACTION = 0.12

interface Drag {
  axis: 'cols' | 'rows'
  /** The seam being dragged: between track `index` and `index + 1`. */
  index: number
  start: number
  /** Pixels the two tracks either side of the seam share between them. */
  span: number
  before: number
  after: number
}

/**
 * A press on the one pixel where a column seam and a row seam cross, not yet
 * committed to either. See the corner-generation block below for why this
 * point needs handling of its own.
 */
interface CornerPress {
  colIndex: number
  rowIndex: number
  startX: number
  startY: number
}

export function PaneGrid({
  workspace,
  cols
}: {
  workspace: Workspace
  cols: number
}): React.JSX.Element {
  const setGridTracks = useStore((s) => s.setGridTracks)
  const movePane = useStore((s) => s.movePane)

  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [cornerPress, setCornerPress] = useState<CornerPress | null>(null)
  /** The pane being carried, and the one it is over. */
  const [carrying, setCarrying] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const count = workspace.panes.length
  const tracks = tracksFor(count, workspace.grid)
  const rows = tracks.rows.length

  /*
   * xterm sizes itself to its container and has to be told the container moved.
   * Fitting on every pointer event would re-flow a dozen terminals per frame,
   * so it is asked once a frame at most, and once more when the drag ends.
   */
  const refit = useRef<number | null>(null)
  const scheduleFit = useCallback(() => {
    if (refit.current !== null) return
    refit.current = requestAnimationFrame(() => {
      refit.current = null
      terminals.fitAll()
    })
  }, [])

  useEffect(() => {
    if (!drag) return

    const onMove = (e: MouseEvent): void => {
      const point = drag.axis === 'cols' ? e.clientX : e.clientY
      const moved = (point - drag.start) / drag.span
      const total = drag.before + drag.after
      // Clamped as a share of the pair, so a divider stops at the point where
      // the pane it is closing in on would stop being usable.
      const min = total * MIN_FRACTION
      const before = Math.min(total - min, Math.max(min, drag.before + moved * total))

      const next: GridTracks = { cols: [...tracks.cols], rows: [...tracks.rows] }
      next[drag.axis][drag.index] = before
      next[drag.axis][drag.index + 1] = total - before
      setGridTracks(workspace.id, next)
      scheduleFit()
    }

    const onUp = (): void => {
      setDrag(null)
      terminals.fitAll()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, tracks, workspace.id, setGridTracks, scheduleFit])

  // A pane arriving or leaving changes the shape, so the terminals re-measure.
  useEffect(() => {
    const id = window.setTimeout(() => terminals.fitAll(), 60)
    return () => window.clearTimeout(id)
  }, [count, cols])

  /**
   * Point rather than `React.MouseEvent`, so a corner press — resolved from a
   * plain DOM `mousemove`, not a React event — can start a drag the same way.
   */
  const startDrag = (axis: 'cols' | 'rows', index: number, point: { clientX: number; clientY: number }): void => {
    const box = gridRef.current?.getBoundingClientRect()
    if (!box) return
    const list = tracks[axis]
    const seams = list.length - 1
    // The seams take up room that is not the tracks' to share.
    const span = (axis === 'cols' ? box.width : box.height) - seams * SEAM
    const total = list.reduce((a, b) => a + b, 0)
    setDrag({
      axis,
      index,
      start: axis === 'cols' ? point.clientX : point.clientY,
      // In pixels per unit of fraction, so a drag of n pixels moves the seam n
      // pixels however the fractions happen to be scaled.
      span: (span * (list[index] + list[index + 1])) / total,
      before: list[index],
      after: list[index + 1]
    })
  }

  /*
   * A row seam spans every column track and a column seam spans every row
   * track (see the comment above the seam loops below), so the single track
   * where one of each crosses belongs to both — and whichever was appended
   * to the DOM last silently wins the pointer, every time, for anyone who
   * grabs exactly that pixel. `pane-seam-corner` sits on top of both at
   * exactly that point so nothing is left to DOM order, and decides which
   * seam it belongs to from the direction actually dragged rather than
   * guessing: mostly sideways resizes the column, mostly up or down resizes
   * the row — the same choice a press a few pixels either side would give.
   */
  useEffect(() => {
    if (!cornerPress) return
    // Below this many pixels the gesture could still be either axis, or just
    // a click that never meant to drag at all.
    const THRESHOLD = 3

    const onMove = (e: MouseEvent): void => {
      const dx = e.clientX - cornerPress.startX
      const dy = e.clientY - cornerPress.startY
      if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
      const axis = Math.abs(dx) >= Math.abs(dy) ? 'cols' : 'rows'
      const index = axis === 'cols' ? cornerPress.colIndex : cornerPress.rowIndex
      setCornerPress(null)
      startDrag(axis, index, e)
    }
    const onUp = (): void => setCornerPress(null)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    // startDrag closes over `tracks`, so it is listed here even though it is
    // cheap to resubscribe: without it, a corner press held across an
    // unrelated re-render could resolve against a stale track layout.
  }, [cornerPress, startDrag])

  /**
   * Moving a divider from the keyboard.
   *
   * A separator you can only drag is one that is not there at all for anyone
   * working without a pointer, and this one announces itself as a separator.
   * The arrow keys that make sense for the axis move it; Home puts every pane
   * back to an equal share, which is the same thing double-clicking does.
   */
  const nudge = (axis: 'cols' | 'rows', index: number, e: React.KeyboardEvent): void => {
    const back = axis === 'cols' ? 'ArrowLeft' : 'ArrowUp'
    const forward = axis === 'cols' ? 'ArrowRight' : 'ArrowDown'
    if (e.key === 'Home') {
      e.preventDefault()
      setGridTracks(workspace.id, null)
      window.setTimeout(() => terminals.fitAll(), 0)
      return
    }
    if (e.key !== back && e.key !== forward) return
    e.preventDefault()

    const list = tracks[axis]
    const total = list[index] + list[index + 1]
    // A tenth of the pair per press, so a divider crosses its span in ten and
    // the same key felt the same whatever the panes had been resized to.
    const step = total * 0.1 * (e.key === forward ? 1 : -1)
    const min = total * MIN_FRACTION
    const before = Math.min(total - min, Math.max(min, list[index] + step))

    const next: GridTracks = { cols: [...tracks.cols], rows: [...tracks.rows] }
    next[axis][index] = before
    next[axis][index + 1] = total - before
    setGridTracks(workspace.id, next)
    window.setTimeout(() => terminals.fitAll(), 0)
  }

  /** A seam's own track, and the tracks either side, in one template. */
  const template = (list: number[]): string =>
    list.map((f) => `minmax(0, ${f}fr)`).join(` ${SEAM}px `)

  /*
   * A last row that does not fill the grid.
   *
   * Three panes in a two-column grid used to leave the fourth cell empty, and
   * an empty cell in a workspace is just wasted screen. The panes that are
   * there widen to take it: the row's columns are shared out between them, so
   * three panes are two across the top and one across the whole bottom.
   *
   * Shared out as evenly as whole columns allow. Five panes over three columns
   * gives the last row two panes and three columns to split, which cannot come
   * out even — the earlier pane takes the spare column. Uneven beats a hole,
   * and the dividers are still there to even it up by hand.
   */
  const tail = count - (rows - 1) * cols
  const partial = tail > 0 && tail < cols
  const tailSpans: number[] = []
  const tailStarts: number[] = []
  if (partial) {
    const base = Math.floor(cols / tail)
    const spare = cols % tail
    let at = 0
    for (let j = 0; j < tail; j += 1) {
      const span = base + (j < spare ? 1 : 0)
      tailStarts.push(at)
      tailSpans.push(span)
      at += span
    }
  }
  /** Where one pane ends and the next begins in that row — all a seam can sit on. */
  const tailSeats = new Set(tailStarts.slice(1))

  const placeOf = (i: number): { gridColumn: string; gridRow: number } => {
    const row = Math.floor(i / cols)
    const last = partial && row === rows - 1
    const start = last ? tailStarts[i - (rows - 1) * cols] : i % cols
    const span = last ? tailSpans[i - (rows - 1) * cols] : 1
    return {
      gridColumn: `${start * 2 + 1} / ${(start + span) * 2}`,
      gridRow: Math.min(row, rows - 1) * 2 + 1
    }
  }

  const seams: React.JSX.Element[] = []
  for (let i = 0; i < tracks.cols.length - 1; i += 1) {
    /*
     * A column seam stops above a pane that spans across it. Running it the
     * full height regardless would draw a divider down the middle of a pane and
     * hand you a handle that resizes two columns it is not between.
     */
    const throughLastRow = !partial || tailSeats.has(i + 1)
    const lastRow = throughLastRow ? rows - 1 : rows - 2
    if (lastRow < 0) continue
    seams.push(
      <div
        key={`c${i}`}
        className="pane-seam"
        data-axis="cols"
        data-dragging={drag?.axis === 'cols' && drag.index === i}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize column ${i + 1}`}
        tabIndex={0}
        onKeyDown={(e) => nudge('cols', i, e)}
        style={{ gridColumn: i * 2 + 2, gridRow: `1 / ${lastRow * 2 + 2}` }}
        onMouseDown={(e) => {
          e.preventDefault()
          startDrag('cols', i, e)
        }}
        onDoubleClick={() => {
          setGridTracks(workspace.id, null)
          window.setTimeout(() => terminals.fitAll(), 0)
        }}
      />
    )
  }
  for (let i = 0; i < tracks.rows.length - 1; i += 1) {
    seams.push(
      <div
        key={`r${i}`}
        className="pane-seam"
        data-axis="rows"
        data-dragging={drag?.axis === 'rows' && drag.index === i}
        role="separator"
        aria-orientation="horizontal"
        aria-label={`Resize row ${i + 1}`}
        tabIndex={0}
        onKeyDown={(e) => nudge('rows', i, e)}
        style={{ gridRow: i * 2 + 2, gridColumn: '1 / -1' }}
        onMouseDown={(e) => {
          e.preventDefault()
          startDrag('rows', i, e)
        }}
        onDoubleClick={() => {
          setGridTracks(workspace.id, null)
          window.setTimeout(() => terminals.fitAll(), 0)
        }}
      />
    )
  }

  /*
   * Every point where a column seam and a row seam actually cross — same
   * `lastRow` a column seam stops at above, since a corner can only exist
   * where that seam still reaches.
   */
  const corners: React.JSX.Element[] = []
  for (let i = 0; i < tracks.cols.length - 1; i += 1) {
    const throughLastRow = !partial || tailSeats.has(i + 1)
    const lastRow = throughLastRow ? rows - 1 : rows - 2
    for (let r = 0; r < lastRow; r += 1) {
      corners.push(
        <div
          key={`x${i}-${r}`}
          className="pane-seam-corner"
          aria-hidden="true"
          style={{ gridColumn: i * 2 + 2, gridRow: r * 2 + 2 }}
          onMouseDown={(e) => {
            e.preventDefault()
            setCornerPress({ colIndex: i, rowIndex: r, startX: e.clientX, startY: e.clientY })
          }}
        />
      )
    }
  }

  return (
    <div
      className="grid"
      ref={gridRef}
      data-dragging={Boolean(drag) || Boolean(cornerPress)}
      data-carrying={Boolean(carrying)}
      style={{
        gridTemplateColumns: template(tracks.cols),
        gridTemplateRows: template(tracks.rows)
      }}
    >
      {workspace.panes.map((pane, i) => {
        // Every kind takes the exact same position/drag/swap props — placing
        // a pane in the grid does not care what is inside it, only PaneGrid's
        // own tracks and seams do.
        const shared = {
          workspace,
          pane,
          index: i,
          // Placed rather than flowed, because the dividers occupy tracks of
          // their own and a pane left to flow would land in one of them.
          style: placeOf(i),
          carrying: carrying === pane.id,
          over: over === pane.id && carrying !== null && carrying !== pane.id,
          onCarry: setCarrying,
          onOver: setOver,
          onSwap: (dragId: string): void => {
            movePane(workspace.id, dragId, pane.id)
            setCarrying(null)
            setOver(null)
            // Trading places changes nothing about either pane's size, but a
            // grid that has been resized can hand them different cells.
            window.setTimeout(() => terminals.fitAll(), 0)
          }
        }
        const kind = paneKind(pane)
        if (kind === 'preview') return <PreviewGridPane key={pane.id} {...shared} />
        if (kind === 'diff') return <DiffGridPane key={pane.id} {...shared} />
        return <TerminalPane key={pane.id} {...shared} />
      })}
      {seams}
      {corners}
    </div>
  )
}
