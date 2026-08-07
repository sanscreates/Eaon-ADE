---
title: brain_write silently saved empty notes on a wrong parameter name
tags: [brain, gotcha, mcp]
created: 2026-08-07T19:38:31.064Z
updated: 2026-08-07T19:38:31.064Z
---

Found live, mid-testing, not in review: a real `claude -p` session called
`brain_write` with `{title, body, tags}` — `body` instead of the schema's
`content` — and the old handler in `src/main/brain/mcp-server.ts` did
`content: String(args.content ?? '')`. Nullish coalescing turned the missing
field into `''` rather than an error, so the call "succeeded": a title, a real
save path, a normal-looking confirmation message — and a `.md` file with
frontmatter and nothing else. The one thing worth keeping never reached disk,
and nothing told the model or the user that it hadn't.

This is worse than not writing at all. A missing note is an obvious gap; an
empty note LOOKS like the system worked — it shows up in `brain_list`, it
matches a search on its title, and only reveals the problem when someone
actually opens it later, by which point the reasoning that would have gone
into it is gone.

**Fixed** by validating in the handler before calling `store.write`: both
`title` and `content` must be non-empty after trimming, checked explicitly
rather than coerced. `content` missing/blank returns an `isError: true` tool
result rather than a silent save — and if the payload has a `body` field
instead (the specific mistake observed), the error names that directly:
`brain_write takes "content", not "body"`, rather than a generic "content is
required" that leaves the actual fix unsaid. `isError: true` is what makes a
capable model treat the result as "retry this" rather than as data — this
server's other handlers all just return plain text either way, but a
validation failure is exactly the case that distinction exists for.

Verified two ways: `npm run test:brain` group 9 spawns the real bundled server
and drives it over actual JSON-RPC with the exact malformed payload (rejected,
nothing written) alongside a well-formed one (saved, content intact) — and
separately, the exact rebuilt `out/main/brain-mcp.js` was driven directly
through `ELECTRON_RUN_AS_NODE=1`, the same transport Claude Code itself uses,
confirming the fix in the actual shipped artifact, not just the source.

Related: [[Agents are provisioned on spawn, not on panel open]]
