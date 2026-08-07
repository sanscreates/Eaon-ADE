---
title: Work items: PRs, issues and Linear in the dock
tags: [architecture, integrations, tasks, security]
created: 2026-08-07T16:49:52.834Z
updated: 2026-08-07T16:49:52.834Z
---

Pull requests, issues and Linear tickets in one list — the "Work" tab in the side dock. `src/shared/tasks.ts` (the normalised `WorkItem` and the tone mapping), `src/main/tasks.ts` (fetching), `TasksPanel.tsx` (the panel). Builds on [[Service integrations]] for credentials and [[Parallel worktrees: isolation, dirty semantics, and provisioning noise]] for the "open this in its own checkout" action.

**GitHub and GitLab go through their own CLIs, not their REST APIs** — same reasoning as the integrations layer: `gh` already holds a refreshable token, already resolves which repo a directory belongs to, and already handles Enterprise hosts. Linear has no CLI, so it is the one provider spoken to over HTTP (GraphQL), with `LINEAR_API_KEY` fetched through `credentialFor()` in `integrations.ts`. That accessor exists because the real invariant is *"a credential never crosses IPC"*, not *"a credential never leaves that file"* — main is trusted, the renderer is not. `scripts/check-tasks.mjs` injects a canary key and greps every reply for it rather than trusting the intent.

**Three provider vocabularies, one row.** A GitHub PR, a GitLab MR and a Linear ticket are the same thing to a person and nothing alike in their payloads (`headRefName` vs `source_branch`; `MERGED` vs `merged` vs a user-renamed workflow state). Everything is flattened into `WorkItem` with a `tone` of open/draft/merged/closed before it leaves main. Linear's workflow states are user-defined but each carries a fixed `type`, which is the part that's safe to map — a team may well have renamed "Done".

**Two bugs that only real data / a real UI could have found:**

1. **`gh` sends `""`, not `null`, for an unreviewed PR's `reviewDecision`.** My stub said `null`, the mapping used `?? null`, and the empty string sailed through to render as a blank review badge. Caught by running the real `gh` against the real repo and diffing the payload against the stub. The stub now carries `''` deliberately, with a comment saying why. General lesson for this codebase: **verify a stub's shape against the live tool before trusting tests built on it.**

2. **`ENOENT` from `execFile` means two completely different things** — the binary isn't on PATH, *or* `cwd` doesn't exist — and Node gives the identical message. The panel reported "spawn gh ENOENT" for a workspace whose folder had been deleted, while `gh` was installed and working perfectly, sending the user off to install a tool they already had. `explain()` now asks the filesystem which case it actually was. Also: PRs and issues are fetched in separate `try` blocks, so one missing CLI produced the same note twice, which reads as two distinct faults — hence `dedupe()`.

**Opening a worktree from a task** required a new `CreateRequest.existing` flag in the worktree engine. A PR's head branch is real and usually only on the remote, so it is fetched, then checked out as-is (`worktree add <target> <branch>` if local, `-b <branch> ... origin/<branch>` if remote-only) — cutting a fresh branch from HEAD would give an empty checkout of entirely the wrong thing. **The base SHA for an existing branch is that branch's own tip**, deliberately: `change()` then answers "what have you changed since opening this PR", which is the useful question, rather than re-deriving the PR's own diff, which GitHub already shows better.

**Reporting nothing vs. reporting nothing usefully.** `TaskFetch.notes` exists because an empty list and "glab is not installed" look identical in a UI that only carries items, and only one of them is actionable. Every provider contributes what it has and explains what it couldn't do; one being unreachable never empties the panel.
