---
title: Never kill Eaon ADE by name
tags: [gotcha, process, electron]
created: 2026-08-02T15:15:47.080Z
updated: 2026-08-02T15:16:56.457Z
---

The user runs their Claude Code sessions inside Eaon ADE itself, from
`/Applications/Eaon ADE.app`. Two mistakes take that app down, and both look
harmless at the time.

**Killing by name.** `pkill -f "Eaon ADE"` matches the installed app, because
the repo path also contains those words. So does `pkill -f "Eaon ADE.app"` and
`pkill -f Electron`. Any of them kills the terminal the agent is running in,
along with every other pane. Kill only the PID you started. If it is lost, the
one safe pattern is `node_modules/electron/dist/Electron.app`, which the
installed app does not share — though another session's dev instance does.

**Sharing the profile.** `src/main/index.ts` sets userData explicitly to
`app.getPath('appData')/Eaon ADE`, so a dev or preview instance uses the same
folder as the installed app — including `state.json`, which holds workspaces,
panes and settings. Two instances overwrite each other; the user sees
workspaces disappear and sessions restart.

Neither `--user-data-dir` nor a redirected `HOME` isolates it. Both were
measured: userData came back as the shared path every time, because
`app.getPath('appData')` on macOS resolves through the OS rather than `$HOME`.

Check before launching, with this exact command:

    ps -Ao command | grep -Fq "/Applications/Eaon ADE.app/Contents/MacOS"

Not `pgrep -f`. On this machine `pgrep -f` with the full leading path reports
nothing while the app is running, so the check passes and you launch into a
collision anyway.

The durable fix, not yet applied, is to give the unpackaged build its own name
so userData diverges, and to take `app.requestSingleInstanceLock()`.

See [[Eaon ADE overview]].
