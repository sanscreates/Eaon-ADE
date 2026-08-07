---
title: Pane layout: moving and resizing
tags: [grid, panes, ui, terminal]
created: 2026-08-06T17:10:49.496Z
updated: 2026-08-07T19:16:10.420Z
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

## Fixed: the seam-intersection dead pixel

Found live during [[Rich previews and polymorphic grid panes: what shipped]]'s verification — a mixed-kind resize check silently no-op'd only when the grab point landed exactly where a row seam crosses a column seam. Confirmed pane-kind-agnostic at the time (reproduced with 4 plain terminal panes too) — a pre-existing gap in the grid itself, not something that feature introduced.

Root cause: a row seam spans every column track (`gridColumn: '1 / -1'`) and a column seam spans every row track it reaches, so the one track where both exist is claimed by both grid items — and the one appended later in the `seams` array (rows, generated after cols) silently won the pointer there (`document.elementFromPoint` at that pixel returned the row seam, confirmed live before the fix).

Fix: a third element, `.pane-seam-corner`, rendered after both seam arrays so it sits on top of both at exactly that one track. It does not commit to an axis on press — `cornerPress` state plus a dedicated effect wait for the first mouse movement past a 3px threshold, then decide `Math.abs(dx) >= Math.abs(dy) ? 'cols' : 'rows'` and hand off to the *same* `startDrag` the ordinary seams use (its param type was widened from `React.MouseEvent` to `{ clientX, clientY }` so a plain DOM `MouseEvent` satisfies it too). One corner exists per crossing that geometrically exists — generated with the exact same `throughLastRow`/`lastRow` logic the column-seam loop already uses for a partial last row, so a corner is never drawn past where its column seam actually stops. No keyboard handling on the corner itself: every crossing already has two fully keyboard-accessible seams (`tabIndex`, arrow-key `nudge`), so the corner is a pointer-precision fix only, not a new interaction surface.

Verified live post-fix: `elementFromPoint` at the crossing now returns `pane-seam-corner`; a sideways drag from it resizes only columns, a vertical drag resizes only rows, and an ordinary off-corner drag is unaffected (regression check).

Related: [[Pane grid is a fixed matrix, not a split tree]]
