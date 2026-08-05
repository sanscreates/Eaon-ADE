---
title: Restoring agent sessions across a restart
tags: [sessions, terminal, process, restore]
created: 2026-08-04T06:50:25.742Z
updated: 2026-08-05T14:27:38.025Z
---

A pane comes back to the conversation it was holding. How that is known is not obvious, and the obvious approaches do not work.

## The link cannot be read off disk

A transcript records cwd, branch, model and version — and **nothing about the terminal**: no pid, no tty. Measured by scanning every record type. `lsof` shows the agent does not hold its transcript open, and macOS will not give another process's environment to `ps` (`ps eww` returns nothing even for your own shell), so the `EAON_PANE` marker in each pane's shell cannot be read back out of the agent beneath it.

The one link that exists: the app spawned the pane's shell and knows its pid. `PtyManager.pids()` exposes it; `src/main/session-watch.ts` walks down from there.

## Ask the agent — `sessions/<pid>.json`

Claude Code writes `<configDir>/sessions/<pid>.json` containing `sessionId`, `cwd`, `pid`, `procStart`, `status`. Written by the process about itself, so it is exact, and **present for the whole life of the session** rather than only at its start. `sessionsRoot()` in `sessions.ts` derives it beside `projectsRoot()`, so it follows the active account.

Guard: compare the file's `cwd` against the process's real cwd (from `lsof`). Process ids are reused and a file left by a dead agent would otherwise hand a pane somebody else's conversation.

Fallbacks, in order: the command line (`--resume`/`--session-id`), then a transcript arriving that was absent when the agent was first seen.

## Why the arrival rule alone was not enough — the bug that shipped

It can only recognise a conversation that *begins* under observation. Two very common cases are invisible to it:

- The process table is polled every 4s, so an agent started **and spoken to** inside that window already has its transcript on disk when the watch first looks.
- `claude --continue` names no id on its command line and reopens a transcript written days ago.

Measured on the real machine: 4 of 15 panes recorded, and the 11 missing were the long-running hand-typed ones people actually want back. After the change, 25 of 25 live agents identified, including all 10 bare ones the old rule could name none of.

## Where the record lives

`src/main/pane-sessions.ts` writes `pane-sessions.json` in userData, keyed by pane id — stable across restarts, verified. Deliberately not in `state.json`: the renderer never learns any of this, and its own save is debounced 400ms with no flush on quit.

The watch must stop before the shells are reaped, in `shutdownAndExit` and on window close. Every agent disappears at once when the app quits, and a missing agent otherwise reads as one deliberately closed — erasing the record the next launch depends on.

## A session id has three states, not two

Measured against the real CLI, both failing:

- `--resume` on a transcript with no conversation: "No conversation found with session ID".
- `--session-id` on an id that already has a file: "Session ID is already in use".

An agent started and closed without a word leaves exactly that. So `sessionState()` returns `conversation` (resume), `none` (pin), or `reserved` (spent — run the bare command and let the watch learn what it becomes).

## Only the exact project directory

`hasTranscript` looks in `projectSlug(cwd)` alone. `projectDirsFor` also takes directories beginning with the slug, which is right for listing and wrong for choosing a launch flag: `Eaon` and `Eaon ADE` derive to `…-Eaon` and `…-Eaon-ADE`.

## Testing this

Agents inherit `CLAUDE_CODE_CHILD_SESSION` from a Claude Code session and then print "Transcript saving is off" and write nothing — a harness that does not strip it the way `buildEnv` does measures itself, not the app. Related: [[pty-environment]], [[multiple-claude-accounts]].
