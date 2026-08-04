---
title: Multiple Claude accounts
tags: [accounts, auth, settings, usage]
created: 2026-08-04T15:00:44.073Z
updated: 2026-08-04T15:00:44.073Z
---

Settings › Accounts signs in to more than one Claude account and switches between them. An account is a Claude Code configuration directory.

## Why it is done this way

`CLAUDE_CONFIG_DIR` is the profile root. Pointed at an empty directory, Claude Code says "Not logged in · Please run /login" and creates its own `.claude.json`, `projects/`, `sessions/` and `backups/` inside — measured. The CLI's own strings confirm the rule: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/*/`.

So switching accounts is handing shells a different directory, never moving tokens between files. `~/.claude` is listed, read and never written; choosing it back sets no variable at all, because unset is what every other terminal on the machine does. This is the property that makes a switch unable to sign you out.

The OAuth exchange is not reimplemented — it belongs to Claude Code, which owns the registered client. `src/main/account-login.ts` runs Claude Code against the new directory, carries the address to the browser and the code back.

## Three things that were wrong on the first attempt

1. **A fresh directory opens on onboarding, not login** — theme, then login method, then the address. And a screen must be answered only after it has been showing ~1.4s: the words identifying it arrive before it can take a keystroke, so answering the first matching frame sent Return into a screen still painting.
2. **The address is inside the OSC 8 hyperlink**, not beside it. Stripping escapes wholesale threw away the only unwrapped copy and left a 150-char fragment with no `code_challenge`. It is also printed several times; take the longest carrying both challenge and state.
3. **A shell that starts the agent is not the agent.** `sh -lc claude` left the agent alive after the pty was killed, and it recreated the directory an abandoned sign-in had just deleted. Uses `exec claude` now.

Also: the TUI mixes spacing — "Choosethetextstyle" and "Select login method" both occur in one stream — so screen matching flattens all whitespace.

The redirect is `platform.claude.com/oauth/code/callback`, **not** localhost, so there is no callback server to catch; the flow ends at "Paste code here if prompted".

## Identity lives in two different places

`oauthAccount` (with `emailAddress`, `displayName`, `organizationName`, `accountUuid`) is in `<configDir>/.claude.json` for an added account, but in `~/.claude.json` — beside the directory, not in it — for the original. Looking only inside is how every account ends up named after its plan and two become indistinguishable. Both are tried, nearest first.

## What follows the active account

`projectsRoot()` in `src/main/sessions.ts` is a resolver, not a constant, and `setUsagePaths()` points usage at the active account's `projects/` and `.credentials.json`. Otherwise one account's spend shows under another's name. Switching calls `resetUsageCache()`. Related: [[restoring-agent-sessions-across-a-restart]] — its pane records are per-account too, so a switch means panes do not resume the other account's conversations.

## The one unverified step

Where Claude Code writes `.credentials.json` for a managed profile was inferred from the same containment rule, not watched — completing a sign-in needs a second account. `Accounts.defaultIdentity()` guards it: the original account's opaque `accountUuid` is compared across a sign-in, and a change means the sign-in landed on `~/.claude`. Identity, not tokens — tokens refresh on their own schedule and would cry wolf.
