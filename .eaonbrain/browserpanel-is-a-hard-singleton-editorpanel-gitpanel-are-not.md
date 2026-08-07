---
title: BrowserPanel is a hard singleton; EditorPanel/GitPanel are not
tags: [panels, browser, editor, git, ui]
created: 2026-08-07T17:16:02.557Z
updated: 2026-08-07T17:16:02.557Z
---

Of the three SideDock tabs most likely to get "popped into the grid", they carry very different amounts of risk.

**BrowserPanel** (`src/renderer/src/components/BrowserPanel.tsx`) takes **no props at all**. It reads `dockOpen`/`dockTab` straight from the store to compute `visible` (~line 168), and reads/writes `settings.browserHome`/`settings.browserZoom` as the *one global* "current address"/"zoom" — there's no per-instance address. It mounts a single `<webview partition="persist:preview">` with a hardcoded partition string. SideDock deliberately keeps it mounted-but-`hidden` rather than unmounting (see the comment above `.dock-slot` in SideDock.tsx) specifically because a `<webview>` reloads from scratch on re-attach — unlike xterm, there is no "outlives React" registry for it (contrast [[Terminals outlive React]]). Consequence for "split anything": moving/duplicating BrowserPanel into a grid leaf as-is means (a) rewriting its visibility logic to not depend on `dockOpen`/`dockTab`, (b) giving each instance its own address/zoom instead of sharing the single global `Settings` fields, (c) building a terminals.ts-style re-parenting registry for `<webview>` DOM nodes, or every move/reflow will reload the page.

**EditorPanel** (`{ cwd }`) and **GitPanel** (`{ cwd, host }`) are plain props-driven components with no dock/global-visibility coupling, so multiple simultaneous instances are structurally fine — no singleton trap. EditorPanel's real trap is different: its CodeMirror `EditorView` is fully destroyed and recreated on every file switch *and* on unmount, and `dirty` (unsaved, non-autosaved) edits are never flushed anywhere — unmounting a leaf that holds an editor with unsaved changes silently discards them. Two grid leaves both opening the *same* file also have no coordination — last save wins, no "changed on disk" warning. EditorPanel additionally takes no `host` param at all, so it's local-only (see [[SSH worktrees: remote workspaces over ssh]]). GitPanel is the cleanest of the three: props-only, no native resource, no persistent instance state worth losing.

Related: [[Pane grid is a fixed matrix, not a split tree]], [[Rich previews need a new binary-read IPC path]]
