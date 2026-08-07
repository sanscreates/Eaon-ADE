---
title: Parallel worktrees: isolation, dirty semantics, and provisioning noise
tags: [architecture, worktrees, git, trial]
created: 2026-08-07T02:35:29.283Z
updated: 2026-08-07T02:35:29.283Z
---

Every pane in a trial gets its own git worktree, cut from the same base commit, so N agents given one prompt can't overwrite each other. `src/shared/worktrees.ts` (types), `src/main/worktrees.ts` (the engine — plain git via `execFile`, no dependency), `TrialBar.tsx` (the strip above the grid). Checkouts live under `app.getPath('userData')/worktrees/<repo-name>-<sha1 of root>`, never beside the repository itself.

**The base commit is resolved once and travels with the trial**, not re-read. `Trial.baseSha` is what every member's `change()`/`diff()` is compared against, so a commit landing on `main` mid-trial can't change what an agent appears to have done. Confirmed by test: committing a later change to `main` leaves an in-flight member's reported diff untouched.

**Two real bugs found only by testing against a real filesystem, not by reading the code:**

1. **macOS symlinks broke every path comparison.** `/var` resolves to `/private/var`, and `git worktree list --porcelain` always reports the resolved form. Comparing an unresolved caller path against it (`path.resolve`, which does not follow symlinks) silently never matches — branch cleanup after removing a worktree silently no-opped, and the guard against removing the repository's own checkout never actually fired (a test that "passed" only because git itself refused first, not because the guard worked). Fixed with `fs.realpath` before every comparison. Lesson: on this codebase, any path equality check against a git-reported path needs `realpath` first — `path.resolve` is not enough.

2. **Eaon's own provisioning was counted as the agent's work.** See [[Agents are provisioned on spawn, not on panel open]] — every worktree gets `.mcp.json` and `.claude/skills/` the moment a pane opens in it, exactly like any other workspace. Before filtering, a trial member that changed one file reported "3 files changed." `isProvisioned()` + `untracked()` in `worktrees.ts` split `ls-files --others` into ours vs. the agent's; `commitAll` explicitly un-stages our files after `git add -A` so merging a winner never carries Eaon's plumbing into the user's repository. Only filtered while *untracked* — a project that genuinely tracks `.mcp.json` owns that file and a real change to it still counts.

**`dirty` must be read from `git status`, never derived from a diff against the base.** First attempt computed it as `filesChanged > 0` (from `git diff --shortstat baseSha`) — which stays true forever after the first commit, since the branch has permanently diverged from its base. That made a freshly committed attempt read as dirty forever, and would have made `mergeTrialMember`'s "did the agent leave anything uncommitted" check meaningless. Fixed by reading `git status --porcelain` directly (filtered for our own untracked provisioning), which answers "is there uncommitted work right now" — a different question from "has this branch diverged from base," and both are needed.

**Verification is layered, and each layer catches what the one below can't:** `scripts/check-worktrees.mjs` (65 checks against real throwaway repos, deterministic, no app needed — `npm run check:worktrees`) proved the engine; a live CDP run through the actual `window.eaon.worktrees.*` bridge proved the IPC wiring; only driving the *rendered* `TrialBar` with real provisioning files on disk caught the two bugs above, because both are about what the UI displays, not what the engine returns in isolation. `Store.save()` (`src/main/store.ts`) is last-write-wins with a 250ms debounce — a raw IPC `state.save()` call racing the live renderer's own debounced `persist()` can be silently overwritten; a test harness that injects state directly should not assume it survives once a real window is left open afterward.
