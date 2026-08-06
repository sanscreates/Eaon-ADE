---
title: Pane layout: moving and resizing
tags: [grid, panes, ui, terminal]
created: 2026-08-06T17:10:49.496Z
updated: 2026-08-06T17:10:49.496Z
---

Panes trade places by dragging a header, and share space by dragging the seam between them. `src/renderer/src/components/PaneGrid.tsx`.

## Tiled, not floating

Deliberate. Panes cannot overlap or be dragged off-screen — a workspace full of agents is not a desktop, and losing one behind another costs more than overlapping ever gives. Dropping one pane on another **swaps** them; inserting would shuffle every pane after it and move ones nobody touched.

## Dividers are grid tracks, not overlays

The template interleaves them: `minmax(0,Xfr) 6px minmax(0,Yfr)`. Panes are placed explicitly (`gridColumn: col*2+1`), seams at the even tracks spanning `1 / -1`. There is no `gap`.

Why: divider positions then derive from the same rules that place panes — nothing to measure, nothing to re-sync on window resize, no arithmetic that can leave a divider a few pixels off the seam. The hit area reaches past the track via `::before` insets; the visible line is `::after` and only appears on hover/drag/focus.

## Sizes are fractions, and only kept while they fit

`Workspace.grid: GridTracks | null` — `{ cols: number[], rows: number[] }`. `tracksFor(count, saved)` in `shared/types.ts` returns equal shares unless the saved arrays match the shape `gridColumns(count)` implies. Closing a pane can change the column count, and sizes measured against the old shape would put dividers where nobody dragged them. Measured: 4→3 panes keeps them (2×2 either way); 3→2 drops the vanished row and keeps the columns.

Fractions rather than pixels so a layout survives a different screen.

## Swapping must not restart a terminal

`movePane` reorders `workspace.panes`, so React reorders keyed children and moves the DOM nodes. Verified the shells' pids are identical before and after a swap — a move within the same parent does not unmount, so xterm and the PTY survive. If that ever changes, the alternative is a stable DOM order with positions driven purely by `gridColumn`/`gridRow`.

`terminals.fitAll()` is rAF-throttled during a drag and called once more on release; xterm sizes to its container and must be told it moved.

## Two kinds of drop on one pane

A pane already accepts file drops (paths typed onto the prompt). Pane-carrying uses the payload type `application/x-eaon-pane`, and the shared `onDragOver`/`onDrop` handlers branch on it. The header is the drag handle, not the body — the body is a terminal where dragging selects text.

Dividers are focusable with arrow-key resize and Home to reset (also double-click), since they carry `role="separator"`.
