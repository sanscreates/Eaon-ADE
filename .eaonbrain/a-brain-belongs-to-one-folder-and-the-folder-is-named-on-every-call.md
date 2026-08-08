---
title: A brain belongs to one folder, and the folder is named on every call
tags: [brain, architecture, gotcha, scope]
created: 2026-08-07T23:44:20.221Z
updated: 2026-08-07T23:44:20.221Z
---

The agent side was always per-folder: each workspace's `.mcp.json` launches
`mcp-server.js --root <cwd>`, one process per folder, so an agent in project A
could only ever reach `A/.eaonbrain`. See
[[Agents are provisioned on spawn, not on panel open]].

The **app** side was not, in two places, and both are fixed.

## 1. One shared store with a mutable root

`src/main/index.ts` held a single `new BrainStore()` whose folder was set by
whichever `brain:open` ran last. Every other handler — `list`, `get`, `write`,
`remove`, `search`, `related`, `graph`, `stats` — carried no folder at all and
operated on that leftover root. Where a note landed was a question about call
ordering rather than about the folder on screen, and a save could reach another
project's `.eaonbrain`.

Now `BrainStore` takes its cwd in the constructor and has no `setWorkspace`; a
store cannot be repointed. Every `brain:*` IPC takes a `BrainScope`
(`{ cwd, host }`, in `src/shared/brain.ts`) and `brainFor(scope)` builds a store
per call. `BrainStore` is stateless past its root and only touches disk when
asked, so this costs nothing.

## 2. A single Brain workspace that got re-aimed

`openPanel` in `useStore.ts` matched an existing panel workspace by `kind`
alone, then overwrote its `cwd`. Opening the Brain from project B silently
turned project A's Brain tab into project B's, and the two could never be open
together.

Panel kinds now split on whether their contents live in the folder:

- **board / vault / stats** — contents live in `state.json`, identical whichever
  workspace you came from. One of each; re-aiming is free and correct.
- **brain** — *is* the folder's `.eaonbrain`. Matched on `kind && cwd`, so each
  folder gets its own workspace, named `Brain · <folder>`.

## Remote workspaces get no brain, deliberately

`SshHost` is part of the scope because `/home/dev/app` on a remote box and the
same path on this Mac are different folders on different machines. Pointing the
local store at a remote path would read — and on write **create** — a
same-named local folder, showing one project's memory under another's
workspace. `brainFor` returns a null-root store whenever `scope.host` is set,
and the panel says so instead. This matches `pty:spawn`, which already skips
`provisionWorkspace` for remote panes (`if (!req.host)`): `fsapi` is local-only,
so there is nothing on this machine to provision or read. Same aliasing bug the
branch cache fixes with `hostKeyOf` in `src/renderer/src/lib/branch.ts`.

## Verified

Isolation was measured, not assumed: two folders, notes with the same title in
each, and searches/graphs that stay folder-local — plus a null-root store that
writes nothing. Driven through the running app, opening the Brain from two
workspaces produced two coexisting tabs (25 notes vs 1), and creating a memory
in one left the other's folder byte-for-byte unchanged.

`npm run test:brain` still passes (117 assertions) — the MCP server only needed
`new BrainStore(workspace)` in place of the old two-step.

See [[Brain write semantics]] for what a write does once the folder is settled.
