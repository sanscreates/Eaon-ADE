---
title: Terminals outlive React
tags: [renderer, terminal]
created: 2026-08-02T14:43:15.853Z
updated: 2026-08-02T14:43:15.853Z
---

Each xterm instance lives in a detached wrapper element that is re-parented as you move between workspaces, so a background agent keeps streaming while you are elsewhere. lib/terminals.ts owns them; components only borrow. Related to [[Terminal rendering]].
