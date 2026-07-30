# Eaon ADE

An **Agentic Development Environment** for running and managing parallel CLI agent sessions — Claude Code, Codex, Antigravity, MiniMax, Gemini, OpenCode, Cursor Agent, and any other agent CLI — in one window.

Inspired by [BridgeSpace](https://www.bridgemind.ai/products/bridgespace) and [Orca](https://www.onorca.dev/).

## Download

**[⬇ Download for macOS (Apple silicon)](https://github.com/sanscreates/Eaon-ADE/releases/latest)**

Open the `.dmg` and drag **Eaon ADE** to Applications.

> **First launch:** this build is not signed with an Apple Developer ID, so macOS
> will say *"Eaon ADE cannot be opened because the developer cannot be verified."*
> Right-click the app → **Open** → **Open**. You only have to do this once.

The app tells you when a new version is out and links you back here. Requires an
Apple-silicon Mac; Intel builds aren't produced yet.

## Features (v1)

- **Terminal grid, up to 16 panes** — split any pane right/down, drag to resize, layout templates (1/2/4/6/8/9/12/16), GPU-accelerated rendering via xterm.js + WebGL.
- **Bring your own agents** — preconfigured presets for Claude Code, Codex, Antigravity, MiniMax, Gemini CLI, OpenCode, Cursor Agent, Aider, Auggie, Kimi, Goose, plus plain shell and any custom command. Auto-detects what you have installed.
- **Agent configuration** — Settings → Agents. Point any agent at a different binary, give it launch arguments, or give it a **standing system prompt** that rides along with every task it is handed. Add your own CLIs too. Stored in `~/.eaon/agents.json`.
- **Swarm — direct several agents from one console** (⌥7). Four roles out of the box — **coordinator, builder, scout, reviewer** — each with an editable charter saying what that role does and does not do. Assign an agent to each seat, hit **Start all**, then type one task and send it to everyone or to a single role. Agents that aren't running are started with the task. Roster and charters live in `.eaon/swarm.json`, so a repo can commit its own team.
- **Sessions that survive** — sessions live on the local server, not the browser tab. Refresh, close, reopen: agents keep running and scrollback is replayed.
- **Agent status tracking** — each pane shows live state: working, waiting for input, idle, or exited.
- **Kanban board (EaonBoard)** — Backlog → Todo → In Progress → In Review → Done. Drag cards, and **dispatch a card to one agent or to the whole swarm** — it spawns terminals with the card as the first prompt, or types it into the agents already running. Stored as plain JSON in `.eaon/board.json` next to your repo.
- **Git worktrees** — create isolated worktrees per task and run agents in them, no stashing or branch juggling.
- **File explorer + Monaco editor** — browse your project, edit with VS Code's editor, autosave-ready, ⌘S to save.
- **Git panel with diff review** — changed files, side-by-side Monaco diff against HEAD, commit from the panel.
- **Built-in browser** — a real Chromium page inside the app, not an iframe: tabs, back/forward,
  page DevTools, and its own persistent session, so a login you do while testing survives a
  restart. It finds your running dev servers by scanning ports (type `3000` in the address bar
  and you are there), emulates phone/tablet/desktop viewports, and captures the page's console
  errors — one click hands them to the focused agent as a prompt. Nothing to alt-tab to.
- **Context & memory bridge** (⌥8) — a knowledge graph of the project, stored as plain markdown in `.eaon/memory/`, beside the code. Notes link to each other with `[[wikilinks]]`, backlinks are derived, and a force-directed graph shows the shape of what you know. **Every agent shares it over MCP**: connect Claude Code, Cursor, Gemini CLI, VS Code or OpenCode in one click and they all get `create_memory`, `search_memories`, `find_backlinks` and `suggest_connections` against the same files. One agent writes down how the auth flow works; the next one — tomorrow, in a different session, in a different CLI — searches and finds it. Because it is files, it survives every restart and can be committed and reviewed like anything else.
- **Command palette (⌘K)** + keyboard shortcuts throughout.

## Architecture

```
server/   Node.js + Express + ws + node-pty — PTY session manager, REST APIs (files, git, board,
          memory), and a standalone stdio MCP server for the memory graph
client/   React + TypeScript + Vite — xterm.js terminals, Monaco, zustand stores
```

The server owns all PTY processes; the browser is a thin client over one multiplexed WebSocket. This is the same architecture that later supports remote/SSH sessions and a mobile companion.

The memory MCP server is the one part that runs outside this: agent CLIs spawn it themselves, so
it is bundled to a single dependency-free file and installed to `~/.eaon/mcp/`. It reads and
writes the same markdown files the panel does, and the app watches the folder — a note an agent
writes appears in the graph without a refresh.

## Sharing memory with your agents

Open **Memory** (⌥8) → **Agents**, and connect the CLIs you use. That writes an MCP server entry
into each one's project config, pointing at your project. Then:

```
create_memory        write something down, with tags and [[wikilinks]]
search_memories      find it again — by keyword, by tag, or both
find_backlinks       what refers to this note, and the line it refers to it on
suggest_connections  notes that look related but are not linked yet, and why
read_memory · update_memory · list_memories · link_memories · memory_graph · delete_memory
```

For a CLI that is not in the list, the dialog offers a copyable config block.

## Run it

**As a macOS app** (Electron window + built-in server):

```bash
npm install
npm --prefix client install
npm run app        # builds, then opens the native window
```

**Package a distributable app:**

```bash
npm run dist       # → release/Eaon ADE-<version>-arm64.dmg + .zip
npm run release    # same, but uploads to GitHub Releases (see RELEASING.md)
```

**In the browser instead:**

```bash
npm run dev        # server on :8787, client dev server on :5173 (open http://localhost:5173)
npm start          # or production single-port on http://localhost:8787
```

How the app works: in dev, the Electron shell spawns the server with your system Node (so `node-pty`'s prebuilt binaries load); when packaged, the server runs in-process and `node-pty` is rebuilt against Electron automatically by electron-builder.

## Shortcuts

| Keys | Action |
| --- | --- |
| `⌘K` / `⌃K` | Command palette |
| `⌥T` | New agent session |
| `⌘\` | Split pane right |
| `⌘⇧\` | Split pane down |
| `⌥W` | Close pane |
| `⌘B` | Toggle sidebar |
| `⌥1..8` | Tabs (Board / Files / Editor / Git / Pull requests / Browser / Swarm / Memory) |
| `⌘↵` | Send the task, in the swarm console |
| `⌘⇧R` | Reload the page in the browser panel |
| `⌘S` | Save file (in editor) |

## Data locations

- `~/.eaon/projects.json` — registered projects
- `<project>/.eaon/board.json` — kanban board (commit it like code)
- `<project>/.eaon/swarm.json` — swarm roster and role charters (commit it like the board)
- `~/.eaon/agents.json` — custom agents, system prompts and per-agent overrides (this machine only)
- `<project>/.eaon/memory/*.md` — the knowledge graph, one markdown note per file (commit it — it is the most valuable thing here)
- `~/.eaon/mcp/eaon-memory-mcp.mjs` — the memory MCP server agents spawn (installed automatically)
- `<project>/.mcp.json`, `.cursor/mcp.json`, `.gemini/settings.json`, `.vscode/mcp.json`, `opencode.json` — written by Memory → Agents to connect each CLI
- `<project>/.eaon/worktrees/` — worktrees created by Eaon

## Roadmap

Skills you can drag onto panes, sequenced multi-step workflows, SSH worktrees, GitHub/Linear integration, mobile companion.
