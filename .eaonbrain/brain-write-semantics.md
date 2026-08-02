---
title: Brain write semantics
tags: [brain, storage, gotcha]
created: 2026-08-02T15:03:58.270Z
updated: 2026-08-02T15:03:58.270Z
---

Deciding whether a write updates an existing note or creates a new one uses a
stricter match than reading does. `BrainStore.target()` matches only an exact
slug or an exact (case-insensitive) title. `get()` additionally falls back to
comparing slugified titles, which is what makes `[[Auth Flow]]` find
`auth-flow.md`.

Using the lenient match on the write path caused silent data loss: two titles
that slugify alike — "Auth flow?" and "Auth flow!", or any two titles with no
latin characters, which both reduce to `untitled` — made the second write
overwrite the first and report success. `uniqueSlug()` now gives them separate
files. For the same reason the slugified fallback is skipped when it produces
`untitled`, so unrelated non-latin notes are never conflated.

Notes are written to a temp file and renamed over the target, because rename is
atomic. Agents and the app write these files concurrently by design and a plain
write truncates first, so a reader arriving in that window would see half a note
and could save the truncated version back.

Tags with a comma in them are serialised as a dashed YAML list rather than the
inline `[a, b]` form, which the reader splits on commas.

See [[Eaon ADE overview]].
