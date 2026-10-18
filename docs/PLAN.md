# Nabi Station: Technical & Product Plan

> Status: planning draft, 2026-10-18. Nothing here is implemented yet.
> Everything marked **SPIKE** is unverified and must be tested before we build on it.
> Everything marked **OBSERVED** was checked on the author's Windows 11 machine with
> Claude Code 2.1.302 and Codex CLI 0.163.0, by reading metadata only.

---

## 1. Product definition and core user experience

**One sentence:** Nabi Station is a local, privacy-first observability dashboard for AI-assisted development. It draws your workspace as an isometric miniature city, so you can see at a glance what your coding agents, repositories and dev tools are doing.

**Primary user:** a developer running 2–10 concurrent coding-agent sessions (Claude Code, Codex, later Gemini CLI) across several local repositories, often in different terminals or IDE windows.

**The core job:** "Which of my agents needs me right now, and where is work happening?" Every design decision is ranked against this question.

**UX principles**

1. **Glanceable first, precise second.** The city answers *where* and *roughly what*. The side panel answers *exactly what*. A visual metaphor never replaces a fact.
2. **Attention is the scarcest signal.** "Waiting for input" or "waiting for permission" is the loudest thing in the world. Everything else stays calm.
3. **Honest about confidence.** Every agent state carries a `source` and a `confidence` value. Inferred states look different from reported states. For example, a dashed status ring means *inferred*.
4. **Deterministic world.** The same repository always produces the same building. Change happens only when the repository actually changes.
5. **Local only.** No network traffic except optional, explicit integrations such as GitHub CI status.

**Core loop**

1. On first run, the user picks one or more root folders. Each root becomes a district.
2. The scanner finds git repositories. Each repository becomes a building on a plot.
3. The daemon discovers live agent sessions. Each session becomes an NPC that walks to its repository's building.
4. The user leaves the window on a second monitor or in a corner.
5. An NPC turns amber with a "?" bubble because it needs input. An optional OS toast fires. The user clicks the NPC to open the panel, which shows the session, the repository, what the agent is waiting on and how long it has been waiting, plus a "focus terminal" action (a later version).

---

## 2. MVP scope versus later versions

| Area | MVP (V1) | V2 | Later |
|---|---|---|---|
| Workspace | Pick roots; discover git repositories; districts by root | Monorepo packages as floors; manual grouping | Multi-machine and WSL workspaces |
| Git | Branch, dirty, untracked, ahead/behind, last commit, stash count | Remote CI status (GitHub API, opt-in) | PR state, review requests |
| Agents | Claude Code (session files + transcript + optional hooks), Codex CLI (SQLite state, read-only) | Gemini CLI; IDE-hosted sessions; subagents as small NPCs | Aider, Cursor agent, OpenCode; plugin SDK for others |
| Agent states | active/busy, idle, waiting-input, waiting-permission (hooks only), running-tool (by category), failed, ended | Thinking/reading/editing animation detail; per-file "touching" | Token/cost overlays |
| Tools | Dev servers (listening ports owned by processes in a repository), Docker containers via the Docker CLI/API, test runner, linter or build in progress (child processes) | MCP servers; databases as utility buildings | Kubernetes, remote services |
| Buildings | Deterministic archetype + tier from ~15 repository signals | Style details (signage, rooftop, loading dock) | Optional local LLM classification (Ollama) |
| Rendering | Three.js (R3F) orthographic isometric view, pan/zoom/click, ~6 code-built building archetypes × 5 tiers, 2–3 custom rigged characters (Claude, Codex, generic) | Day/night, weather tied to CI health, more character variants | Theming, user-supplied GLB packs |
| Platform | Windows | macOS, Linux | — |
| Shell | Browser UI served by the local daemon; Tauri shell optional | Tauri app with tray, toasts, autostart | — |

---

## 3. Proposed architecture

```
 ┌──────────────────────────── local machine ─────────────────────────────┐
 │                                                                        │
 │  Collectors (in daemon)               Core (daemon, Node/TS)           │
 │  ┌──────────────────────┐             ┌──────────────────────────┐     │
 │  │ WorkspaceScanner     │──facts──┐   │ Fact store (in-memory +  │     │
 │  │ GitWatcher           │──facts──┤   │   SQLite cache)          │     │
 │  │ ProcessSampler ◄─────┼─native───┤──►│ Correlator (agent↔repo,  │     │
 │  │ PortScanner          │──facts──┤   │   tool↔repo)             │     │
 │  │ Agent adapters:      │         │   │ Agent state machines     │     │
 │  │  claude-code         │──facts──┤   │ Scoring / building gen   │     │
 │  │  codex               │──facts──┤   │ World model (derived)    │     │
 │  │ HookReceiver (opt-in)│──events─┘   └────────────┬─────────────┘     │
 │  │ DockerCollector      │                          │ snapshot + patches│
 │  └──────────────────────┘                          ▼ (WebSocket, auth) │
 │                                       ┌──────────────────────────┐     │
 │  Native helper (Rust)                 │ UI (React + Three.js/R3F) │     │
 │  process snapshot, cwd (PEB),         │ city canvas + side panel │     │
 │  open ports per pid                   └──────────────────────────┘     │
 └────────────────────────────────────────────────────────────────────────┘
```

**Key ideas**

- **Collectors emit facts, not visuals.** A fact is a typed observation with a source, a timestamp and a confidence value, for example `GitStatusFact`, `ProcessFact` or `AgentSessionFact`.
- **The correlator** joins facts across sources: pid → session → cwd → repository.
- **The world model is a pure function of the facts plus a layout seed.** It is fully derivable, so we never persist visual state that could drift from reality. Only the layout (plot positions) is persisted, so buildings don't move around between runs.
- **The UI is a thin client.** It receives one snapshot, then JSON patches. It also works in a plain browser, which helps during development.

---

## 4. Recommended technology stack, with reasoning

| Concern | Recommendation | Alternatives considered | Reasoning |
|---|---|---|---|
| Daemon language | **Node.js 22 + TypeScript** | Rust (all), Go | Matches the author's skills. The ecosystem has chokidar/@parcel/watcher, better-sqlite3, simple-git and ws. Hot paths go to a native helper. |
| Native OS access | **Small Rust helper binary** (`sysinfo` crate + windows-rs), called over stdio JSON-lines | N-API addon; PowerShell/WMI; `ps-list` | WMI/CIM **cannot return another process's cwd**, and spawning PowerShell takes ~300 ms or more. A Rust sidecar is portable, avoids Node ABI rebuilds, and works whether or not we use Tauri. **SPIKE S2.** |
| File watching | **@parcel/watcher** | chokidar, fs.watch | Native ReadDirectoryChangesW, handles large trees, used by VS Code-class tools. |
| Git | **`git` CLI** (`status --porcelain=v2 -z --branch`, `for-each-ref`, `log -1`) | isomorphic-git, nodegit, gitoxide | Exact parity with the user's git, including config, worktrees and fsmonitor. isomorphic-git is slow on large repositories, and nodegit is painful to build. |
| Local DB | **better-sqlite3** (cache of scans and layout) | LevelDB, JSON | Also needed to *read* Codex's SQLite read-only. |
| Renderer | **Three.js via React Three Fiber** (+ drei), orthographic camera at a fixed isometric angle | PixiJS (2D sprites), Phaser, Babylon | **Decided 2026-10-18.** We are not using a stock asset kit. Buildings are generated from code as geometry (archetype × tier × modules × seed), and characters are custom GLB models. A depth buffer removes the isometric drawing-order problem. Lit windows and beacons are just glowing materials. PixiJS was rejected because code-composed sprite art would need hand-drawn parts for every combination. **SPIKE S6** checks performance. |
| 3D asset pipeline | **Higgsfield** (character concepts and sheets) → **Meshy** (image-to-3D, rig, animation clips) → **Blender MCP** (clean-up, scale/pivot, merging clips, building/environment parts, glTF export) → `gltf-transform` (meshopt + KTX2) | Hand modelling only; stock kits | Custom identity per agent type without a full-time 3D artist. See §14.1. **SPIKE S7.** |
| UI | **React 19 + TypeScript + Vite**, Zustand for client state, Radix/shadcn for the panel | — | User preference. The panel is an ordinary app UI. |
| Desktop shell | **Tauri v2** (V1.5), with the Node daemon as a *sidecar* | Electron | Smaller footprint. The Rust helper can be folded into Tauri later. Tray, toasts and autostart come via plugins. Electron is the fallback if Node-sidecar packaging in Tauri hurts. V1 can ship as "daemon + open http://127.0.0.1:port". |
| Packaging | Node daemon bundled with **Node SEA** or `pkg` successor; Rust helper per OS | — | **SPIKE S8.** |
| Schema/validation | **zod** for every external format (session files, hooks, SQLite rows) | — | Agent internals change without notice. Validation failures must degrade gracefully, never crash. |
| Monorepo tooling | pnpm workspaces + turbo (optional) | Nx | Keeps it light. |

---

## 5. Repository/workspace scanner design

**Input:** a list of root folders. **Output:** `Repo[]` (plus `Package[]` for monorepos) and `District[]`.

**Discovery algorithm**

1. Walk each root breadth-first with a depth limit (default 4) and a hard ignore list: `node_modules`, `.git` internals, `vendor`, `target`, `dist`, `build`, `.venv`, `__pycache__`, `.next`, `.turbo`, and anything in a `.gitignore` above the walk point once a repository has been found.
2. A directory containing `.git` (a directory, or a *file* for worktrees and submodules) is a repository. **Stop descending** into it for discovery. Submodules are found later from `.gitmodules`.
3. Non-git folders that contain a project manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `*.csproj`) with no repository ancestor are "unversioned plots". They are drawn as fenced, empty lots, because they are often real projects too.
4. Each root becomes a district. Nested grouping (`D:\git\clients\*`) can become sub-districts later.

**Per-repository static analysis** (cheap, file-existence based, done once and then on change)

- **Manifests:** package.json (deps, scripts, `workspaces`), pnpm-workspace.yaml, turbo.json, nx.json, lerna.json, pyproject/requirements, Cargo.toml (workspace members), go.mod, *.sln/*.csproj, composer.json, Gemfile.
- **Language mix:** use extension counts over tracked files (`git ls-files -z`, capped at 50k entries). This is cheaper and more correct than walking, because it respects .gitignore. Optionally use `github-linguist`-style vendored-path exclusion.
- **Quality markers:** README (size, number of headings, badges), LICENSE, CONTRIBUTING, docs/, tests (directories + test-file globs + test script), lint configs (eslint, biome, ruff, clippy.toml, golangci), formatter configs (prettier, biome, rustfmt, black/ruff format), `.github/workflows/*`, `.gitlab-ci.yml`, Dockerfile/compose, `.devcontainer`, `bin` field / CLI entry, deploy markers (vercel.json, netlify.toml, fly.toml, k8s/, terraform).
- **TODO count:** do it lazily, using `git grep -c -E "TODO|FIXME"` with a timeout. It is optional because it is expensive on huge repositories.
- **Age/maturity:** first commit date (`git log --reverse --format=%ct | head -1` is slow, so use `git rev-list --max-parents=0 HEAD` + `git log -1 --format=%ct <root>`), commit count (`git rev-list --count HEAD`, cached), number of contributors (V2).

**Monorepo packages:** use the workspace globs from the manifests. Each package becomes a *floor/wing* of the repository's building. Above ~12 packages the building becomes a campus: a cluster of small buildings on one plot. Packages are never top-level buildings.

**Incremental updates:** a watcher on the repository root, filtered to manifest and config file names, triggers a re-analysis of that repository only. Results are cached in SQLite and keyed by `HEAD` sha + config mtimes.

---

## 6. Git state detection

| Signal | Command / source | Trigger |
|---|---|---|
| Branch, upstream, ahead/behind, modified/staged/untracked counts | `git status --porcelain=v2 -z --branch --untracked-files=normal` | Debounced (500 ms) on watcher events in the worktree or in `.git/index`, `.git/HEAD`, `.git/refs/**`; plus a 60 s safety poll for *visible* repositories only |
| Last commit (sha, subject, author, time) | `git log -1 --format=...` | On `HEAD`/refs change |
| Stashes | `git stash list` count | On `refs/stash` change |
| Detached HEAD / rebase / merge in progress | Existence of `.git/rebase-merge`, `MERGE_HEAD`, `CHERRY_PICK_HEAD` | Watcher |
| Worktrees | `git worktree list --porcelain` | On scan. Each worktree is an *annex* of the main building |
| Remote CI (V2) | `gh run list` or GitHub REST with the user's token, opt-in | Poll every 2–5 min, only for repositories with a GitHub remote |

**Windows notes:** each `git` spawn costs about 20–60 ms. Never poll every repository on a timer. Cap concurrency at 4 git processes. Honour `core.fsmonitor` if configured, because it makes status fast. Large repositories (>100k files) get `--untracked-files=no` plus a periodic slow untracked check. Paths come in many forms (`D:\`, `\\?\D:\`, `/d/`, mixed case), so they need canonicalising. See §17.

**"Files currently being touched"** comes from three sources: (a) watcher events inside the worktree within the last N seconds, (b) the agent transcript's tool calls (Edit/Write paths for Claude; `fileChange` items for Codex), and (c) the git dirty set. Panel source (b) attributes changes to a specific agent. Source (a) is only "something changed here".

---

## 7. Process and terminal session discovery

**Process snapshot** (Rust helper, every 1–2 s, diffed in the helper so only changes cross stdio):

- pid, ppid, exe path, image name, command line, **creation time** (to guard against PID reuse), cwd (**SPIKE S2**: read via `NtQueryInformationProcess` → PEB → `ProcessParameters.CurrentDirectory`; requires `PROCESS_QUERY_INFORMATION | PROCESS_VM_READ`, fails for elevated or protected processes; 32/64-bit and WOW64 cases)
- CPU time delta (to tell busy from idle), and optionally working set

**Process tree:** kept in memory, keyed by `(pid, creationTime)`. Lets us answer "which descendants does agent X have right now?" and "which session owns this `vite` dev server?"

**Ports:** `GetExtendedTcpTable` (TCP_TABLE_OWNER_PID_LISTENER) → listening ports per pid. Join with the process tree and cwd to get "dev server on :5173 belongs to repository Y".

**Terminal sessions:** on Windows, terminals are hard to identify reliably. Windows Terminal hosts shells under `OpenConsole.exe`/`conhost.exe`, and the process tree gives `WindowsTerminal.exe → OpenConsole → pwsh → claude.exe`. V1 records the *terminal host chain* for display only ("in Windows Terminal / VS Code / JetBrains"). It derives this from the ancestor executables. "Focus that terminal tab" is a V2 **SPIKE**, because there is no public Windows Terminal tab API, so it would need a window handle plus heuristics.

**OBSERVED pitfall:** a plain process scan is not enough to identify agent sessions. On the test machine, `claude.exe --chrome-native-host` (pid 29840) is a long-lived helper, not a session. Processes like this must be filtered out by argv, and the session file (below) must be the authority.

---

## 8. How to detect Claude Code, Codex and other coding agents

### Verdict: what can be discovered without modifying the tools?

| | Live session discoverable? | Repository association | Busy vs idle | Waiting for permission | Tool activity (read/edit/exec) |
|---|---|---|---|---|---|
| **Claude Code** (CLI) | **Yes**: `~/.claude/sessions/<pid>.json` + pid/start-time check | **Yes**: `cwd` in the session file; activity attribution | **Yes**: `status` field (full value set: S1) + transcript growth | **Inferred only**. Reported with opt-in hooks | **Yes**: transcript `tool_use` names and paths |
| **Codex** (CLI or VS Code) | **Mostly**: `thread_turns.status = inProgress` + recent `updated_at_ms`; the pid link is weak (S4) | **Yes**: `threads.cwd`, `git_branch` | **Yes**: turn status | **Inferred only** (S5) | **Yes**: `thread_items.item_type` (`commandExecution`, `fileChange`, …) |
| **Gemini CLI** | Unverified (not installed here) | Unverified | Unverified | Unverified | Unverified |

In short, Claude Code is strong at L1 except for permission prompts. Codex is strong on turn and item state but weak on mapping processes to threads. Gemini is unverified.

The approach is layered. Each layer is optional and adds confidence:

| Layer | What it gives | Requires modifying the tool? |
|---|---|---|
| L0 Process scan | "An agent binary is running, pid, tree, cwd (with the native helper)" | No |
| L1 Agent state files (sessions, SQLite, transcripts) | Session id, cwd, coarse status, tool activity | No (reads undocumented internals, **read-only**) |
| L2 Official extension points (Claude Code hooks, statusline, OTel; Codex `notify`, OTel) | Exact events: tool start/end, permission prompts, stop, notifications | Opt-in config change by the user, which we install and uninstall cleanly |
| L3 Wrapper/plugin (shell shim, MCP server) | Anything else | Yes. Avoid in V1 |

### 8.1 Claude Code (OBSERVED, v2.1.302 on Windows)

- **Binary:** native `claude.exe` (`%USERPROFILE%\.local\bin\claude.exe`). Older installs run as `node.exe …/@anthropic-ai/claude-code/cli.js`, so match both.
- **`~/.claude/sessions/<pid>.json`** is the key finding. One file per live interactive process, containing:
  `pid, sessionId, cwd, startedAt, procStart, version, kind ("interactive"), entrypoint ("cli"), name, status ("busy" observed), updatedAt, statusUpdatedAt`, plus a `messagingSocketPath` (a named pipe).
  - `procStart` matched the process's Win32 creation time as a FILETIME (`134368181110443042` vs `134368181110443040` from CIM). The 2-tick gap is because CIM's DMTF datetime keeps only microseconds. This gives a **sound PID-reuse guard**: a session file is live only if a process with that pid *and* that start time exists. Compare against `GetProcessTimes` from the native helper, which should match exactly, or allow a tolerance of ≤ 10 ticks when using CIM. Never use strict equality against CIM.
  - `status` gives coarse liveness directly. The full set of values is **not known**. Only `"busy"` was observed. **SPIKE S1:** enumerate it by toggling a session through idle, waiting for permission and waiting for input.
  - Do **not** connect to `messagingSocketPath` in V1. It is an internal peer protocol.
- **Transcript:** `~/.claude/projects/<cwd-encoded>/<sessionId>.jsonl` (cwd encoded by replacing `:\/` and similar with `-`; resolve via sessionId, don't reverse the encoding). Tail it incrementally (track the byte offset). Each line has a `type` (`user`, `assistant`, `attachment`, `permission-mode`, `ai-title`, …). Assistant lines contain `tool_use` blocks with tool `name` and `input` (Read/Edit/Write/Bash/PowerShell/Grep/Task…). This gives **reading / editing / executing / delegating** state and the paths being touched. We parse only `type`, tool name, file path fields and timestamps. We never store or display prompt or response text by default.
- **Hooks (L2, opt-in, the reliable path for attention states):** Claude Code supports user-level hooks in `~/.claude/settings.json` (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, `SessionEnd`, …). Each hook receives JSON on stdin with `session_id`, `cwd`, `transcript_path` and `hook_event_name`. We would install a tiny hook command (`nabi-hook`) that POSTs the payload to the daemon with a token and **always exits 0 quickly**, so it can never block the agent. `Notification` is how "needs your permission / waiting for input" becomes *reported* instead of *inferred*. **SPIKE S3:** check the exact event names and payloads against the installed version, measure the latency the hook adds, and decide whether to merge into or append to the user's existing hooks safely (the user already has custom settings and a statusline).
- **OpenTelemetry (later):** Claude Code can export OTel metrics and events when `CLAUDE_CODE_ENABLE_TELEMETRY=1`. The daemon could run a local OTLP receiver. This is useful for tokens and cost, but it overlaps with hooks. V2.
- **Child processes:** under the `claude.exe` pid, a child `npm test`/`vitest`/`jest`/`pytest`/`cargo test` means **running tests**, `tsc`/`vite build`/`cargo build` means **building**, and `eslint`/`biome`/`ruff` means **linting**. This works at L0 with no hooks.

### 8.2 OpenAI Codex (OBSERVED, CLI 0.163.0 on Windows; no Codex process was running during the probe)

- **State lives in SQLite** under `~/.codex/` (WAL mode):
  - `state_5.sqlite` → table `threads`: `id, rollout_path, cwd, source ("vscode", subagent JSON, …), title, model, approval_mode, sandbox_policy, git_branch, git_sha, git_origin_url, cli_version, created_at, updated_at, archived, agent_nickname, agent_role, …`. `cwd` is stored with a `\\?\` prefix, so it must be normalised. `thread_spawn_edges` links parent and child (subagent) threads.
  - `thread_history_1.sqlite` → `thread_turns(thread_id, turn_id, status, started_at, completed_at, error_json, …)` with observed statuses **`inProgress`, `completed`, `interrupted`, `failed`**. `thread_items.item_type` is one of `userMessage, reasoning, agentMessage, commandExecution, fileChange, mcpToolCall, webSearch, imageView, contextCompaction`.
  - This is very good: *turn in progress*, *failed*, *executing a command* and *changing a file* can be read directly, **without modifying Codex**.
  - The file names carry schema versions (`state_5`, `thread_history_1`). Expect them to change, so the adapter must detect versions and fail soft.
- **Rollout JSONL:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (path in `threads.rollout_path`). This is a fallback if the SQLite schemas change.
- **`thread-writer-locks/<threadId>.lock`:** exists per thread. **SPIKE S4:** check whether the lock is *held* (an OS file lock) only while a process has the thread open. If so, testing whether the lock is held gives "this thread is live right now". If not, liveness comes from a `codex.exe` process + matching cwd + recent `updated_at_ms`.
- **Process → thread join is the weak point.** `threads` has `cwd` but **no pid**. Matching works when exactly one live Codex process (found by the native helper) has a cwd equal to one recently updated thread's cwd. When several Codex sessions share a cwd, we show them as "N Codex sessions in repository X" and assign states per thread, without claiming which pid owns which. **SPIKE S4.**
- **VS Code-hosted Codex** (`source = "vscode"`) runs via an app-server, `~/.codex/app-server-daemon`, with a control socket. **This is the author's main Codex usage:** every recent thread observed was `vscode` or a subagent. These threads have **no per-session `codex.exe` with a matching cwd**, so the process-cwd join does not apply to them. Process inspection can only tell us that the app-server daemon is running. Liveness for these threads must come from `thread_turns.status = inProgress`, recent `updated_at_ms`, and lock-file state. The *official* integration surface here is the `codex app-server` JSON-RPC protocol. Connecting to the user's running daemon is undocumented, so it is **post-V1**. The SQLite read covers these threads.
- **Codex `notify`** (config.toml, opt-in L2) runs a program on turn completion. That gives a reported "completed / your turn" event. Codex is also adding hooks. **SPIKE S5** checks what 0.163 supports. **Waiting for approval** in Codex: `approval_mode` per thread plus a turn still `inProgress` with no new items for more than N seconds after a `commandExecution` item is *inferred* only. Report it with low confidence until an official signal is confirmed.

### 8.3 Gemini CLI and others

- Gemini CLI is **not installed on the test machine**, so nothing is verified. Known (from docs, unverified here): `~/.gemini/` holds settings, per-project `tmp/<hash>/` chat logs and checkpoints; it supports OTel telemetry and, in recent versions, hooks. **Post-V1**, behind the same adapter interface.
- Generic fallback adapter ("unknown agent"): a configurable process-name list (aider, opencode, cursor-agent, …) gives L0-only NPCs with states `active` (CPU/children) and `idle`.

### 8.4 Adapter interface

```ts
interface AgentAdapter {
  id: 'claude-code' | 'codex' | 'gemini' | string;
  detectInstalled(): Promise<InstallInfo | null>;          // version, data dirs
  matchProcess(p: ProcessInfo): boolean;                   // excludes helpers like --chrome-native-host
  watchSessions(emit: (f: AgentSessionFact) => void): Disposable; // L1
  hookIntegration?: { install(): Promise<void>; uninstall(): Promise<void>; parse(e: unknown): AgentEvent | null }; // L2
  schemaProbe(): Promise<SchemaReport>;                    // detects format drift and surfaces it in the UI
}
```

Every adapter ships with **fixture tests** built from captured, sanitised samples per tool version (§21).

**Files we never read:** `~/.claude/.credentials.json`, `~/.claude/sessions/*.key`, `~/.codex/auth.json`, `~/.codex/secrets/`, any `.env` file. The adapter enforces this with an explicit deny-list, and a test covers it.

---

## 9. Associating an AI process with a repository

Priority order (the first hit wins; record which rule matched):

1. **Reported cwd from the agent itself:** Claude session file `cwd` and hook payload `cwd`, or Codex `threads.cwd`. Confidence: high.
2. **Process cwd via the native helper (PEB).** High, but cwd is the *launch* directory. An agent can `cd` in its shell children without changing its own cwd.
3. **Activity attribution:** the paths in recent tool calls (Edit/Write file paths, `fileChange` items, child-process cwds). If ≥70 % of the last 20 touched paths fall in another repository, the agent's *effective repository* moves there. **This is what makes NPCs walk between buildings.** An agent launched in `D:\git` (the district root) that edits `D:\git\foo` is placed in `foo`.
4. **Git root resolution:** map any path to its nearest repository by longest-prefix match over the canonicalised repository list (a trie). Paths outside any known root go to an "outskirts" area.

Edge cases: the cwd is the district root (NPC stands in the street until rule 3 applies), the cwd is in a worktree (annex), the cwd is in a monorepo package (that floor lights up), and the cwd is on a WSL path (`\\wsl$\…`, unsupported in V1, shown in the outskirts).

---

## 10. Agent state machine

The states are deliberately split into **lifecycle** and **activity**, and each carries `source` and `confidence` fields.

```
Lifecycle:  discovered → live ⇄ (stale) → ended
                            └→ crashed (process gone with no clean end)

Activity (only while live):
   idle ──prompt──► working ──needs approval──► waiting_permission ──approved──► working
     ▲                │  ▲                                                        │
     │                │  └─────────── tool ended ◄── running_tool(kind) ◄─────────┘
     │                ├──turn done──► waiting_input (your turn) ──(no input 10min)──► idle
     │                └──error──────► failed ──new prompt──► working
```

`running_tool(kind)` has kind ∈ `read | edit | exec | test | build | lint | web | mcp | subagent`.

| State | Claude Code signal | Codex signal | Confidence without hooks |
|---|---|---|---|
| working | session `status` (busy), transcript growing | turn `inProgress` | High |
| running_tool:edit/read | last `tool_use` name (Edit/Write/Read/Grep) | latest item `fileChange` | High (transcript) |
| running_tool:exec/test/build | `Bash`/`PowerShell` tool + child process classification | `commandExecution` + child process | High |
| waiting_permission | `Notification` hook (reported); else tool_use without tool_result for > 5 s and no child process | inferred (see §8.2) | **Low without hooks** |
| waiting_input | `Stop` hook; else session `status` value (SPIKE S1); else last line is assistant text with no pending tool | turn `completed` and no newer turn | Medium |
| idle | waiting_input for > 10 min, or a non-busy status | no turn in 10 min | Medium |
| failed | API error lines in the transcript; turn errors | turn `failed`, `error_json` | High (Codex), Medium (Claude) |
| ended | `SessionEnd` hook, or the pid is gone and the session file is removed | process gone | High |

**UI rule:** `waiting_permission` and `waiting_input` are the *attention* states. They get a bubble above the NPC, a count badge in the HUD, and an optional toast. A state with confidence below *medium* is drawn with a dashed outline and labelled "probably".

The state machine is a pure reducer: `(state, fact) → state`. It is unit-tested with recorded fact streams.

---

## 11. Tool and service detection

| Entity | Detection | World metaphor (secondary) |
|---|---|---|
| Dev server | Listening TCP port owned by a process whose cwd/ancestor is in the repository; classified by argv (vite, next, webpack-dev-server, nodemon, uvicorn, flask, rails, `dotnet watch`) | Building windows lit; port number on a small sign |
| Test runner | Process argv matches jest/vitest/mocha/playwright/pytest/`cargo test`/`go test`/`dotnet test` | QA crew / inspector at the building |
| Build | tsc, vite build, webpack, esbuild, cargo build, msbuild | Scaffolding / crane |
| Lint/format | eslint, biome, prettier, ruff, clippy | Maintenance worker |
| Git network ops | `git fetch/push/pull` processes | Courier van on the road to the city gate |
| Docker | Docker Engine API on `npipe:////./pipe/docker_engine` (do not spawn the CLI): containers + `com.docker.compose.project.working_dir` label → repository | Logistics yard / trucks |
| Databases | Listening on 5432/3306/27017/6379 or matching process names; containers too | Utility buildings at the district edge |
| MCP servers | Child processes of agent processes with `mcp` in argv/package name; or from the agents' MCP config files | Small service kiosks next to the agent's current building |

Results of the last test, lint and build runs (pass/fail) are **not** generally knowable from process observation alone. V1 options, in order:

- exit codes of child processes. **SPIKE S2b:** can the helper get the exit code of a non-child process on Windows? Possibly via `OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION)` held open + `GetExitCodeProcess`.
- the agent transcript's tool_result for Bash test commands
- CI status (V2)

Unknown results are shown as "unknown". We never pretend.

---

## 12. Repository scoring and deterministic building generation

**Inputs → normalised signals (0..1)**, all computed by the scanner:

| Signal | Example derivation |
|---|---|
| `size` | log-scaled tracked LOC or file count |
| `maturity` | log(commit count) × age factor |
| `docs` | README present/length/headings, docs/ folder, badges |
| `tests` | test dir + test script + test file ratio |
| `lint` / `format` | config present |
| `ci` | workflows present (+ last CI green in V2) |
| `container` | Dockerfile / compose / devcontainer |
| `deploy` | deploy config present |
| `cli` | `bin` field, `[[bin]]`, console_scripts |
| `deps` | dependency count (log) |
| `activity` | commits in the last 14 days (decayed) |
| `hygiene` (negative) | TODO density, stale lockfile, very old last commit, failing CI (V2) |

**Building = archetype × tier × modules × condition**

- **Archetype** comes from the primary language/framework (deterministic table):
  TS/JS web → glass office; React Native/mobile → studio; Python → laboratory; Rust/C/C++/Go → industrial plant; Java/C#/Kotlin → corporate tower; PHP/Ruby → brick townhouse; docs-only repository → library; infra repository (terraform/k8s) → power station; unknown → warehouse.
- **Tier (0–4)** comes from a weighted sum of the *capability* signals:
  0 empty plot (repository with ≤1 commit), 1 construction site, 2 small building, 3 established, 4 landmark. Each tier has explicit, documented thresholds, so the user can see *why* (the panel shows "Next tier: add CI + tests").
- **Modules** are attachments switched on by booleans: tests → reinforced frame, CI → rooftop antenna/dish, Docker → loading dock, docs → signage/library wing, deploy → helipad/flag, CLI → side terminal kiosk, lint/format → tidy landscaping.
- **Condition** comes from hygiene/activity: faded paint, a boarded window, weeds. Changes are always subtle and capped, so we never shame a repository loudly.
- **Size/footprint** comes from `size` (1×1, 2×2, 3×3 tiles).
- **Variant seed** is `hash(repo canonical path)`. It picks colour palette, window pattern and roof variant *within* the archetype, so two TS repositories don't look identical yet each looks the same every run.

**Progression is automatic:** adding a README, tests or CI changes the signals, and the building upgrades with a short construction animation. There is no XP.

**Optional LLM classification (later):** an Ollama adapter can propose `archetype`/`projectType` for repositories that the table scores as "unknown". The result is cached by HEAD sha and shown as "AI-suggested", never as a hard dependency.

---

## 13. World/city data model

```ts
type Confidence = 'reported' | 'high' | 'medium' | 'low';

interface World { version: number; districts: District[]; roads: Road[]; agents: AgentNpc[]; tools: ToolEntity[]; updatedAt: number }
interface District { id: string; rootPath: string; name: string; bounds: TileRect; plots: Plot[] }
interface Plot { id: string; repoId: string | null; tile: TileRect }        // layout is persisted
interface Repo {
  id: string; path: string; name: string; districtId: string;
  analysis: RepoAnalysis;          // static signals (§12)
  git: GitState;                   // §6
  packages: PackageInfo[];
  building: BuildingSpec;          // derived: archetype, tier, modules, condition, seed, footprint
  runtime: { devServers: Port[]; containers: ContainerRef[]; activeAgentIds: string[]; touchedFiles: TouchedFile[] };
}
interface AgentNpc {
  id: string;                       // `${adapter}:${sessionId}`
  adapter: string; pid?: number; procStart?: string; sessionId: string;
  title?: string; host?: 'terminal' | 'vscode' | 'jetbrains' | 'unknown';
  lifecycle: 'live' | 'stale' | 'ended' | 'crashed';
  activity: { state: AgentActivity; toolKind?: ToolKind; since: number; source: string; confidence: Confidence };
  location: { repoId: string | null; packageId?: string; rule: 'reported-cwd' | 'proc-cwd' | 'activity' | 'none' };
  parentAgentId?: string;           // subagents
}
interface Road { from: string; to: string; kind: 'dependency' | 'shared-agent' | 'submodule' }
```

**Roads (V1, conservative):** draw an edge only for real relationships. Examples: repository A's manifest depends on a package *published by* repository B (match by package name), `file:`/`link:` deps, submodules. All other roads are just a district grid for aesthetics.

**Layout:** a deterministic grid packer per district (sort by size, place in a spiral). The result is persisted, so newly discovered repositories fill empty plots and existing buildings never move. The user can drag-relocate a building (persisted).

---

## 14. Visualization/rendering approach

**Decision: Three.js with React Three Fiber.** The camera is a fixed-angle orthographic isometric camera, and the style is low-poly, flat-shaded and stylised. There are no stock model sets: buildings and environment are generated in code, and characters are custom.

- **Scene graph:** `<Canvas>` (R3F) → ground tiles (one `InstancedMesh`) → roads (merged geometry per district) → buildings (one group per repository, built from `BuildingSpec`) → characters (skinned GLB instances) → effects → labels and bubbles (drei `<Html>` or SDF text sprites, used sparingly) → HUD and panel as React DOM outside the canvas.
- **Camera:** an `OrthographicCamera` at the classic isometric angle (yaw 45°, pitch ≈ 35.26°). Rotation is locked by default, with an optional rotate-in-90°-steps key. Pan by dragging, zoom with the wheel (0.25×–2×), and pick by raycasting (R3F pointer events). Shortcuts: `N` jumps to the next agent needing attention, `F` focuses the selected item. A fixed camera keeps the view glanceable.
- **Code-built buildings (`packages/building-gen` + `apps/web/src/city/buildings`):** a pure function `BuildingSpec → part list`. Each part is a primitive or extruded shape: base slab, floors (height = tier), facade style per archetype, roof type, and modules (antenna = CI, loading dock = Docker, scaffolding = build in progress). A seeded RNG picks palette, window rhythm and roof variant. Reusable *hero parts* that are hard to build in code (satellite dish, crane, forklift, lab dome) are modelled in Blender and loaded as GLB, then combined with the code-built parts.
- **Performance tactics:** share geometries and materials through a part cache keyed by `(part, params)`; draw repeated parts across buildings (windows, AC units, trees) with `InstancedMesh`; merge each building's static parts with `BufferGeometryUtils.mergeGeometries` once it's built; rebuild only when a building's spec hash changes.
- **Lighting and state:** one directional light (sun) plus a hemisphere light, and a soft shadow map (or baked contact shadows if S6 shows shadows are too expensive). Windows use a shared emissive material whose intensity is driven per building through an instance attribute or uniform: dark when inactive, lit when an agent or dev server is present. Warning beacons and CI signals are small emissive meshes. Selective bloom (postprocessing) is optional and off when reduced motion is enabled.
- **Characters:** custom GLB models (§14.1), one per agent type: Claude Code, Codex, generic, and later Gemini. Each agent's identity is shown by a tint and accessory chosen from the session id hash, so several Claude sessions can be told apart. `AnimationMixer` per character, with clips mapped from agent state (below). Clone with `SkeletonUtils.clone`. 40 skinned characters is well within budget, and baked vertex-animation textures for instancing are only a fallback if S6 says otherwise.
- **Character movement:** A* over the road graph, with walking animated by the `walk` clip and the speed matched to the stride. When the location changes, the character walks; if the route takes more than 6 s, it switches to `run`. Several agents in one building gather around the entrance in slots.
- **Agent state → animation clip:**

| Agent state | Clip | Overlay |
|---|---|---|
| working / thinking | `think` (idle with head-scratch or floating gear) | — |
| running_tool:read | `read` (holds clipboard or book) | — |
| running_tool:edit | `type` (laptop or toolbox) | — |
| running_tool:exec/build/test | `operate` (lever or hammer) | QA or crane prop near the building |
| waiting_input / waiting_permission | `wave` (looping gently) | "?" / "!" bubble, amber ring |
| idle | `idle` (sitting on a bench near the building) | — |
| failed | `slump` | red ring |
| walking between repositories | `walk` / `run` | — |
| ended | `exit` (walks to the district gate and fades out) | — |
- **Calmness budget:** at most one looping animation per building; lights fade over 400 ms; attention bubbles pulse gently; everything else is static. Add a "reduced motion" toggle.
- **Panel:** React DOM, not canvas. It shows exact data (§1's list) with copyable paths and "open in editor/terminal/explorer" actions.

### 14.1 Custom asset pipeline (Higgsfield → Meshy → Blender → Three.js)

| Step | Tool | Output | Notes |
|---|---|---|---|
| 1. Concept | **Higgsfield** image generation / character sheets | Front, side and back turnaround per character in one shared style guide (palette, proportions, outline style) | Fix one style key and reuse the seed and reference images across all characters, so they look like a family |
| 2. Image → mesh | **Meshy** `image_to_3d` / `multi_image_to_3d` (multi-view from the turnaround) | Textured GLB | Ask for low-poly / remeshed output (≈5–10k triangles per character); `meshy_remesh` if needed |
| 3. Rig + clips | **Meshy** `rig` (includes walk and run) + `animate` from its action library; `text_to_motion` for custom actions (`type`, `wave`, `slump`) | Rigged GLB + one GLB per clip | Every Meshy step costs credits. The pipeline lists the cost for each character up front, and nothing is generated without confirmation |
| 4. Clean-up + assembly | **Blender MCP** | One GLB per character: a single armature with all clips as named NLA actions, normalised scale (1 unit = 1 tile), pivot at the feet, +Z forward, merged materials, ≤ 1–2 textures | Scripted: `tools/blender/assemble_character.py` runs headless, so the result can be reproduced from the source files |
| 5. Environment parts | **Blender MCP** (modelled or code-generated in Blender) + Three.js code-built parts | Hero props (dish, crane, forklift, dome, trees, benches, lamp posts) as GLB | Simple geometry stays in code. Blender is for parts that need hand shaping |
| 6. Optimise | `gltf-transform` CLI: `dedup`, `prune`, `weld`, `meshopt`, KTX2 (`etc1s`/`uastc`) | `assets/dist/*.glb` | Budget: ≤ 1.5 MB per character, ≤ 15 MB total for V1 |
| 7. Validate | glTF validator + an in-app asset gallery page | Thumbnails of every character × clip and building archetype × tier | Used for visual regression (§21) |

Source files (concept images, raw Meshy downloads, `.blend` files) live in `assets/src/`, with a `assets/MANIFEST.json` recording each asset's provenance: tool, task id, prompt or reference, date. Licences and terms of use for Higgsfield and Meshy output must be checked for the intended distribution (open source vs commercial) before release. This is part of **SPIKE S7**.

---

## 15. Real-time event architecture

- **Inside the daemon:** collectors → typed `Fact` events on an in-process bus → correlator/reducers update the **fact store** → a **world projector** recomputes affected entities only (dirty-tracking by repoId/agentId) → a **diff** is emitted.
- **Daemon → UI:** WebSocket. The first message is a full `World` snapshot plus a version. After that come `{version, patches: JsonPatch[]}` batched at 10 Hz max. If the client sees a version gap, it resyncs with a snapshot.
- **Hooks → daemon:** HTTP POST to `127.0.0.1:<port>/hook/<adapter>` with a bearer token read from `~/.nabi/token`. The hook script uses a 300 ms timeout and fire-and-forget, so if the daemon is down the agent is never slowed or broken.
- **Backpressure:** the process sampler sends diffs only. File watcher events are coalesced per repository (250 ms). Git status runs through a per-repository single-flight queue.
- **Time:** a monotonic clock for durations, wall clock for display.

---

## 16. Local permissions and security

- **Read-only by design.** The daemon never writes into repositories or agent data directories. The single exception is the *opt-in* hook installation into `~/.claude/settings.json` / `~/.codex/config.toml`, done with a backup, a diff preview, a merge that preserves the user's existing hooks/statusline, and an uninstall command.
- **No secrets:** an explicit deny-list (§8.4). Transcript parsing extracts only event types, tool names, file paths and timestamps. Prompt and response text is **not** persisted, and is shown only on demand, in-memory, if the user enables "show conversation preview".
- **Local server hardening:** bind to `127.0.0.1` only, use a random per-install token on every HTTP/WS request, check the `Origin` header (blocks other browser tabs and DNS-rebinding), allow no CORS, and require a `Host` header of `127.0.0.1`/`localhost`.
- **No network** except opt-in integrations (GitHub CI). Show an "offline" indicator. No telemetry.
- **Elevation:** never required. Elevated processes we can't inspect show as "restricted".
- **SQLite reads of other tools:** `mode=ro` (and `immutable` must **not** be set, because the DB is live). Open briefly, query, close. Test that we never block Codex writers (**SPIKE S4**).

---

## 17. Windows-specific concerns

- **No cwd from WMI/CIM** → Rust helper with PEB reading (S2).
- **PowerShell/WMI is too slow to poll** → `CreateToolhelp32Snapshot`/`NtQuerySystemInformation` via the helper.
- **Path canonicalisation:** strip `\\?\`, normalise drive-letter case, use `GetFinalPathNameByHandle` for symlinks/junctions/subst drives, compare case-insensitively, convert `/d/...` (Git Bash) forms.
- **Long paths** (> 260): use the `\\?\` prefix internally when calling OS APIs.
- **File watching:** ReadDirectoryChangesW buffer overflows on huge trees, so fall back to a rescan. Antivirus and indexers cause event storms, so debounce.
- **Git on Windows:** slow process spawn, CRLF noise, `core.fsmonitor` availability, Git for Windows vs WSL git.
- **Named pipes:** Docker engine via npipe; agent-internal pipes are off-limits in V1.
- **Process creation-time PID guard:** PIDs are reused aggressively, so always key by `(pid, creationTime)`.
- **Defender/SmartScreen:** an unsigned Rust helper and installer will get warnings, so plan for code signing before public release.
- **WSL:** agents running inside WSL are invisible to Win32 process APIs. Mark this as unsupported in V1 and list it as a future adapter (run the helper inside WSL).

---

## 18. Cross-platform strategy

- Everything OS-specific lives in the **Rust helper**, behind one JSON-lines protocol (`snapshot`, `cwd`, `ports`, `exit-watch`). macOS uses `proc_pidinfo`/`libproc`, and Linux uses `/proc/<pid>/cwd` + `/proc/net/tcp`. Linux is the easiest platform. On macOS, cwd works for same-user processes without SIP issues. **Verify in a later spike.**
- The Node daemon only uses `path`-agnostic canonical paths (a `CanonPath` branded type).
- Agent adapters resolve data directories via `os.homedir()` plus per-tool env overrides (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`).
- CI matrix: Windows first; Linux in CI from day one (cheap and catches path assumptions); macOS once the helper's macOS backend exists.

---

## 19. Performance for large workspaces

Targets: 200 repositories, 20 live agents, idle CPU < 1 %, RSS < 250 MB, UI at 60 fps at 100 buildings plus 30 NPCs.

- Scan lazily. Quick discovery (existence checks) comes first and draws plots immediately; deep analysis (`git ls-files`, commit counts) runs afterwards in a low-priority queue, at most 2 concurrent.
- Watch only repository roots, and use @parcel/watcher's native ignore. Don't watch `node_modules`.
- Run git status only on change, with single-flight per repository and global concurrency of 4.
- Sample processes in the helper with diffs only; tail transcripts by byte offset; poll Codex SQLite every 1 s with an `updated_at_ms > last` cursor.
- Renderer: shared geometries and materials, `InstancedMesh` for repeated parts, merged static building geometry, frustum culling, `frameloop="demand"` when nothing animates (characters and lights call `invalidate()`), no per-frame React state (animation runs in `useFrame` with refs; React only touches the HUD/panel), and `setPixelRatio(min(dpr, 2))`.
- Back off when the window is hidden. The UI tells the daemon its visibility, and the daemon slows its polls (agents stay at full rate so toasts still work).

---

## 20. Suggested folder/project structure

```
nabi-station/
├─ apps/
│  ├─ daemon/              # Node/TS: collectors, correlator, world projector, http/ws server
│  │  └─ src/{collectors,adapters,correlate,state,world,server,store}/
│  ├─ web/                 # React + Vite UI: city (Three.js/R3F) + panel
│  │  └─ src/{city/{scene,camera,buildings,characters,effects,paths},panel,hud,net}/
│  └─ desktop/             # Tauri shell (phase 4+), sidecar config
├─ native/
│  └─ proc-helper/         # Rust: process snapshot, cwd, ports, exit-watch (per-OS modules)
├─ packages/
│  ├─ protocol/            # shared types + zod schemas (World, Fact, patches, helper protocol)
│  ├─ agent-adapters/      # claude-code/, codex/, gemini/, generic/ — each with fixtures/
│  ├─ repo-analysis/       # scanner + signal extraction + scoring (pure, testable)
│  ├─ building-gen/        # BuildingSpec from signals (pure, deterministic)
│  └─ hook-cli/            # tiny `nabi-hook` binary/script installed into agent hooks
├─ assets/
│  ├─ src/                 # Higgsfield concepts, raw Meshy GLBs, .blend files
│  ├─ dist/                # optimised GLB/KTX2 shipped with the app
│  ├─ MANIFEST.json        # provenance per asset (tool, task id, prompt/ref, date)
│  └─ LICENSES.md
├─ tools/blender/          # headless Blender scripts (assemble_character.py, export_parts.py)
├─ tools/                  # fixture capture/sanitise scripts, spike scripts
├─ docs/                   # this plan, ADRs, spike reports
└─ pnpm-workspace.yaml
```

---

## 21. Testing strategy

- **Pure-core unit tests (Vitest):** scoring, building generation (snapshot `BuildingSpec` for fixture repositories), state-machine reducers (recorded fact streams → expected state timelines), path canonicalisation (a large table of Windows path forms), correlation rules.
- **Adapter fixture tests:** per tool *version*, stored as `fixtures/<tool>/<version>/`: sanitised session JSON, transcript snippets (text replaced with placeholders), SQLite DBs built from captured schemas. Also add a **schema-drift test** that runs `schemaProbe()` against the live machine in a dev-only job.
- **Scanner tests:** generated temp workspaces (git init, add manifests, worktrees, submodules, monorepos), and a large synthetic workspace for performance.
- **Helper tests:** spawn known processes with known cwds and ports, then assert the snapshot. Run on Windows and Linux CI.
- **Integration:** a "scenario runner" that plays a scripted fake agent (writes session files and transcript lines on a timeline) and asserts the WebSocket patch stream.
- **Visual:** Playwright screenshot tests of the city for fixed world snapshots (deterministic seed), plus a storybook-like gallery of all archetype × tier × module combinations.
- **Security:** tests that the server rejects a missing token or a bad Origin, and that deny-listed files are never opened (wrap fs in tests).

---

## 22. Major technical risks and experiments

| # | Risk | Spike | Pass criteria | Fallback if it fails |
|---|---|---|---|---|
| **S1** | Claude `sessions/<pid>.json` `status` values, update cadence and lifecycle are unknown/undocumented | Drive one session through prompt → tool → permission prompt → idle → clean exit → killed process; log every write. Also check: is the file deleted on clean exit and left behind on a crash? Which `kind`/`entrypoint` values appear for VS Code/JetBrains-hosted sessions (`~/.claude/ide/*.lock` exists)? Do headless `claude -p` and Agent SDK runs write a session file at all? | Distinct values for busy vs waiting vs idle, updated in < 1 s; known end-of-life behaviour | Use transcript inference + hooks (S3). Headless/SDK runs without session files are invisible at L1 and are found only via hooks or the process scan |
| **S2** | Reading another process's cwd on Windows | Rust helper: PEB read for claude.exe, codex.exe, node, pwsh; elevated vs not | Correct cwd for same-user non-elevated processes; < 50 ms for 300 processes | Rely on agent-reported cwd (Claude ✓, Codex thread cwd) + activity attribution |
| S2b | Exit codes of non-child processes (test pass/fail) | Hold handles to test runners' pids; read `GetExitCodeProcess` | Reliable codes for short-lived processes | Show "ran tests" without a result; use transcript tool_result |
| **S3** | Claude Code hooks: exact events/payloads, latency, safe install | Install a logging hook for all events in a scratch `CLAUDE_CONFIG_DIR` | All attention states observable; < 50 ms overhead; clean merge/uninstall | Ship without hooks; label attention states "probably" |
| **S4** | Codex liveness and process↔thread join; SQLite read contention | Run 2 Codex CLI sessions in the same and in different cwds, **plus IDE-hosted (VS Code app-server) threads**, where there is no per-session process; test lock-file holding; poll SQLite at 1 Hz with ro connections | Correct live-thread set; no `SQLITE_BUSY` errors in Codex | Treat a thread as live if `inProgress` or updated within 2 min plus any codex.exe present |
| **S5** | Codex attention states (approval pending) | Trigger an approval prompt in the CLI and in VS Code; diff the SQLite/rollout items | A detectable item or status for "awaiting approval" | `notify` hook for turn-complete; approval = low-confidence inference |
| **S6** | Three.js/R3F performance with code-built buildings, shadows and skinned characters | Prototype 200 code-built buildings (instanced + merged), 40 skinned GLB characters with a mixer each, shadows on/off, pan/zoom | 60 fps on an integrated GPU; < 300 draw calls; idle GPU near zero with `frameloop="demand"` | Bake shadows; lower building detail when zoomed out; vertex-animation textures for characters |
| **S7** | Custom asset pipeline: style consistency, rig and clip quality, cost, licence | Take **one** character end to end through Higgsfield → Meshy (multi-view → rig → 5 clips) → Blender MCP assembly → gltf-transform → loaded in the R3F scene; also 3 code-built archetypes × 3 tiers. Record credits spent and time per step; review Higgsfield and Meshy terms of use | Readable at 0.5× zoom; every agent state recognisable from its clip and overlay alone; ≤ 1.5 MB per character; repeatable via scripts; licence suitable for distribution | Generic Meshy library clips only; simpler capsule-style characters modelled in Blender; generate concepts only and model by hand |
| S8 | Packaging a Node daemon + Rust helper (+ Tauri sidecar) on Windows | Build a signed-less installer; cold start time | Start < 2 s; single installer | Electron shell, or plain daemon + browser |
| S9 | Format drift across agent versions | Weekly script that diffs schemas/fields on upgrade | Detect before users do | `schemaProbe` warns in the UI, and the adapter degrades to L0 |

Each spike produces a short report in `docs/spikes/Sx-*.md` with the findings and the decision.

---

## 23. Phased implementation roadmap

- **Phase 0, Spikes (1–1.5 weeks):** S1, S2, S3, S4 first (they decide the agent architecture), then S6. S7 (asset pipeline) runs in parallel, because generating and assembling assets doesn't depend on the daemon. Write ADRs.
- **Phase 1, Static city (1–2 weeks):** scanner, git state, code-built buildings, Three.js/R3F city with pan/zoom/click, panel with exact repository data. The browser UI is served by the daemon. Placeholder capsule characters until the S7 assets land.
- **Phase 2, Live agents (2 weeks):** native helper, Claude Code adapter (session files + transcript), Codex adapter (SQLite), state machine, NPCs walking between buildings, attention HUD.
- **Phase 3, Reported states + tools (1–2 weeks):** opt-in Claude hooks installer, Codex notify, dev servers/ports, test/build/lint child-process detection, Docker.
- **Phase 4, Desktop polish (1–2 weeks):** Tauri shell, tray, toasts for attention states, autostart, settings, reduced motion, packaging.
- **Phase 5, Beyond V1:** macOS/Linux helper backends, Gemini adapter, CI status, monorepo floors, roads from dependencies, OTel receiver, Ollama classification, focus-terminal.

---

## MVP definition

A **Windows** app (local daemon + browser UI) in which:

1. The user picks root folders, and every git repository appears as a deterministic isometric building whose archetype and tier come from the repository's language and engineering signals.
2. Clicking a building shows exact git state (branch, dirty/untracked counts, ahead/behind, last commit), detected quality markers, active dev servers/ports, and active agents.
3. Every live **Claude Code** and **Codex CLI** session appears as an NPC at its repository. NPCs walk when their effective repository changes, and show working / running-tool / waiting-input / idle / failed / ended.
4. With opt-in Claude hooks, "waiting for permission/input" is *reported* and triggers a visible attention indicator. Without hooks, it is shown as *probable*.
5. Nothing leaves the machine, and nothing is written outside `~/.nabi/` except the opt-in, reversible hook config.

## Recommended architecture

**Node/TypeScript daemon** (collectors → facts → correlator → pure state reducers → derived world → WebSocket patches) + **Rust process helper** (snapshot, cwd, ports) + **React/Vite UI with Three.js (React Three Fiber)** orthographic isometric renderer: buildings generated in code from repository signals, custom rigged characters from a Higgsfield → Meshy → Blender pipeline. Agents are integrated through **versioned adapters** layered L0 (process) → L1 (read-only agent state files) → L2 (opt-in official hooks). Every derived state carries source and confidence. A **Tauri** shell is added after the core works in a browser.

## First 5 implementation milestones

1. **M1, Agent discovery CLI (spike results productised):** `nabi agents` prints live Claude Code and Codex sessions with pid, cwd → repository, and state, refreshing every second. This proves the hardest and most valuable part before any graphics.
2. **M2, Workspace + git model:** `nabi scan <roots>` emits the `Repo[]` model with signals, `BuildingSpec` and live git state over WebSocket. Fixture tests for scoring.
3. **M3, Static isometric city:** an R3F scene with an orthographic isometric camera that draws districts, plots and code-built buildings from `BuildingSpec`, with pan/zoom/raycast click and an exact-data side panel.
4. **M4, Living agents:** NPCs bound to the M1 agent stream, walking between buildings, attention bubbles and HUD counter, plus lit windows for active repositories and dev servers.
5. **M5, Reported states + tools:** the opt-in Claude hooks installer, the Codex notify hook, child-process classification (test/build/lint), port → dev server mapping, Docker containers.

## Technical spikes to perform first

1. **S1:** Claude `sessions/<pid>.json` status values and cadence.
2. **S3:** Claude Code hooks event coverage, latency and safe install/merge.
3. **S4 + S5:** Codex liveness, process↔thread join, approval-pending signal, and SQLite read safety.
4. **S2:** Rust helper reading process cwd + listening ports on Windows (and exit codes, S2b).
5. **S6 + S7:** Three.js performance with 200 code-built buildings and 40 skinned characters, plus one character taken through the whole Higgsfield → Meshy → Blender → GLB pipeline.

## Features deliberately excluded from V1

- macOS/Linux support (the architecture is ready; the helper backends are not built)
- Gemini CLI, Aider, Cursor and other agents beyond the generic process-name fallback
- Connecting to agent-internal IPC (Claude messaging pipe, Codex app-server socket)
- Controlling agents (approve, send input, kill) from the city. V1 is observe-only
- Focusing a specific terminal tab or window
- Remote CI/PR status, GitHub integration
- Monorepo packages as separate floors (packages are listed in the panel only)
- Dependency-derived roads beyond trivial `file:`/workspace links
- LLM-based classification (Ollama)
- Token/cost tracking and OTel ingestion
- WSL, remote machines, devcontainers
- Day/night, weather, sound, user-supplied model packs, free camera rotation, any XP/gamification layer
