# Nabi Station

A local workspace dashboard, drawn as an isometric neighbourhood. It shows **your real repositories and live Claude Code and Codex sessions**, read on this machine by a local daemon without modifying either tool. Without the daemon it shows nothing but a "Not connected" notice; sample data appears only at `?demo`.

## Run locally

Requires Node.js 22.13+ (for `node:sqlite`) and pnpm 9.9.0 (the pinned package manager), plus Git LFS for the character assets.

```sh
git lfs install
git lfs pull
pnpm install
pnpm dev
```

Open <http://127.0.0.1:5173>. The development server binds to loopback only.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

The production preview runs at <http://127.0.0.1:4173>. To run browser checks against the production build:

```sh
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
pnpm test:e2e:dev
```

## Live mode

The daemon scans folders for git repositories, keeps their git state current, and watches agent sessions. Use absolute paths (the command runs inside `apps/daemon`):

```sh
pnpm nabi agents                 # live Claude Code and Codex sessions (--json, --watch)
pnpm nabi scan D:/git            # one-off scan: archetype, tier, git state per repository
pnpm build && pnpm nabi serve D:/git
```

Then open `http://127.0.0.1:7357/`, or `http://127.0.0.1:5173/` under `pnpm dev`. Each start creates a new token; the daemon writes it with its port to `~/.nabi/daemon.json` (removed on exit), puts it into the page it serves, and the Vite dev server does the same, so no link needs copying. `#token=…` / `#daemon=<port>&token=…` fragments still work. Roots can also be set in `~/.nabi/config.json` as `{ "roots": ["D:/git"] }`.

Selecting an agent offers **Bring session to front** (Windows): the daemon finds the session's console window (the owning Windows Terminal window, or the console itself), otherwise the first parent process with a window (VS Code, JetBrains), and for Codex without a pid an editor window whose title contains the folder name. Only agents in the current world can be targeted, and window titles are never sent to the page. A specific terminal tab cannot be selected from outside.

What it reads, all read-only:

- **Claude Code:** `~/.claude/sessions/<pid>.json` (pid, folder, busy status) checked against the live process and its start time, and the tail of the session transcript for the current tool and file. Only event types, tool names, paths and timestamps are parsed; message text is not. `*.key` files and credentials are never opened.
- **Codex:** the newest `state_*.sqlite` / `thread_history_*.sqlite` in `~/.codex`, opened read-only, for recent threads, their folder, and the current turn and item. Codex threads carry no pid, so a thread counts as present for 30 minutes after its last update.
- **Repositories:** `git ls-files`, `git rev-list --count HEAD` and `git status --porcelain=v2` (with `GIT_OPTIONAL_LOCKS=0`).

These agent formats are undocumented and may change between versions; each state is shown with its source and confidence. "Waiting for permission" is only an inference until the opt-in hooks from the plan are added.

The daemon listens on 127.0.0.1 only. Requests with a foreign `Host` header are refused, the socket only accepts the daemon's own origin and the local Vite servers, and every connection must present the token (sent as a WebSocket subprotocol). `NABI_ADAPTERS=none` (or `claude-code`, `codex`) limits agent discovery.

Use `pnpm format` / `pnpm format:check` for formatting. Browser test screenshots and traces are written to the ignored `test-results/` directory.

## What is included

- React 19, TypeScript, Vite, Three.js, React Three Fiber, drei, and Zustand.
- A fixed-angle orthographic city: drag to pan, scroll/pinch to zoom, click a building or resident to inspect it. `F` focuses the selection; `N` selects the next agent needing attention. Keyboard-accessible repository and resident lists mirror canvas selection.
- Six procedural building archetypes, five preview tiers, seeded variations, and capability attachments.
- Claude Code, Codex, and generic GLB characters, each with a separate animation mixer and skeleton. The gallery previews all ten animation clips and all building styles.
- Demand rendering, capped pixel ratio, animation pause, system reduced-motion preference, and animation suspension when the page is hidden.
- Explicit demo observations and source/confidence labels; no external requests at runtime. No remote fonts, environments, or decoder CDNs.
- Unit tests for world references, geometry invariants, and the actual GLBs; browser tests for model loading, selection, gallery controls, mobile layout, and local-only requests.

## Structure

```text
apps/web/                 React/Vite frontend
  src/city/               Camera, layout, procedural buildings, GLB characters, scene
  src/demo/               Deterministic world fixture
  src/live/               Opt-in daemon connection (token from the URL fragment)
  src/panel/              Selection details and gallery controls
  src/state/              Client UI state
apps/daemon/              Node CLI and local daemon (`pnpm nabi …`)
  src/agents/             Claude Code and Codex session adapters
  src/workspace/          Repository discovery, git status, analysis and scoring
  src/world.ts            Observations → validated live World
  src/server.ts           Loopback HTTP + authenticated WebSocket
packages/protocol/        Shared types and Zod world validation
packages/building-gen/    Pure BuildingSpec → geometry; deterministic district layout
assets/dist/             Versioned runtime GLBs, tracked by Git LFS
assets/src/              Editable source assets (not served by the app)
tools/                   Existing, separately managed npm asset tooling
tests/                   Asset, contract, and browser tests
```

Workspace packages export TypeScript source for Vite and tests. They are private internal packages, not independently published libraries. The existing `tools/package.json` and npm lockfile remain outside the pnpm workspace.

Vite serves `assets/dist` as its public directory and copies it into `apps/web/dist` during a production build. `/characters/*.glb` therefore resolves identically in development and production. `MeshoptDecoder` is bundled from Three.js. A failed model displays a recovery hint; missing WebGL has a fallback while the DOM details panel remains usable.

## Scaffold decisions and next steps

The design is based on [the project plan](docs/PLAN.md), especially sections 12–14, 19–21. [The S7 report](docs/spikes/S7-asset-pipeline.md) records asset production and outstanding visual checks.

- `World.repos` closes the plan's missing link between plots, repository details, and building specs. References are validated. `mode` is `demo` or `live`; agents outside every scanned repository have `repoId: null` and wait at the front edge of the city. The daemon sends the full world whenever it changes (debounced by a fingerprint); JSON patches are a later optimisation.
- Live tiers come from `buildingFromSignals` (daemon): ≤ 1 commit is an empty plot, then one point each for README, tests, lint, format, CI, docs, container and deploy (0–1 → tier 1, 2–3 → 2, 4–5 → 3, 6+ → 4). Languages map onto the six existing archetypes.
- Coordinates use Y-up, +Z-forward, and roughly one unit per character height. Plot centres are 4.5 units apart horizontally and 5.6 along Z. Camera yaw is 45° and elevation is approximately 35.26°.
- Demo tiers are fixture values. Still future work: persistent layout (new repositories currently reflow the grid), file watching instead of polling (agents every 2 s, git every 10 s, rescans every 5 min), opt-in agent hooks, the native helper (process cwd, ports), dev-server/tool detection, and shadow bounds sized to large cities.
- Failed agents use the existing `failed` clip. Ended agents currently use `idle`; the exit path/fade and road-based movement are future work. `walk`/`run` can be previewed in place in the gallery.
- The initial six archetypes are office, laboratory, factory, tower, townhouse, and library. The full classifier, additional archetypes, worktree annexes, and drag-relocation are not implemented.
- This is a small scene scaffold, not the S6 performance result. Scene-wide instancing/merging, automatic quality selection, 200-repository stress tests, per-session recolouring, and hand props remain open. Each building currently renders a small group of primitive meshes.
- Projected labels share the app's DOM root to avoid the current [drei Html lifecycle regression](https://github.com/pmndrs/drei/issues/2867). Both development/StrictMode and production browser tests cover view switching. The 3D scene loads in a separate chunk; Vite still reports its size above the default 500 KB warning threshold.
- Existing asset licensing review remains open in the manifest; it is not changed by this scaffold.

React 19 is paired with R3F 9 per the [R3F compatibility guidance](https://r3f.docs.pmnd.rs/getting-started/introduction). Animation work stays in `useFrame`, using explicit invalidation for [on-demand rendering](https://r3f.docs.pmnd.rs/advanced/scaling-performance).
