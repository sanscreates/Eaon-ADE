---
title: Restoring agent sessions across a restart
tags: [sessions, terminal, process, restore]
created: 2026-08-04T06:50:25.742Z
updated: 2026-08-04T06:50:25.742Z
---

A pane comes back to the conversation it was holding. How that is known is not obvious, and the obvious approaches do not work.

## The link cannot be read off disk

A transcript records cwd, branch, model and version — and nothing about the terminal: no pid, no tty. Measured by scanning every record type in a real transcript. `lsof` shows the agent does not hold its transcript open either, and macOS will not give another process's environment to `ps` (`ps eww` returns nothing even for your own shell), so the `EAON_PANE` marker in each pane's shell cannot be read back out of the agent beneath it.

The one link that exists: the app spawned the pane's shell and knows its pid. `PtyManager.pids()` exposes it; `src/main/session-watch.ts` walks down from there.

## Two ways of identifying the conversation

1. The command line names it — `--resume`/`--session-id` in argv. Exact, and covers everything the app or the resume picker launched.
2. A transcript appears that was not there when the agent was first seen. Covers a hand-typed `claude`. Exact for one agent per folder; with two unspoken agents in one folder the tie goes to whichever started most recently. Self-correcting, because once restored the app launches by name and rule 1 applies.

Most sessions are hand-typed into a plain shell pane, which is why this exists: those panes persist as agentId `shell`, no command, no session, and used to come back empty.

## Where the record lives

`src/main/pane-sessions.ts` writes `pane-sessions.json` in userData, keyed by pane id — stable across restarts, verified. Deliberately not in `state.json`: the renderer never learns any of this, and its own save is debounced 400ms with no flush on quit, which loses exactly the moments that matter.

The watch must stop before the shells are reaped, in `shutdownAndExit` and on window close. Every agent disappears at once when the app quits, and a missing agent otherwise reads as one deliberately closed — which would erase the record the next launch depends on.

## A session id has three states, not two

Measured against the real CLI, both failing:

- `--resume` on a transcript with no conversation in it: "No conversation found with session ID".
- `--session-id` on an id that already has a file: "Session ID is already in use".

An agent started and closed without a word leaves exactly that — a few hundred bytes of mode, permission-mode and file-history-snapshot records and no turns. So `sessionState()` in `src/main/sessions.ts` returns `conversation` (resume), `none` (pin), or `reserved` (spent — run the bare command and let the watch learn what it becomes).

## Only the exact project directory

`hasTranscript` looks in `projectSlug(cwd)` alone. `projectDirsFor` additionally takes directories beginning with the slug, which is right for listing resumable sessions and wrong for deciding a launch flag: `Eaon` and `Eaon ADE` derive to `-Users-...-Eaon` and `-Users-...-Eaon-ADE`, and the second reads as a continuation of the first. Offering a neighbour's conversation produces the same "No conversation found" this is meant to prevent.

## Testing this

Agents inherit `CLAUDE_CODE_CHILD_SESSION` from a Claude Code session and then print "Transcript saving is off" and write nothing — a harness that does not strip it the way `buildEnv` does measures itself, not the app. Related: [[pty-environment]].
