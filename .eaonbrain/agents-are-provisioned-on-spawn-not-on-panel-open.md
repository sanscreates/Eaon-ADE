---
title: Agents are provisioned on spawn, not on panel open
tags: [brain, agents, mcp, skills]
created: 2026-08-07T01:54:01.850Z
updated: 2026-08-07T19:16:13.845Z
---

Two files make a workspace agent-ready, and both are written by
`provisionWorkspace(cwd)` in `src/main/brain/register.ts`:

- `.mcp.json` — registers the `eaon-brain` server, giving agents the memory
  tools. See [[Brain write semantics]] for what those tools do to disk.
- `.claude/skills/eaon-brain/SKILL.md` — the judgement to use them: search
  before exploring, record before finishing, and how to title, tag and link so
  a note is findable again.

**Why it hangs off `pty:spawn`.** It used to run only from the `brain:open` IPC,
so the memory was wired up only if you happened to visit the Brain tab first.
An agent reads `.mcp.json` and `.claude/skills/` once at startup, so anything
written after it launches is invisible until the next restart — which made
"does my session have the brain?" depend on tab order. Spawning is the one
funnel every pane goes through, so it is where provisioning belongs. Both halves
compare against disk and write only on a real change, which is what makes it
safe to sit on that path.

**The home directory is deliberately excluded.** `.claude/skills/` in `~` is the
*personal* skill folder — provisioning there would silently apply this repo's
skill to every project on the machine. A pane opened in `~` is a scratch shell
and leaves no trace. `isProvisionable` also refuses the filesystem root and
anything that is not a directory; `installSkill` refuses a non-existent path in
its own right, because `mkdir -p` would otherwise conjure a project folder out
of a typo.

**A hand-edited skill is never overwritten.** The installed file ends with a
`<!-- eaon-brain-skill vN -->` marker. A newer app replaces an older version; a
copy with no marker is assumed to be someone's own wording and left alone.
Bump `SKILL_VERSION` in `skill-md.ts` whenever the text changes or installed
copies go stale.

**The skill is what does the work, measured.** Same prompt, same tools, real
`claude -p` runs: without the skill installed the session called `Bash` once and
never touched the brain. With it, the session searched, read two notes, wrote a
new memory and linked it into the graph — and used what it found to correct a
wrong premise in the question. Tool descriptions alone did not produce that.

`npm run test:brain` covers the installer, the guards and content-vs-server
drift — it fails if a tool is renamed in `mcp-server.ts` without the skill being
updated to match.

## A third leg: `CLAUDE.md` gets a pointer too

A skill only enters context when Claude judges the task complex enough to
consult one — a simple-looking request never triggers it, and that is often
exactly the request most likely to be answered wrong for want of a five-second
`brain_search`. `CLAUDE.md` has no such gate: Claude Code loads it into every
session unconditionally. `provisionWorkspace` now also calls
`installClaudeMdPointer` (`src/main/brain/claude-md.ts`), which appends a short
"this project has a shared memory, here's how to reach it" block — a pointer,
not the instructions themselves, so it costs a few lines on every turn instead
of the skill's full guidance.

Measured with a same-prompt, same-tools A/B: two identical scratch projects,
same seeded memory note, same realistic decoy source tree, one with the
pointer and one without. Without it, the session grepped through `ls` → three
`Read`s → `Grep` → another `Read` before finally reaching for `brain_search` as
an afterthought (8th tool call). With it, `brain_search` fired 3rd — right
after basic orientation, before any blind file reading — followed by a full
`brain_read` rather than trusting a single grep hit. Both happened to land on
the right answer in a small scratch folder; the difference is what happens as
the codebase gets bigger, where "grep everything and hope" gets slower and
`brain_search` stays cheap.

**Kept deliberately conservative**, since `CLAUDE.md` is far more clearly the
user's own file than a namespaced skill folder is:
- Skipped, not appended, if the file already mentions `eaon-brain`/`.eaonbrain`
  in its own words — no stapling a second, redundant explanation onto content
  someone already wrote.
- Tracked via its own marker file next to the skill
  (`.claude/skills/eaon-brain/.claude-md-pointer`), not by re-scanning the
  content, so *installed once, then the block or the whole file was removed* is
  read correctly as "leave it removed" — never re-inserted. Contrast with the
  skill file, where "no marker" means "assume hand-edited, leave it alone" from
  the very first encounter; here it takes one confirmed install before removal
  is trusted as deliberate, because the file is far more likely to have existed
  first for reasons of the user's own.
- Upgrades replace only the text between our own `<!-- eaon-brain:start -->` /
  `<!-- eaon-brain:end -->` markers, byte for byte — everything else in the file,
  before or after, is untouched.
- `isProvisioned` (which gates disabling Claude's native memory, below) does
  *not* require the pointer specifically — an already-covered or
  deliberately-removed file must not make an otherwise fully working workspace
  read as broken.

Related: [[Claude Code's native auto-memory competes with eaon-brain unless disabled]]
