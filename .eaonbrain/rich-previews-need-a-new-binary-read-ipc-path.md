---
title: Rich previews need a new binary-read IPC path
tags: [fsapi, renderer, security, previews]
created: 2026-08-07T17:15:55.663Z
updated: 2026-08-07T17:15:55.663Z
---

No markdown-render, image, or PDF capability exists anywhere in the app today. `@codemirror/lang-markdown` (package.json) is only a *syntax highlighter* for EditorPanel's plain-text view — it never produces HTML. No react-markdown/remark/marked/pdfjs-dist/dompurify anywhere in package.json or package-lock.json — any of these would be a new dependency.

Two real blockers, not just "add a library":

1. `src/main/fsapi.ts` `readFile()` always decodes as UTF-8 and throws `'Binary file — Eaon can't show this one.'` the instant a NUL byte appears in the first 4KB (~line 50). There is no binary-safe read anywhere — the preload bridge (`src/preload/index.ts` `fs.read`) only ever returns `{ text, truncated }`. An image/PDF preview needs a *new* IPC call that returns bytes/base64, not a tweak to this one.
2. The renderer's CSP (`src/renderer/index.html`) is `img-src 'self' data: blob:` — no `file:` scheme, and `connect-src` is locked to `'self'` plus localhost. A plain `<img src="file:///...">` or `<embed src="file:///...pdf">` is silently blocked, and `fetch('file://...')` from the renderer won't work either. Bytes have to cross the IPC bridge and become a `data:`/`blob:` URL in the renderer — the same shape of trip `saveDropped`/`pathForDropped` already do for drag-and-drop bytes (`lib/drop.ts`), just in the other direction.

Also: `fs:read`/`fs:list`/`fs:write` take no `host` parameter at all (unlike `git.ts`/`worktrees.ts`, which thread `host` throughout), so they are local-only today — consistent with [[SSH worktrees: remote workspaces over ssh]] noting "no SFTP-backed file editing (EditorPanel/FilesPanel are local-only)". A repo-preview feature meant to work on an SSH workspace needs a remote-read path that doesn't exist yet.

Related: [[Pane grid is a fixed matrix, not a split tree]]
