---
title: Rich previews and polymorphic grid panes: what shipped
tags: [previews, panes, grid, ui, verification]
created: 2026-08-07T18:15:43.748Z
updated: 2026-08-07T18:15:43.748Z
---

Closes out [[Rich previews need a new binary-read IPC path]] and the "split anything" half of [[BrowserPanel is a hard singleton; EditorPanel/GitPanel are not]]. `PaneSpec` now has a `kind?: 'terminal' | 'preview' | 'diff'` (absent reads as `'terminal'`, via `paneKind()` in `shared/types.ts` — the same convention as `workspace.kind`), and `PaneGrid.tsx`/`TerminalGrid.tsx` switch on it to render `TerminalPane` / `PreviewGridPane` / `DiffGridPane`. Confirmed by direct read that the grid's position/resize/drag-swap machinery (`placeOf`, `startDrag`, `onSwap`) is entirely pane-content-agnostic — only the two `<TerminalPane>` render call sites needed the kind switch, nothing in the layout math.

## The binary-read path

`fsapi.ts` gained `readBinary(file)` — mime-sniffed by extension (`MIME_BY_EXT`), 24 MB cap, returns `{ base64, mime, truncated }` — beside the existing text-only `readFile`. New IPC door `fs:readBinary` (+ `fs:mime`). Renderer turns the base64 into a `data:` URL; CSP (`renderer/index.html`) needed `frame-src 'self' data:; object-src 'self' data:` added for the PDF path (`img-src` already had `data:`). This is the only path the CSP allows at all — `file://` stays blocked, as the planning note predicted.

PDF rendering reuses Chromium's built-in viewer via `<iframe src="data:application/pdf;base64,...">` — deliberately not `pdfjs-dist`, since the built-in viewer is free and one CSP line was cheaper than a new dependency.

Markdown: `marked` (gfm) → `DOMPurify.sanitize()`, **default profile, unmodified** — not hardened further, not loosened. Proved safe with a live XSS canary (`<script>`, `onerror`, two `javascript:` forms, `<iframe>`) rather than by asserting the config: `document.title` never became the canary's target string after rendering an attacker-controlled file.

Remote/SSH file preview is **not** built — `readBinary` takes no `host` param, matching `fs:read`'s existing local-only shape. Same gap the planning note flagged; still open.

## EditorPanel's preview toggle doesn't lose edits

The trap the planning note called out (CodeMirror destroyed/recreated on unmount) is why the preview toggle uses `hidden` on `.editor-host` instead of conditionally unmounting it — the `EditorView` stays alive underneath. Toggling preview snapshots the **live buffer** (not last-saved-to-disk content) into `liveMarkdown`, passed to `FilePreviewBody` via `markdownOverride`. Real bug caught in verification: `liveMarkdown` wasn't cleared on opening a *different* file, so a stale preview could briefly show the wrong file's content mislabeled — fixed by resetting it in both branches of `open()`.

## Split-out buttons, and the one deliberately missing

EditorPanel and GitPanel each grew a "Open in its own pane" button (`addPane(workspaceId, { kind: 'preview'|'diff', ... })`), shown only when `workspaceId` is passed in — GitPanel's copy *inside* a `DiffGridPane` gets no `workspaceId`, so a diff pane can't spawn a recursive diff-pane button. **BrowserPanel got no split-out button and no `'browser'` pane kind** — the singleton risk the earlier note detailed (global settings-backed address/zoom, no re-parenting registry, `<webview>` reloads on re-attach) wasn't worth naively grid-ifying this pass. Stated as an explicit scope boundary, not an oversight.

`SurfacePaneChrome.tsx` (shared preview/diff header) closes **instantly** on click, no confirmation — matched to the real `TerminalPane` close behavior after checking it directly (`grep -n "pane-kill"`), not assumed from memory of a different, unrelated codebase.

## Verification

`scripts/check-preview.mjs`: 15/15 (mime table, real-PNG base64 round trip, oversized-file refusal against an actual 24MB+1 file, non-previewable-extension refusal). Live CDP against a running dev instance: 20/20 (markdown/GFM rendering, raw-source toggle, the XSS canary, image via `data:image/png;base64`, PDF via `data:application/pdf;base64` iframe) and 10/10 for split-anything (preview split-out, diff split-out, drag-swap between a terminal and a preview pane, resize with mixed kinds present, closing a preview pane removes exactly one, original terminals still alive throughout).

One live-verification false alarm worth recording as methodology: an early "split-anything" run showed diff split-out doing nothing, reproducible. Root cause was the test fixture, not the product — GitPanel correctly renders its "not a git repository" empty state (no `.panel-bar`, no split button) when `cwd` isn't a repo, and the scratch fixtures folder used for the markdown/image/PDF tests had never been `git init`'d. Fixed by giving the fixture folder a real repo and an uncommitted change, not by touching product code.

See also [[Pane layout: moving and resizing]] for a genuine, pre-existing bug this verification pass surfaced (seam-intersection dead zone) — confirmed unrelated to pane kind.

Related: [[Pane grid is a fixed matrix, not a split tree]], [[BrowserPanel is a hard singleton; EditorPanel/GitPanel are not]]
