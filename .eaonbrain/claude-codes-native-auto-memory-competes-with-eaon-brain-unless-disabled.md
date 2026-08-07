---
title: Claude Code's native auto-memory competes with eaon-brain unless disabled
tags: [brain, agents, gotcha, claude-code]
created: 2026-08-07T18:52:41.100Z
updated: 2026-08-07T18:52:41.100Z
---

Claude Code ships its own built-in per-machine memory (`~/.claude/projects/<hash>/memory/`,
a plain `Write` tool call, no skill or MCP tool involved). Tested directly: given
the same prompt with something worth recording, a session with eaon-brain fully
wired up (`.mcp.json` + the skill) **still wrote to its own native store instead**,
never touching [[Agents are provisioned on spawn, not on panel open|the eaon-brain skill]]
at all. Native memory is checked before skills are even considered, so having a
better skill doesn't help — it never gets a turn.

This matters because native memory is private to one machine and one CLI: not in
the repo, not committed, not visible to Codex or Gemini, not visible in the Brain
panel. A session that defaults to it is invisible to every other agent working on
the project — exactly the failure mode eaon-brain exists to prevent.

**The fix**: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (an official, documented env var —
see what `claude --help`'s `--bare` flag turns off). Verified both ways with real
`claude -p` runs, same prompt: unset, the session calls `Write` on its own store and
never touches the skill; set, it calls `Skill` → `brain_search` → `brain_list` →
`brain_write`, correctly landing the note in `.eaonbrain/`.

Wired into `src/main/pty-manager.ts`'s `buildEnv`, scoped to `isProvisioned(cwd)` —
only set where there is a brain to redirect to, so a pane in an unprovisioned folder
(or any other agent, which ignores the var) is unaffected.

**Also found while testing this**: the *original* (pre-rewrite) `registerWorkspace`
had no guard against the home directory at all — a stray `.mcp.json` registering
`eaon-brain --root $HOME` was sitting in the real `$HOME` on this machine, clearly
from that old code running before this fix existed. `.mcp.json` discovery is
directory-scoped, not hierarchical (confirmed: invisible from a subdirectory), so
the blast radius is narrow — only a shell opened with cwd exactly `$HOME` would see
it — but it's exactly the case `isProvisionable` in the current `register.ts` now
refuses. The file was left in place rather than removed unilaterally, since it's
the user's real home directory; flagged for them to clean up if they want to.
