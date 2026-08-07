---
title: Codex accounts and usage
tags: [architecture, accounts, usage, codex, security]
created: 2026-08-07T17:06:32.731Z
updated: 2026-08-07T17:06:32.731Z
---

Codex rides the same account mechanism as Claude, and the two keep separate books. See [[Multiple Claude accounts]] for the original.

**The vendor split.** `Accounts` in `src/main/accounts.ts` is now parameterised by a `VendorSpec` — *only* where the home directory is, what the env var is called, how to read a config dir, and which index file to use. It defaults to `CLAUDE_SPEC`, so every existing call site is untouched. `CODEX_SPEC` points at `~/.codex` / `CODEX_HOME` / `codex-accounts.json`. If that spec ever needs to grow past "where, what it's called, and how to read it", the two are not really the same mechanism and should stop pretending to be.

**`~/.codex` on this machine belongs to ChatGPT Desktop, not the Codex CLI.** It has `goals_*.sqlite`, `memories_*.sqlite`, `.codex-global-state.json` with `electron-main-window-bounds`, and a `config.toml` full of `marketplaces.openai-bundled` — and no `auth.json`, no `sessions/`. The Codex CLI itself is not installed. This matters twice over: it is why nothing here is verified against a real Codex install, and it is why *never writing to the home directory* is not a nicety but a hazard-avoidance requirement — account-switching code that wrote there could damage an unrelated app. The existing class already guaranteed this (`discard`/`remove` refuse the default id; `reserve` only makes directories under userData), and `scripts/check-accounts.mjs` now proves it by hashing every file in both stand-in homes before and after a full exercise.

**Reading `auth.json` without reading the credential.** Codex keeps an id token whose *payload* names the account and plan. That payload is decoded for the label; the token string is never copied, written or sent, and the signature is neither read nor verified. This is the same line the Claude reader draws taking `subscriptionType` out of `.credentials.json`. An API-key sign-in has no token at all, so it reports `plan: 'api'` from the mere presence of the field — the key's value is never read. Tests assert no `SECRET_*` canary reaches the account list.

**No sign-in flow, deliberately.** Claude Code prints a URL and takes a code back, which a dialog can follow. `codex login` just wants a terminal. So the UI reserves an empty home, opens a pane running `CODEX_HOME=<dir> codex login`, and waits for the user to confirm — `commit()` then discards the directory if nothing signed into it. The env var is set inline on that one command rather than by switching the active account, so an abandoned sign-in never changes what other panes are using.

**Three places had to follow the active account, not just one.** `PtyManager.setCodexHome` (new shells), `sessions.setCodexHome` (the resume list — it hard-coded `~/.codex` and would have kept offering the previous account's sessions), and `codex-usage.setCodexUsageHome`. Missing any one of them makes a switch look like it half-worked.

**`src/main/codex-usage.ts` is UNVERIFIED against a real install** and says so in the source, in the test header, and on screen. Codex restates the session's *cumulative* total on every usage event, so the reader takes deltas between consecutive events — summing them directly would multiply a long session by its own length, and that is the single most likely way to get a confidently wrong number here. The parser accepts several plausible spellings of each field and returns zeroes rather than throwing on anything unrecognised, so a wrong guess reads as "no usage recorded" rather than a wrong figure presented confidently. The card in Settings → Plan usage distinguishes "no rollouts found" from "nothing spent" for exactly that reason. **First person with the Codex CLI installed should point `scripts/check-codex-usage.mjs` at a real `~/.codex/sessions` and compare against `codex` itself.**
