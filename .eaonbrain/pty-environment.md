---
title: PTY environment
tags: [terminal, process]
created: 2026-08-02T14:40:30.584Z
updated: 2026-08-02T14:40:30.584Z
---

Panes get a clean environment. buildEnv drops npm_*, ELECTRON_*, NODE_ENV and agent session markers, then sets TERM and a UTF-8 LANG. Without it a nested agent thinks it is a child session. Related: [[Terminal rendering]].
