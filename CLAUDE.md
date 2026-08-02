# Working in this repo

## Read this before you launch or kill anything

**The user runs this Claude Code session inside Eaon ADE itself.** The installed
app at `/Applications/Eaon ADE.app` is hosting the terminal you are typing in.
Kill it and you kill your own session, the user's other sessions, and every
agent running in its panes. This has happened. Twice.

### Never match the app by name

```bash
pkill -f "Eaon ADE"        # NO — matches /Applications/Eaon ADE.app
pkill -f "Eaon ADE.app"    # NO — same thing
pkill -f Electron          # NO — matches the user's app and every other Electron app
```

The repo path itself contains the words "Eaon ADE", so these patterns match the
user's running app, the dev instance, and unrelated processes all at once.

Kill only what you started, by the PID you recorded:

```bash
npx electron-vite preview > /tmp/preview.log 2>&1 &
MY_APP=$!
# ... do the work ...
kill $MY_APP
```

If you have lost the PID, the one safe pattern is the dev binary's own path,
which the installed app does not share:

```bash
pkill -f "node_modules/electron/dist/Electron.app"
```

Be aware another session may be running its own dev instance; that pattern
takes theirs down too. Prefer the PID.

### A second instance shares the user's state, and last writer wins

`src/main/index.ts` pins the profile:

```ts
app.setName('Eaon ADE')
app.setPath('userData', path.join(app.getPath('appData'), 'Eaon ADE'))
```

So a dev or preview instance uses the **same** `~/Library/Application Support/
Eaon ADE` as the installed app — including `state.json`, which holds the user's
workspaces, panes and settings. Two instances running at once overwrite each
other's state, which the user experiences as workspaces vanishing and sessions
restarting.

This cannot be worked around from the launch side. Both of these were measured,
not assumed — neither changes anything:

```bash
electron main.js --user-data-dir=/tmp/isolated   # ignored: userData is set explicitly
HOME=/tmp/isolated electron main.js              # ignored: macOS appData ignores $HOME
```

`app.getPath('appData')` on macOS resolves through the OS, not `$HOME`.

**So: check before you launch.** Use exactly this — `ps` piped through a fixed
string grep:

```bash
ps -Ao command | grep -Fq "/Applications/Eaon ADE.app/Contents/MacOS" \
  && echo "USER'S APP IS RUNNING — ask before launching another instance"
```

Do not reach for `pgrep -f` here. On this machine
`pgrep -f "/Applications/Eaon ADE.app/Contents/MacOS"` reports **nothing** while
the app is plainly running, so the check silently passes and you launch into a
collision. (`pgrep -f "Applications/Eaon ADE.app"`, without the leading slash,
does match — but a check that depends on that is not a check worth trusting.)

If it is running, ask the user before starting a second instance. If they say go
ahead, treat the test instance as read-mostly: capture screenshots, read state,
drive the surface you are testing — but do **not** close workspaces or panes,
because that edit lands in the user's `state.json`.

**The profile half of this is now fixed.** The unpackaged build names itself
`Eaon ADE (dev)` and so keeps its own userData, verified by running a dev
instance while the installed app was open: the app's `state.json` never saw the
dev instance's workspace. A dev build can no longer overwrite the user's
workspaces.

That does **not** make launching free. Killing by name still takes the user's
app down, and two instances still compete for the same ports and, if they ever
run the same profile, the same files. Ask first.

Still unapplied: `app.requestSingleInstanceLock()`, which would stop a second
copy of the *packaged* app from starting at all.

## Other sessions may be editing the same files

Agents run in parallel in this app, on this repo. Before committing, check
`git status` and stage **only** the files you changed — `git add -A` will sweep
up another session's half-finished work. If `npm run typecheck` fails in a file
you never touched, that is someone else mid-edit; leave it alone and say so
rather than "fixing" it underneath them.

## Start with the project's memory, not the source tree

This repo has an Eaon Brain: plain markdown in `.eaonbrain/`, exposed to agents
over MCP. Call `brain_search` **before** reading source files — architecture,
conventions and the reasons behind past decisions are recorded there. When you
learn something worth keeping, `brain_write` it so the next session starts with
it. See the Eaon Brain section of `README.md`.

## Commits

The user has asked, repeatedly, that Claude not be credited. **No
`Co-Authored-By: Claude` trailer, no "Generated with Claude Code" line.**
