---
title: Eaon ADE overview
tags: [architecture]
created: 2026-08-02T14:43:15.850Z
updated: 2026-08-02T14:43:15.850Z
---

Electron app for running many CLI coding agents side by side. Main process owns PTYs, persistence, git, speech and the memory store; the renderer only talks to it through the typed bridge in src/preload. Start at [[Terminal rendering]], [[PTY environment]] and [[Release and notarisation]].
