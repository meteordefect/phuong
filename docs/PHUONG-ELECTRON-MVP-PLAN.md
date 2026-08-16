# Phuong Electron MVP Plan

Goal: ship Phuong as a double-clickable `Phuong.app` on macOS with the smallest possible change to the existing `kanban/` codebase. The Electron shell hosts the existing Vite UI in a `BrowserWindow` and supervises the existing Node runtime as a child process. No rewrite of business logic, no fork of the runtime.

This document is **plan only**. No code changes are included.

## Objective

A signed, notarized `.dmg` containing `Phuong.app` that, on launch:

1. Spawns the existing kanban Node runtime as a managed child process bound to `127.0.0.1` on a free port.
2. Waits until the runtime is reachable.
3. Opens a single `BrowserWindow` pointed at that runtime URL.
4. Cleanly stops the runtime on quit (`cmd+q`, window close on macOS optional, dock-icon quit, OS shutdown).

Out of scope for MVP: tray/menu-bar mode, multi-window, in-app updater UI, telemetry opt-in screen, cross-platform builds (Windows/Linux), App Store distribution.

## Non-goals (MVP)

- No changes to tRPC routers, Phuong session logic, or memory layer beyond what's required to make them path-configurable.
- No removal of Clerk from the codebase. We **gate it at runtime** via the existing empty-`CLERK_SECRET_KEY` "local" mode in `kanban/src/auth/clerk-verify.ts:4` and a UI build-time flag.
- No replacement of `node-pty`. We rebuild it for the bundled Node ABI.
- No new agent runtimes; we keep the existing `pi` / Cline / codex spawn behavior.

## Success criteria

- `npm run desktop:dev` launches an Electron window that loads the local runtime end to end (project list, open a chat, agent spawns, terminal streams).
- `npm run desktop:dist` produces a notarized `Phuong-<version>-arm64.dmg` and a `Phuong-<version>-x64.dmg`.
- Fresh-install on a clean macOS user account: app launches, no Gatekeeper warning, can create a project, can start a `pi` chat, terminal renders output.
- Quitting the app reliably reaps the runtime child (no orphan node processes in Activity Monitor).

## Architecture

```
Phuong.app
├── Contents/MacOS/Phuong            (Electron main binary)
├── Contents/Resources/
│   ├── app.asar                     (Electron main + preload, packed)
│   ├── runtime/                     (kanban dist + node_modules, unpacked)
│   │   ├── cli.js                   (existing kanban entry)
│   │   ├── web-ui/                  (existing built UI)
│   │   └── node_modules/
│   │       └── node-pty/            (rebuilt for Electron Node ABI, unpacked)
│   └── bin/
│       ├── pi                       (bundled @mariozechner/pi-coding-agent launcher, optional MVP)
│       └── (git is NOT bundled — required on PATH; first-run check)
```

Process model:

- **Main process (Electron):** owns lifecycle, window, native menus, dialogs, PATH bootstrap, child-process supervision.
- **Renderer:** loads `http://127.0.0.1:<port>/<workspaceId>` from the runtime. No `nodeIntegration`, `contextIsolation: true`, sandboxed.
- **Runtime child:** the existing `kanban` Node CLI run with `--embedded` (new flag) so it prints its chosen URL on stdout and skips browser-open.

## Code change inventory

This is the complete list of code edits required for MVP. Anything not listed here is out of scope.

### New: `desktop/` workspace at repo root

A new top-level directory, sibling to `kanban/`. Contains the Electron app only.

| File | Purpose |
|---|---|
| `desktop/package.json` | Declares Electron + electron-builder devDeps, scripts (`dev`, `dist`, `rebuild`). Names app `Phuong`. |
| `desktop/electron-builder.yml` | App ID `ai.friendlabs.phuong`, mac target `dmg` (arm64 + x64), notarize config, code-sign identity, `extraResources` mapping for the kanban runtime. |
| `desktop/src/main.ts` | Electron main entry: PATH bootstrap, runtime spawn + URL discovery, window creation, lifecycle. |
| `desktop/src/runtime-child.ts` | Spawn/supervise `node runtime/cli.js --embedded --port auto`; parse the URL line from stdout; expose `start()`, `stop()`, `restart()`. |
| `desktop/src/path-bootstrap.ts` | Read `PATH` from the user's login shell once at startup so apps launched from Finder see the same `git` / `pi` / `codex` the user does in Terminal. Documented gotcha in `kanban/AGENTS.md`. |
| `desktop/src/native-menu.ts` | Standard macOS app menu (Phuong / Edit / View / Window / Help) plus "Open Project Folder…" using Electron `dialog.showOpenDialog`. |
| `desktop/src/preload.ts` | Minimal preload exposing `window.phuongDesktop = { pickDirectory, openExternal, getRuntimeUrl }`. No `require`, no Node globals leaked. |
| `desktop/src/settings-store.ts` | JSON file at `app.getPath("userData")/settings.json`. Stores: memory repo path, last project, runtime port preference. |
| `desktop/assets/icon.icns` | App icon (designed separately; placeholder OK in first build). |
| `desktop/tsconfig.json` | TS config for Electron main; `module: commonjs`, `target: es2022`. |

### Modified: `kanban/`

Five files change. Each change is small and additive — no breaking changes for the hosted (`beta.friendlabs.ai`) deployment.

| File | Change | Why |
|---|---|---|
| `kanban/src/cli.ts` | Add `--embedded` flag handled in `runMainCommand`. When set: skip `openInBrowser`, write a single line `KANBAN_RUNTIME_URL=<url>` to stdout once the server is listening, and disable the auto-update path. | Electron main parses this line to know when and where to load. |
| `kanban/src/server/directory-picker.ts` | Add an injectable transport hook so the picker can be satisfied by an external implementation. Default keeps `osascript`/`zenity`/`kdialog`/`powershell` behavior. | Lets the Electron main supply `dialog.showOpenDialog` results without spawning `osascript` from inside the runtime child. Optional in MVP if `osascript` works fine from the unsigned-helper context, but cheap insurance. |
| `kanban/web-ui/src/main.tsx` | Read `import.meta.env.VITE_DESKTOP === "1"`. When true, render the app **without** `<ClerkProvider>` and skip the Clerk-auth gate. | Single-user local app does not need Clerk. Hosted build is unchanged. |
| `kanban/web-ui/src/auth/clerk-auth-gate.tsx` | Export a no-op `LocalAuthGate` that just renders children. Wire `main.tsx` to choose between `ClerkAuthGate` and `LocalAuthGate` based on the desktop flag. | Same reason. Keeps Clerk imports tree-shakeable in the desktop bundle. |
| `kanban/web-ui/src/runtime/use-runtime-state-stream.ts`, `kanban/web-ui/src/components/top-bar.tsx` | Wrap any `useAuth()` / `useUser()` calls behind the same `VITE_DESKTOP` flag with a stub returning a fixed `{ userId: "local" }`. | These are the two other Clerk-using components found in the UI. |

No other `kanban/src/**` files are edited for MVP.

### Modified: build pipeline

| File | Change |
|---|---|
| `kanban/package.json` | Add a script `build:desktop` that runs the existing `build` and then no-ops (resources are copied by electron-builder). |
| `desktop/package.json` | `dev` runs `kanban` build in watch mode and `electron .` together (concurrently). `dist` runs `kanban` `npm run build`, then `electron-builder --mac`, then `@electron/rebuild` for `node-pty` against Electron's Node ABI. |
| Root `package.json` (new, optional) | npm workspaces wiring so `npm install` at root installs `kanban/`, `kanban/web-ui/`, and `desktop/` in one pass. Optional — can stay separate if workspaces add risk. |

## Configuration & data

- **Settings file:** `~/Library/Application Support/Phuong/settings.json`. Keys: `memoryRepoPath`, `runtimePortPreference`, `lastWorkspaceId`.
- **Memory repo:** default `~/Library/Application Support/Phuong/memory` (created on first launch as an empty git repo). The runtime already supports an external memory path via `src/memory/*`; the desktop main passes this to the runtime via env var (e.g. `PHUONG_MEMORY_REPO_PATH`). The runtime's existing memory loader needs to honor that env var — confirm during implementation; if it does not, that's a one-line addition in `kanban/src/memory/memory-loader.ts`.
- **Logs:** runtime child stdout/stderr piped to `~/Library/Logs/Phuong/runtime.log` (rotated by size, ~5MB × 3).
- **Sentry/PostHog:** **disabled** in desktop builds for MVP. Gate via `VITE_DESKTOP` (renderer) and a `PHUONG_TELEMETRY_DISABLED=1` env var the main passes to the runtime.

## Lifecycle

1. `app.whenReady()` →
2. `path-bootstrap.ts` resolves the user's shell `PATH` (spawn login shell once, capture `printenv PATH`) and merges it into `process.env.PATH` for the main process and any child it spawns.
3. First-run check: `git --version` succeeds. If not, show a blocking dialog with a link to install. (Bundling `git` is out of scope for MVP.)
4. `runtime-child.ts` spawns `node <Resources>/runtime/cli.js --embedded --port auto` with `cwd = userData`, env including `CLERK_SECRET_KEY=""`, `PHUONG_MEMORY_REPO_PATH`, `PHUONG_TELEMETRY_DISABLED=1`. Reads stdout until the `KANBAN_RUNTIME_URL=…` line appears (or 15s timeout → error dialog).
5. `BrowserWindow` opens at the runtime URL. `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload from `desktop/dist/preload.js`.
6. `app.on("before-quit")` → send SIGTERM to runtime child, wait up to 10s, then SIGKILL. The runtime already has graceful-shutdown handlers in `kanban/src/cli.ts:476`, so SIGTERM is the happy path.
7. macOS dock-icon "Quit" and `cmd+q` go through the same path. Window-close does **not** quit (standard Mac behavior); the menu's Quit item does.

## Native dependency: `node-pty`

This is the only compiled dependency and the single biggest packaging risk.

- Use `@electron/rebuild` in the `dist` script, pinned to the Electron version we ship with.
- Mark `node_modules/node-pty` as **unpacked** (`asarUnpack` in electron-builder) — `.node` binaries cannot be loaded from inside an asar archive.
- Verify by running `npm run desktop:dev` and confirming a terminal session opens with no `Module did not self-register` or `NODE_MODULE_VERSION mismatch` errors.
- Document the Electron version + Node ABI in `desktop/README.md` so future `node-pty` upgrades are deliberate.

## Code signing & notarization

- **Developer ID Application certificate** (not Mac App Store). Stored in CI keychain; locally devs use their own Developer ID.
- electron-builder config:
  - `mac.hardenedRuntime: true`
  - `mac.gatekeeperAssess: false`
  - `mac.notarize: true` (uses `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` env vars).
  - Entitlements file allowing JIT (Electron requires it), inheriting library validation off (so the rebuilt `node-pty.node` loads), and allowing `com.apple.security.cs.allow-unsigned-executable-memory`.
- Notarization runs as part of `dist`. CI publishes the `.dmg` artifact only after notarization succeeds.

## Distribution

- MVP: direct download from a static URL (S3 or `releases.friendlabs.ai`). DMG only.
- No auto-update in MVP. Add a "Check for updates" menu item that opens the download page.
- Disable the existing `kanban/src/update/auto-update.ts` startup hook in embedded mode (already covered by the `--embedded` flag's behavior in step 1 above).

## Testing plan

Manual, on a clean macOS VM (or fresh user account):

1. **Install:** mount DMG, drag to Applications, launch. Expect no Gatekeeper warning.
2. **First run:** create a project pointed at a real local git repo. Confirm the directory picker opens via the native dialog.
3. **Chat:** start a `pi` chat. Confirm the terminal renders, output streams, and `cmd+c` interrupts.
4. **Quit:** `cmd+q`, then `ps aux | grep -i phuong` and `pgrep -fl node` — expect zero leftover processes.
5. **Relaunch:** state restored, last project selected.
6. **No network on Clerk:** disable internet, launch app — should still work end to end (proves Clerk is fully bypassed).
7. **PATH-from-Finder:** install a tool only via `~/.zshrc` (e.g. via `nvm`), launch from Finder, confirm the runtime can spawn it. This is the existing tribal-knowledge gotcha called out in `kanban/AGENTS.md`.

Automated:

- Existing `kanban` and `web-ui` test suites continue to run unchanged.
- One new Playwright smoke test under `desktop/tests/` that boots the packaged app via `electron` test runner, asserts the window loads, and asserts the runtime URL responds 200.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `node-pty` fails to load after rebuild | Medium | Pin Electron version; CI smoke test that opens a terminal. |
| PATH-from-Finder misses user tools | High | `path-bootstrap.ts` runs `<user-shell> -ilc 'printenv PATH'` once at startup. Document in `kanban/AGENTS.md`. |
| Notarization fails on first attempt | High (always does) | Budget a debugging cycle for entitlements; keep CI logs verbose. |
| Memory repo path env var not honored by runtime | Low | Verify during implementation; if missing, one-line add in `kanban/src/memory/memory-loader.ts`. |
| Clerk imports leak into desktop bundle | Low | `VITE_DESKTOP` flag + tree-shake; verify with `vite build --mode desktop` bundle inspection. |
| Hosted deployment regresses from `--embedded` flag addition | Low | Flag is opt-in and defaults to current behavior. Hosted build never passes it. |

## Files touched (final count)

- New: 9 files under `desktop/` + 1 icon asset.
- Modified: 5 files in `kanban/` (`src/cli.ts`, `src/server/directory-picker.ts`, `web-ui/src/main.tsx`, `web-ui/src/auth/clerk-auth-gate.tsx`, plus the two Clerk-consuming UI files behind a flag).
- Modified: 2 `package.json` files (script additions, no dependency changes inside `kanban/`).
- Possibly modified: 1 file in `kanban/src/memory/memory-loader.ts` (only if env var support is missing).

No changes to tRPC routers, Phuong manager logic, agent adapters, terminal session manager, or workspace registry.

## Execution order

1. Stand up `desktop/` skeleton with a hello-world Electron window. Verify dev/dist scaffolding works before touching kanban.
2. Add `--embedded` flag to `kanban/src/cli.ts` and verify by running it manually outside Electron.
3. Wire `runtime-child.ts` to spawn the embedded CLI and parse the URL line. Load that URL in the Electron window. End-to-end smoke locally.
4. Add `VITE_DESKTOP` flag and the local-auth path in the UI. Confirm app loads with no Clerk env vars set.
5. PATH bootstrap + native menu + native open-folder dialog.
6. `@electron/rebuild` for `node-pty` and verify a terminal session works.
7. electron-builder DMG build (unsigned) on a dev machine.
8. Code signing + notarization wiring; first signed DMG.
9. Manual test pass per the checklist above. Fix what breaks.
10. Document install and known issues in `desktop/README.md`.

## What we are explicitly deferring

- Tray / menu-bar mode.
- In-app auto-updater (Squirrel.Mac).
- Windows and Linux builds.
- Bundling `git` and `pi` inside the app (rely on PATH for MVP; revisit if first-run friction is real).
- Telemetry opt-in flow.
- Multi-account / multi-workspace switcher beyond what the existing UI already provides.
- App Store distribution and the sandboxing rework that would require.
