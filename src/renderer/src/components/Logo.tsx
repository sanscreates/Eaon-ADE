/**
 * The ADE mark: a letter A built on a 5×5 grid of rounded squares, with the
 * counter — the dot inside the apex — lit in coral.
 *
 * Coral is fixed rather than themed. The palette of the mark is part of the
 * mark; only the ink colour follows the interface so it reads on light and
 * dark surfaces alike.
 */

/** Filled cells, row by row. The lit one is [1, 2]. */
const CELLS: [number, number][] = [
  [0, 2],
  [1, 1], [1, 2], [1, 3],
  [2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
  [3, 0], [3, 4],
  [4, 0], [4, 4]
]

const LIT: [number, number] = [1, 2]

// A 5-cell grid with 4 gaps at 15% of a cell: 5 + 4 × 0.15 = 5.6 units square.
const CELL = 1
const GAP = 0.15
const SPAN = 5 * CELL + 4 * GAP
const RADIUS = CELL * 0.12

export function Logo({
  size = 18,
  ink = 'var(--text-hi)'
}: {
  size?: number
  ink?: string
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SPAN} ${SPAN}`}
      fill="none"
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      {CELLS.map(([row, col]) => {
        const isLit = row === LIT[0] && col === LIT[1]
        return (
          <rect
            key={`${row}-${col}`}
            x={col * (CELL + GAP)}
            y={row * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={RADIUS}
            fill={isLit ? 'var(--brand-coral)' : ink}
          />
        )
      })}
    </svg>
  )
}
