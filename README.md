# Eaon ADE

An agentic development environment, by Eaon.

Run a dozen CLI coding agents side by side, see who is working and who is stuck,
and drive them all from one place.

Eaon ADE is a real terminal — every pane is a genuine pseudo-terminal running your
login shell. It just happens to know that the thing inside the shell is usually
an agent.

The identity is the grid-A mark, coral `#F17455` on ink `#0F0F0F`, set in
Instrument Serif, Inter and JetBrains Mono. `npm run icon` regenerates the app
icon straight from the mark.

## Run it

```bash
npm install
npm run dev      # hot-reloading development window
```

Other scripts:

```bash
npm run build     # typecheck + bundle main, preload and renderer into out/
npm start         # run the built app
npm run typecheck # types only
npm run dist:mac  # unpacked .app in dist/
```

Requirements: Node 20+. On macOS, Xcode Command Line Tools (node-pty compiles
against them); on Windows, nothing beyond Node — node-pty ships a prebuilt
binary. If the Electron binary fails to download during install, run
`node node_modules/electron/install.js`.

## What is in it

**Grid** — up to twelve panes, each its own shell with its own agent. Panes carry
a short handle (Ada, Bo, Cleo…) so you can talk about them, a title lifted from
whatever the program reports, a git branch chip, and a context meter read out of
the agent's own status line.

**Status that means something** — one colour means an agent is working, another
means *you* are the bottleneck: it rang the terminal bell or printed a
confirmation prompt. Every theme picks two colours that cannot be confused, and
the second one is used nowhere else, so it always means the same thing.

**16 themes** (`⌘,` → Appearance) — nine original, seven drawn from the usual
suspects: Dracula, Gruvbox, Nord, Tokyo Night, Catppuccin, One Dark, Rosé Pine.
Dark and light. Picking one repaints the chrome, the panels, the editor and
every open terminal at once — no restart, no reconnect. Themes are plain data in
`src/shared/themes.ts`: a background, a tint, a foreground, three status colours
and the sixteen ANSI colours. Adding your own is about twenty lines.

**Eaon Brain** — what the project knows, kept as plain markdown in
`.eaonbrain/` beside the code. Notes reference each other with `[[wiki links]]`,
so the folder is a graph rather than a pile of files, and the app draws it.

The point is the MCP server. Opening a workspace registers `eaon-brain` in that
project's `.mcp.json`, so every agent you start there — Claude Code, Codex,
anything speaking MCP — gets six tools for reading and writing the same memory:
`brain_search`, `brain_list`, `brain_read`, `brain_write`, `brain_link`,
`brain_related`. A fresh session searches the brain instead of re-reading the
source tree to rebuild context it had yesterday. What one agent learns, the next
one starts with. Commit it like code.

Claude Code asks you to approve a project-scoped MCP server the first time it
sees one; that is a one-off per workspace.

**Conductor** (`⌘J`) — type once, send to the pane you are in, to every pane, or
to one you name.

**Voice dictation** (hold `Right ⌘`) — talk to your agents instead of typing at
them. Hold the key, speak, let go, and the words go wherever you were already
typing: the focused pane's prompt, the Conductor, a Vault note. A readout at the
bottom of the window shows what it can hear, which pane the words are bound for,
and the transcript as it lands. Speech is transcribed by a Whisper model
running on your own CPU — pick one in Settings › Voice and it downloads once,
from 42 MB (Tiny, roughly 6× real time) up to 727 MB (Large v3 Turbo, the most
accurate and the slowest). English-only and 99-language models both available.
No account, no API key, and no audio leaves the machine — the transcriber runs
with remote model loading switched off, so it *cannot* reach the network even if
something tried. Long dictation is cut at natural pauses and transcribed a phrase
at a time, so text lands while you are still talking.

**Dictation types; it does not send.** Your words arrive on the prompt exactly as
you said them — nothing reworded, no filler stripped, no punctuation invented —
and they stay there until you press Return yourself. A misheard word is trivial
to fix while it is sitting on the prompt and impossible to fix once an agent has
acted on it, so there is no auto-send setting to turn on by accident. The
transcript's whitespace is flattened for the same reason: a newline inside a
pasted phrase would submit the line before you could read it.

**Swarm** — hand the same opening prompt to every pane in a new workspace and
compare what comes back.

**Resume** (`⌘/`) — reads the transcripts Claude Code and Codex leave on disk and
offers them back as real `--resume` commands. Resume one into the current
workspace or open a dozen at once in a new one.

**Board** — a queue for work you have not started. Hand a card to a pane and the
card text becomes the prompt.

**Vault** — prompts and context you keep re-typing, one click from any session.

**A terminal that behaves like one** — right-click for copy, paste, select all,
find and clear. `⌘=` / `⌘-` / `⌘0` change the font size and re-fit every pane,
and the grid size flashes in the corner while it changes, so you can always see
how many columns a CLI is being given.

**Updates itself** — every launch and every few hours it asks GitHub Releases
whether there is something newer. A new build downloads quietly in the
background; nothing interrupts a running agent. When it is staged, one card
appears in the corner offering a restart, and the gear keeps a lit dot until you
take it. Settings › About shows the current version and checks on demand. A feed
that is unreachable, empty, or 404 reads as "up to date" rather than an error —
that is the normal state before the first release exists.

**Side panel** (`⌘⇧B`) — a file editor with syntax highlighting and autosave, a
git panel with staging, diffs and commits, and a tools panel that runs commands
in the focused pane and lists the scripts in the repo's `package.json`.

**Preview browser** — the window onto whatever your agents are building, next to
the terminal that is building it. It probes the usual dev-server ports and shows
the ones actually serving pages as one-click chips, so you never have to
remember whether this project came up on 5173 or 3000. The address bar takes a
bare port (`5173`), a host (`localhost:8080`), or a full URL. There is no search
box on purpose: typing into one would quietly post your keystrokes to a search
engine, in an app that otherwise talks to nobody. The page keeps its scroll,
its forms and its route when you switch tabs away and back.

## Keyboard

| | |
|---|---|
| `⌘K` | Commands |
| `⌘T` | New workspace |
| `⌘D` | Add a pane |
| `⌘W` | Close the focused pane |
| `⌘E` | Fill the grid with the focused pane |
| `⌘1`–`⌘9` | Jump to a pane |
| `⌘J` | Conductor |
| `⌘B` | Workspaces sidebar |
| `⌘⇧B` | Side panel |
| `⌘/` | Resume a session |
| `⌘,` | Settings |
| Hold `Right ⌘` | Dictate while held; let go and the words land |
| `⌘⇧D` | Dictate, starting and stopping by hand |
| `Esc` | Discard what you are dictating |

Inside a pane:

| | |
|---|---|
| `⇧Return` | New line without sending — sends `ESC CR`, which is what CLI agents read as "newline, do not submit" |
| `⌥Return` | The same thing, via Option-as-Meta |
| `⌘←` / `⌘→` | Start / end of line |
| `⌘⌫` | Delete to the start of the line |
| `⌘C` / `⌘V` / `⌘A` | Copy, paste, select all |

Every other `⌘` combo belongs to Eaon ADE, not the shell.

`⇧Return` is the binding Claude Code's `/terminal-setup` installs by hand in
iTerm2 and VS Code. Eaon ADE sends it natively, so there is nothing to set up —
but note that it means `⇧Return` no longer submits at a bare shell prompt, where
`Return` still does.

## Windows

Eaon ADE runs on Windows 10 and 11, x64 and arm64. Panes are real
pseudo-terminals there too — ConPTY rather than a Unix pty — and open in
PowerShell 7 if it is installed, otherwise Windows PowerShell. `COMSPEC` is
used only if neither is present: cmd.exe is a poor host for a CLI agent, and
picking it by default would be picking it by accident.

**The shortcuts are not the same, and they cannot be.** macOS has two
modifiers, so ⌘ can belong to the app and Control to the shell without either
noticing the other. Windows has one, and every bare Control chord already means
something to the program you are talking to — `Ctrl+D` ends input, `Ctrl+W`
deletes a word, `Ctrl+K` kills a line. An app that took those would leave you
with an agent you could not exit.

So on Windows the app takes **Ctrl+Shift** and bare Control always reaches the
shell. `Ctrl+Shift+K` for commands, `Ctrl+Shift+T` for a workspace,
`Ctrl+Shift+D` for a pane, and so on for everything ⌘ does on a Mac. Two
bindings that are ⌘⇧ on macOS need their own letters, since Shift is already
spent: the side panel is `Ctrl+Shift+O` and hold-free dictation is
`Ctrl+Shift+M`. Font size stays on plain `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, where
every Windows terminal puts it. Hold **Right Ctrl** to dictate.

The clipboard follows Windows Terminal: `Ctrl+Shift+C` and `Ctrl+Shift+V`
always work, and bare `Ctrl+C` copies when text is selected and interrupts when
it is not. Settings lists the full keymap for whichever platform you are on.

### Building it

On Windows, `npm run dist:mac`'s counterpart is:

```bash
npm run dist:win        # NSIS installer and a zip, x64 and arm64
```

The same command cross-builds from macOS. Two of the three native dependencies
ship every platform's binaries in one package, so they need no help; sharp does
not, and `npm run deps:win` fetches its Windows binaries first — `dist:win`
runs it for you. The cross-build skips the native rebuild step, because
node-gyp cannot compile for another platform and node-pty's prebuilt binary is
N-API, so it does not need recompiling.

Prefer the real thing for anything you intend to ship: `.github/workflows/windows.yml`
builds on a Windows runner, where node-pty is compiled against this exact
Electron version rather than trusted to have shipped the right prebuild.

Installers are **not code-signed**. Windows SmartScreen will warn on first run
until they are signed with an Authenticode certificate, which is a separate
purchase from the Apple Developer membership the macOS build uses.

## Cutting a release

```bash
npm version patch          # or minor / major
npm run dist:mac:release   # build, sign, notarise, staple, verify
npm run release:github     # upload to GitHub and verify the result
```

`latest-mac.yml` is the update manifest and **must** be uploaded alongside the
artifacts — it is the file the running app reads to learn a new version exists.

Two details the release script handles that are easy to get wrong by hand:

- **Hashes are recomputed after stapling.** electron-builder writes
  `latest-mac.yml` before notarisation, and stapling changes the bytes. Left
  alone, every update fails its checksum. `scripts/notarize-mac.mjs` rewrites the
  manifest from the final artifacts.
- **Asset names must be hyphenated before upload.** The files on disk contain a
  space, and GitHub rewrites spaces in asset names to *dots* — `Eaon ADE-1.0.0…`
  arrives as `Eaon.ADE-1.0.0…`. The manifest refers to the hyphenated form, so a
  hand-uploaded release resolves its manifest and then 404s on the download.
  `npm run release:github` renames the copies first, then re-fetches the
  published asset and compares its checksum against the manifest.

Block maps are deleted on purpose — they describe the pre-staple bytes, so
differential downloads would rebuild a file that fails its own checksum. Updates
fetch whole files.

### Testing updates without publishing

`Updater.supported()` also accepts a `dev-app-update.yml` in the project root, so
the whole check → download → install path can be exercised against a local feed:

```bash
# serve a newer build's artifacts plus latest-mac.yml
cd /tmp/feed && python3 -m http.server 8099
```

```yaml
# dev-app-update.yml (gitignored)
provider: generic
url: http://127.0.0.1:8099
```

Note that the final swap only works in a packaged build — in development the
running bundle is Electron's own, and Squirrel cannot find a bundle whose
identifier matches.

## How it is put together

```
src/
  main/        Electron main — PTYs, persistence, filesystem, git, session discovery
    stt/models.ts      Speech model catalogue on disk: download, verify, delete
    stt/host.ts        Owns the transcriber process and keeps one model warm
    stt/child.ts       The transcriber itself, in its own process
  preload/     The one typed bridge the renderer is allowed to use
  shared/      Types both sides agree on
    stt.ts             Model catalogue and the exact file manifest behind it
  renderer/    React UI
    lib/terminals.ts   Owns every xterm instance; terminals outlive their components
    lib/dictation.ts   Microphone capture and voice-activity segmentation
    lib/insert.ts      Decides where dictated text lands
    store/useStore.ts  Application state, persisted to disk on a debounce
    components/        Screens and panels
```

Four decisions worth knowing about:

**Terminals outlive React.** Each xterm instance lives in a detached wrapper
element that gets re-parented as you move between workspaces, so a background
agent keeps streaming while you are somewhere else. `terminals.ts` owns them;
components only borrow them.

**Output is coalesced in main.** Twelve agents streaming at once would flood the
IPC channel one write at a time, so `PtyManager` batches each pane's output on a
12 ms timer before it crosses the boundary.

**Speech runs in its own process.** Whisper holds a core for as long as it takes
to decode a phrase. In the main process that would stall every keystroke in every
terminal behind it, so the model lives in a `utilityProcess` and talks over a
message port. It is loaded on first use, kept warm while you are dictating, and
dropped after five idle minutes — a large model is real memory. Only two things
cross the boundary: a `Float32Array` of samples going out, and a string coming
back. Downloaded models are plain files under `speech-models/`, laid out exactly
as transformers.js expects a local model path, which is why the transcriber can
run with remote loading disabled entirely.

**Panes get a clean environment, not Eaon's.** A shell opened from Finder never
inherits the variables of whatever launched the app, so neither do ours.
`PtyManager.buildEnv` drops the launcher's fingerprints — `npm_*` (which is what
makes nvm complain about `npm_config_prefix`), `ELECTRON_*`, `NODE_ENV`,
`NODE_OPTIONS`, editor and agent session markers — then sets `TERM`,
`COLORTERM`, `TERM_PROGRAM=Eaon` and a UTF-8 `LANG` if the system did not supply
one. This matters more than it sounds: start Eaon from inside another agent's
session and, without this, every CLI you open thinks it is a nested child of
that session and quietly turns off transcript saving. Because panes run a login
shell, anything you genuinely set in your own profile comes straight back.

## Honest limits

- The **context meter** shows what the agent prints. If your agent does not print
  a context percentage, the pill does not appear. Eaon ADE does not estimate it.
- **Attention** is inferred from the terminal bell plus a handful of "waiting for
  you" phrasings. It is a good signal, not a guarantee.
- **Panes do not survive a restart.** Their processes died with the app. The
  workspace, its layout and its agent choices come back; use Resume to pick a
  conversation back up.
- **The preview browser is a preview, not a browser.** One page at a time, no
  tabs, no history, no bookmarks, no search. It is aimed at the thing you are
  building; `⌘⇧B` then the arrow icon hands the current address to your real
  browser when you want the full article.
- **Dev-server chips can only report what is listening.** A port serving pages
  shows up whether or not it is yours. macOS's AirPlay Receiver squats port 5000
  on every Mac, so that one is filtered by its `Server` header; anything else
  answering HTTP is taken at face value.
- **Dictation runs on the CPU.** Tiny, Base and Small are comfortably faster than
  real time; Large v3 Turbo is not, and you will wait after you stop speaking.
  Moving inference to the GPU is the obvious next step and would mainly change
  the arithmetic on the larger models.
- **Speech models are a download, not a bundle.** Dictation does nothing until
  you have chosen one — the first press sends you to Settings rather than
  guessing on your behalf and spending 42 MB of someone's tethered connection.
- **The Fn / 🌐 key cannot be the push-to-talk key.** macOS never delivers it to
  an application: Chromium's macOS event conversion translates `flagsChanged`
  only for Shift, Control, Option, Command and Caps Lock, so no key event is
  ever raised for Fn. Apps that bind it install a system-wide `CGEventTap` and
  ask for Input Monitoring. Right ⌘ is the default here instead — same corner of
  the keyboard, no permission prompt, and nothing else in ADE binds it alone.

## Privacy

No telemetry, no accounts, no update pings. The only outbound request Eaon ever
makes is downloading a speech model you explicitly picked, and dictation itself
is offline by construction — the transcriber loads models `local_files_only`
with remote loading switched off, so it cannot reach the network. Audio is held
in memory, transcribed locally, and dropped; it is never written to disk. The
microphone is open only while you are dictating.
