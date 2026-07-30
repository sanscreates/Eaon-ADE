# Releasing Eaon ADE

The app checks GitHub Releases for a newer version, tells the user, and hands
off the download. It does **not** replace itself — see [Why not auto-install](#why-not-auto-install).

## Setup

The updater points at **[sanscreates/Eaon-ADE](https://github.com/sanscreates/Eaon-ADE)**,
which is public — so the app reads the release feed anonymously and needs no
token of its own. If you ever move or rename the repo, change it in **two**
places: `build.publish` in `package.json`, and `REPO` in `electron/updater.mjs`.

Publishing a release needs a token with `repo` scope. The `gh` CLI already has
one, so the simplest form is:

```sh
export GH_TOKEN=$(gh auth token)
```

If the repo is ever made **private**, the in-app check starts returning
"No published releases yet." — GitHub answers 404 to anonymous requests for
private repos — and the token would have to be added to the request headers in
`updater.mjs`.

## Shipping an update

```sh
npm version minor                       # 0.1.0 → 0.2.0, commits and tags
git push --follow-tags
GH_TOKEN=$(gh auth token) npm run release
```

For another alpha, `npm version prerelease` goes `0.1.0-alpha` → `0.1.0-alpha.0`
→ `0.1.0-alpha.1`. To graduate it, `npm version 0.1.0` — a plain `0.1.0` beats
every `0.1.0-alpha*`, which is exactly what semver says and what the in-app
comparison implements.

`npm run release` builds the client and server, packages the app, and uploads
the `.dmg` and `.zip` to a GitHub release for the current tag.

The release is created as a **draft**. Nothing is offered to anyone until you
publish it — a half-uploaded release never reaches a user. Write the release
notes, then hit Publish.

The app reads `/releases/latest`, which GitHub defines as the newest release
that is neither a draft nor a **prerelease**. So marking a release as a
prerelease is how you ship a build to testers without offering it to everyone.

Within six hours every open copy of the app notices. Anyone who opens the app
later notices ~8 seconds after launch.

### What the version number controls

The comparison is semver, on the tag: `v0.2.0` beats `0.1.0`, `0.1.10` beats
`0.1.9`, and `1.0.0` beats `1.0.0-beta.1`. A tag that does not parse is
ignored rather than guessed at, so a malformed tag can't nag everyone.

Release notes come from the GitHub release body. The banner shows the first
non-heading line, so lead with the summary, not a `## Changelog` header.

## What the user sees

- **A banner**, bottom-right, when a newer version exists — version, download
  size, first line of the notes, and *What's new* / *Skip this version* /
  *Download*.
- **Settings › About** — current version, last check, a *Check now* button and
  an automatic-check switch.
- **Eaon ADE › Check for Updates…** in the menu bar, which checks and then
  opens About showing the result.

*Skip this version* is remembered: that version stops appearing on its own, but
anything newer still shows up, and an explicit *Check now* always answers
honestly. Automatic checks are silent unless there is genuinely something new —
"you are up to date" is only ever said to someone who asked.

Dev builds never check. `app.isPackaged` is false there, and a dev copy running
`0.1.0` would otherwise nag about the released `0.1.0` on every launch.

## Why not auto-install

macOS auto-update goes through Squirrel.Mac, which verifies the app's code
signature before swapping the bundle. This app is unsigned — no Developer ID,
no notarization — so an "install and restart" flow would download the update
perfectly and then fail silently at the last step. Handing over the `.dmg` is
the honest version of the same feature.

Users will see Gatekeeper's "unidentified developer" warning on first open, and
have to right-click → Open once per install.

### Turning on real auto-update later

With an Apple Developer ID ($99/yr):

1. Add signing and notarization to `build.mac` in `package.json`
   (`identity`, `hardenedRuntime`, `entitlements`, `notarize`).
2. `npm i electron-updater`.
3. In `electron/updater.mjs`, flip `INSTALL_MODE` to `'install'` and route the
   download through `autoUpdater` instead of `shell.openExternal`. The IPC
   surface, the store, and the banner already model a two-step
   *download → apply* flow, so the UI copy is the only other thing to change.

The `.zip` target already in `build.mac.target` is there for this — Squirrel
consumes the zip, not the dmg. Keep it.
