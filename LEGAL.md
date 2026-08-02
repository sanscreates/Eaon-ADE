# Eaon ADE — IP and licensing notes

Not legal advice. Get a lawyer to review before you sell this or launch it publicly.
What follows is the reasoning behind the choices in this repo and what still needs
your attention.

## What was and wasn't used

**No third-party source code was read, decompiled, copied, or adapted for this
project.** Everything in `src/` was written from scratch against the public APIs
of Electron, React, xterm.js, node-pty and CodeMirror.

Screenshots of another product were used as a description of *what the software
should do* — how many terminals fit on screen, that workspaces live in a left
rail, that a setup step asks for a folder and a terminal count. Functional
behaviour and layout conventions like these are generally not protected by
copyright; the expression of them is. So the behaviour is similar and the
expression is deliberately not.

## Where Eaon ADE deliberately diverges

| Layer | ADE |
|---|---|
| Name | **Eaon ADE**, by Eaon. No "Bridge" prefix anywhere in the product, package, bundle id or repo. |
| Surfaces | **Grid, Swarm, Board, Vault** — plain descriptive English words, not a branded family. |
| Logo | The grid-A mark: a letter A built on a 5×5 grid of rounded squares with a coral counter, drawn as inline SVG in `src/renderer/src/components/Logo.tsx` and rasterised for the app icon by `scripts/make-icon.mjs`. Commissioned for this product. |
| Palette | Coral `#F17455` on ink `#0F0F0F`, bone `#F4F2EE` type, ash `#8A8781` for meta. |
| Typography | Instrument Serif for display, Inter for interface, JetBrains Mono for data and terminals. All three are SIL OFL — see below. |
| Copy | Written for this product. Taglines, empty states, button labels and error text are original. |
| Status system | One colour means an agent is working, another means it is waiting on you, driven by the terminal bell. One colour, one meaning, used nowhere else — an Eaon ADE design, not a reproduction of anything. |

If a court ever looked at trade dress, the question is whether an ordinary user
could confuse the two products. Different name, different mark, different colour
system, different wording, and a visual element the other product does not have,
all point away from confusion.

## Other companies' trademarks in the UI

The agent picker lists **Claude Code**, **Codex**, **Gemini CLI** and **Aider**.
These are used nominatively — the only accurate way to say "this launches the
`claude` binary you already installed". That is generally permitted when:

1. the tool cannot reasonably be identified without the name,
2. no more of the mark is used than necessary (text only — no logos, no
   reproduction of their brand colours or icons), and
3. nothing implies sponsorship or endorsement.

Eaon ADE satisfies all three. Keep it that way: **do not add their logos**, do not
style buttons in their brand colours, and do not describe Eaon ADE as "official",
"powered by", or "partnered with" anyone.

Add this to your website and About screen:

> Eaon ADE is an independent project. Claude and Claude Code are trademarks of
> Anthropic. Codex and GPT are trademarks of OpenAI. Gemini is a trademark of
> Google. Eaon ADE is not affiliated with, endorsed by, or sponsored by any of them.

## Fonts

Three typefaces ship inside the app, in `src/renderer/src/assets/fonts/`. They
are bundled rather than fetched because the renderer runs behind a
Content-Security-Policy that blocks remote requests, and because a desktop tool
should not need the network to draw its own interface.

| Family | Source | Licence |
|---|---|---|
| Inter | Google Fonts latin subset — Rasmus Andersson | SIL OFL 1.1 |
| Instrument Serif | Google Fonts latin subset — Rodrigo Fuenzalida, Jordan Egstad | SIL OFL 1.1 |
| JetBrains Mono | Official release v2.304, full character set | SIL OFL 1.1 |

The OFL permits bundling and commercial redistribution. Two obligations come
with it, and both are cheap:

1. **Ship the licence.** All three OFL texts sit beside the fonts
   (`Inter-OFL.txt`, `InstrumentSerif-OFL.txt`, `JetBrainsMono-OFL.txt`). Keep
   them in any build you distribute.
2. **Never sell the fonts themselves,** and do not rename a font file and pass it
   off as an original face. Using them inside a paid application is fine — that
   is exactly what the OFL is for.

JetBrains Mono is deliberately the **full** release rather than the Google
subset. The subset omits the box-drawing block (U+2500–257F), and a terminal
missing those characters shears every CLI's borders apart. If you ever swap the
mono font, check box drawing first.

## Theme palettes

Eaon ADE ships 16 themes. Nine are original to this project: **Signal, Void, Cyber
Wave, Ember, Graphite, Deep Sea** and **Daylight**.

Seven reproduce colour values from well-known open-source palettes. All are
MIT-licensed, which permits commercial use and redistribution provided the
copyright notice travels with them:

| Theme | Project | Licence |
|---|---|---|
| Dracula | Dracula Theme — Zeno Rocha | MIT |
| Gruvbox Dark | gruvbox — Pavel Pertsev | MIT |
| Nord | Nord — Sven Greb / Arctic Ice Studio | MIT |
| Tokyo Night | Tokyo Night — Enkia | MIT |
| Catppuccin Mocha, Catppuccin Latte | Catppuccin | MIT |
| One Dark | Atom One Dark — GitHub / Atom | MIT |
| Rosé Pine | Rosé Pine | MIT |
| Solarized Light | Solarized — Ethan Schoonover | MIT |

Two things keep this clean:

1. **Ship the notices.** Include each project's MIT licence text in the
   distributed build alongside the dependency licences. Naming a theme after its
   project is accurate attribution, not a claim of endorsement.
2. **Do not adopt their logos or wordmark styling.** The name identifies the
   palette; that is nominative use, the same principle as the agent names below.

If you would rather carry no third-party names at all, delete those entries from
`SPECS` in `src/shared/themes.ts` — the theme engine and the nine original
themes are entirely self-contained.

Colour values themselves are generally too functional to attract copyright, but
the licences are permissive anyway, so complying is cheaper than arguing.

## Dependency licences

Every runtime dependency is permissive and commercially usable:

| Package | Licence |
|---|---|
| Electron | MIT |
| React / React DOM | MIT |
| xterm.js (`@xterm/*`) | MIT |
| node-pty | MIT |
| CodeMirror 6 (`@codemirror/*`, `codemirror`) | MIT |
| zustand | MIT |
| lucide-react | ISC |
| Vite / electron-vite / electron-builder | MIT |
| `@huggingface/transformers` (transformers.js) | Apache-2.0 |
| `@huggingface/tokenizers` | Apache-2.0 |
| `@huggingface/jinja` | MIT |
| onnxruntime-node / onnxruntime-web | MIT |
| sharp (pulled in by transformers.js; unused here) | Apache-2.0 |

MIT and ISC both require you to ship their copyright notice and licence text
with any binary you distribute. `electron-builder` generates a licence bundle
automatically for packaged builds — check `dist/` and confirm it is there before
you ship. Electron additionally carries Chromium's licence set; the generated
`LICENSES.chromium.html` must ride along.

## Speech model weights

Dictation runs OpenAI's Whisper models locally. **No weights are bundled with the
app** — nothing ships until a user chooses a model and downloads it, at which
point the files land in their own application-support folder.

| | |
|---|---|
| Upstream weights | `openai/whisper-*`, Apache-2.0 |
| Files actually downloaded | `onnx-community/whisper-*` — quantised ONNX conversions of the Apache-2.0 originals |
| Apache-2.0 obligations | Ship the licence text and the `NOTICE` file, and state that changes were made — the conversions are quantised, so they are modified works |

Two things worth being precise about, because they are easy to get wrong:

- Apache-2.0 is permissive and commercially usable, including for a paid product.
  It also grants a patent licence, which is a point in its favour over some
  research-model licences.
- Whisper's *outputs* are not OpenAI's property, and the model is not covered by
  the OpenAI API terms — this is the open-weights release, run entirely on the
  user's own hardware, so nothing here creates a service relationship.

If you later add a model under a non-commercial or gated licence (several strong
speech models are), that model needs its own entry here and, most likely, its own
consent step in the UI. Do not add one to `STT_MODELS` without checking.

## Before you ship

- [ ] Trademark search on "Eaon" in your market and class (software) before you
      spend money on the name.
- [ ] Register the domain and social handles under the final name.
- [ ] Add the non-affiliation disclaimer above to the site and an About screen.
- [ ] Do not use another product's screenshots, logo, or name in your marketing —
      including comparison pages. "Alternative to X" pages are a common way to
      turn a non-issue into a letter.
- [ ] Confirm the generated licence bundle exists in packaged builds.
- [ ] If you take payment, write your own ToS and privacy policy. Eaon runs
      entirely on the user's machine and sends nothing anywhere — say so plainly,
      because it is a genuine selling point and a much shorter privacy policy.
- [ ] Have counsel review before a paid launch. Design patents and utility
      patents are not something a code review can rule out.

## What Eaon ADE sends over the network

There is no telemetry, no analytics, no update check, and no account. The app
makes two kinds of outbound request, both of them things the user asked for:

- **Downloading a speech model.** Choosing a model in Settings › Voice fetches it
  from `huggingface.co` over HTTPS. That request carries nothing but the file
  path — no identifier, no usage data. Nothing is fetched in the background, on
  launch, or on a timer, and a model that is already on disk is never re-fetched.
- **Loading a page in the preview browser.** The side panel embeds a `<webview>`
  and fetches whatever address is typed into it, exactly as a browser would.
  There is no search box and no default home page beyond the last address used,
  so nothing is requested that was not explicitly navigated to. The panel also
  probes a fixed list of **loopback** ports (`127.0.0.1`) to find running dev
  servers; those connections never leave the machine.

The preview's guest content is untrusted by design and is stripped back before it
is allowed to attach — `nodeIntegration` off, `contextIsolation` on, `sandbox`
on, no preload, popups denied — so a page it loads cannot reach into the app. It
runs in its own `persist:preview` session, kept separate from anything else the
app does.

**Dictation itself is offline.** This is enforced rather than intended: the
transcription process sets `allowRemoteModels = false` and loads every model
`local_files_only`, so a missing file fails loudly instead of quietly reaching
for the internet. Recorded audio is held in memory, transcribed on the user's own
CPU, and dropped — it is never written to disk and never transmitted.

The app reads and writes:

- `~/Library/Application Support/ADE/state.json` — workspaces, presets, settings
- `~/Library/Application Support/ADE/speech-models/**` — downloaded speech models
- the `persist:preview` session store — cookies and local storage for pages
  opened in the preview browser, the same as any browser profile
- `~/.claude/projects/**` and `~/.codex/sessions/**` — read-only, to list
  resumable sessions
- whatever folder you point a workspace at

The microphone is opened only while dictation is running and closed as soon as it
stops, so the operating system's recording indicator is an accurate signal.

The renderer runs with `contextIsolation: true` and `nodeIntegration: false`, and
a Content-Security-Policy that blocks remote script. All filesystem, git and PTY
access goes through the explicit, typed bridge in `src/preload/index.ts`.
