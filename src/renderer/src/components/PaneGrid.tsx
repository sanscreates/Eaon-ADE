import { useCallback, useEffect, useRef, useState } from 'react'
import { tracksFor, type GridTracks, type Workspace } from '@shared/types'
import { useStore } from '../store/useStore'
import { terminals } from '../lib/terminals'
import { TerminalPane } from './TerminalPane'

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

  const startDrag = (axis: 'cols' | 'rows', index: number, e: React.MouseEvent): void => {
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
      start: axis === 'cols' ? e.clientX : e.clientY,
      // In pixels per unit of fraction, so a drag of n pixels moves the seam n
      // pixels however the fractions happen to be scaled.
      span: (span * (list[index] + list[index + 1])) / total,
      before: list[index],
      after: list[index + 1]
    })
  }

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

  const seams: React.JSX.Element[] = []
  for (let i = 0; i < tracks.cols.length - 1; i += 1) {
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
        style={{ gridColumn: i * 2 + 2, gridRow: '1 / -1' }}
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

  return (
    <div
      className="grid"
      ref={gridRef}
      data-dragging={Boolean(drag)}
      data-carrying={Boolean(carrying)}
      style={{
        gridTemplateColumns: template(tracks.cols),
        gridTemplateRows: template(tracks.rows)
      }}
    >
      {workspace.panes.map((pane, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        return (
          <TerminalPane
            key={pane.id}
            workspace={workspace}
            pane={pane}
            index={i}
            // Placed rather than flowed, because the dividers occupy tracks of
            // their own and a pane left to flow would land in one of them.
            style={{ gridColumn: col * 2 + 1, gridRow: Math.min(row, rows - 1) * 2 + 1 }}
            carrying={carrying === pane.id}
            over={over === pane.id && carrying !== null && carrying !== pane.id}
            onCarry={setCarrying}
            onOver={setOver}
            onSwap={(dragId) => {
              movePane(workspace.id, dragId, pane.id)
              setCarrying(null)
              setOver(null)
              // Trading places changes nothing about either pane's size, but a
              // grid that has been resized can hand them different cells.
              window.setTimeout(() => terminals.fitAll(), 0)
            }}
          />
        )
      })}
      {seams}
    </div>
  )
}
