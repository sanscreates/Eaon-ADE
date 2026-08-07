---
title: Integrations panel: real brand marks
tags: [integrations, ui, branding]
created: 2026-08-07T19:16:28.436Z
updated: 2026-08-07T19:16:28.436Z
---

[[Service integrations]]'s panel used to show every provider as a plain circular initial — GitHub and GitLab both landed on "G", indistinguishable at a glance. `src/renderer/src/components/ProviderMarks.tsx` now renders real brand marks for 5 of the 6 providers.

## Where the marks come from, and why not hand-drawn

Paths and hex colors are imported directly from the `simple-icons` package (`siGithub`, `siGitlab`, `siBitbucket`, `siLinear`, `siJira`), not transcribed by hand. A brand mark is unforgiving of a wrong curve — it reads as broken, not stylised — and this package's data is exact and already maintained, so importing it removes that risk entirely rather than managing it.

**Azure DevOps has no entry in `simple-icons`** (checked directly against the installed package, not assumed) and no other maintained source existed that was worth a second dependency for one icon. `hasProviderMark(id)` returns `false` for it, and `IntegrationsPanel`'s `Card` falls back to the original lettered mark — the same treatment every provider used to have, so the gap reads as a deliberate, honest omission rather than a rendering failure.

## The mark's background had to stop following theme or status

`.ig-mark`'s background used to be `var(--ink-300)` (a dark surface token) that flipped to solid `var(--accent)` when connected. Two problems once a mark can be a real, fixed-colour logo:

1. `--ink-300` is dark in this app's default theme — GitHub's mark is `#181717`, functionally invisible on a same-toned dark chip.
2. Recolouring the chip to solid accent on connect would fight any brand colour sitting on top of it (imagine Jira's blue logo on an accent-teal disc).

Fixed by pointing the chip at `--brand-bone`/`--brand-ink` instead — the pair in `tokens.css` explicitly called out as fixed across every theme (`/* Brand constants. These never change with the theme. */`), confirmed by grepping `lib/theme.ts` for any override (none). The mark's background is now the same plain, light chip regardless of theme or connection status; "connected" is still communicated by the existing card border highlight and status pill, which was already redundant with the old mark recolour, so dropping the third signal lost nothing.

Related: [[Service integrations]]
