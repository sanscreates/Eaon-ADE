---
title: Service integrations
tags: [architecture, security, integrations]
created: 2026-08-07T01:31:35.506Z
updated: 2026-08-07T01:31:35.506Z
---

GitHub, GitLab, Bitbucket, Azure DevOps, Linear and Jira, so a pane can push or read an issue without a token being pasted into a prompt.

`src/shared/integrations.ts` holds the registry and the wire types; `src/main/integrations.ts` does the work; the panel is `IntegrationsPanel.tsx` under Settings → Integrations.

**Eaon stores no credentials.** GitHub and GitLab are proven by their own CLIs (`gh auth status`, `glab auth status`), which already hold a refreshable token and know how to push — asking for a PAT as well would be a second, worse copy of something the user has already done. The rest are plain environment variables, grouped by what makes a *complete* set: Jira needs base URL, email and token together, so a flat list would call it ready at one third.

**The invariant: a value has no route to the renderer.** `ProviderState.env` is `{name, set}[]` — names and booleans only. That is what makes a half-configured provider diagnosable ("still needs JIRA_EMAIL") without printing what anything holds. `scripts/check-integrations.mjs` proves it with canary values rather than by inspection: `npm run check:integrations`.

**Why the login shell is read at all.** Launched from the Dock, `process.env` is what launchd gave Electron — no `.zshrc`, so none of the exports people actually keep tokens in. Without that read, a correctly configured provider reports "not configured" to anyone who did not start the app from a terminal. Values are captured once at startup and reach panes through `PtyManager.setExtraEnv`, alongside `setConfigDir` — see [[PTY environment]]. Anything already in `process.env` wins, so a stale capture cannot override the token the launching terminal had.

**Gotcha, found by test and worth keeping.** The capture emits each value NUL-terminated behind a sentinel. The NUL *before* the sentinel is load-bearing: a profile that prints a banner leaves that text in the same NUL-delimited field as the sentinel, so a sentinel matched exactly would never be found and the whole read would silently return nothing. NUL framing (not lines) is also what lets a credential legitimately contain a newline.
