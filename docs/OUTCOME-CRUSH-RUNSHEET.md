# Outcome + Crush Visual Runsheet

Execute `docs/OUTCOME-HIERARCHY-PLAN.md` and `docs/CRUSH-VISUAL-STEAL-PLAN.md` in this order. Do not skip phases. Each phase is a working checkpoint.

Crush is never installed as a dependency of this work.

Related historical runsheet: `docs/BUILD-RUNSHEET.md` (Phases 1–7). This document is the next execution track.

## Locked: keep the runtime, replace the Cline UI

We already own a fork of `cline/kanban`. The product UI is still Cline-shaped (board nouns in `App.tsx`, Cline chat/settings/onboarding, leftover telemetry). The execution engine is ours to keep.

Do **not** start a second Vite app or rewrite worktrees / PTY / tRPC / session-manager / Clerk. Phase 5 is the cutover: same `kanban/web-ui`, same auth, same runtime API — our shell and trail on top of the ledger.

Do **not** start Phase 5 before the Phase 3 checkpoint (inspectable `events` rows from Phuong and a pi run). Prefer after Phase 4 so the shell binds to outcomes/runs, not `BoardData`.

“Secure frontend” here means: Clerk stays the only browser auth, Bearer on every tRPC call, watch-only default, scrubbed trail payloads, no Cline PostHog/Featurebase, no new unauthenticated surface.

---

## Phase 0: Plans locked

This phase is the docs only.

- [x] `docs/OUTCOME-HIERARCHY-PLAN.md`
- [x] `docs/CRUSH-VISUAL-STEAL-PLAN.md`
- [x] `docs/OUTCOME-CRUSH-RUNSHEET.md`
- [x] Index in root `README.md`

**Checkpoint:** Plans are in git. No product behavior change.

---

## Phase 1: Charmtone-inspired tokens (visual only)

Safe to do before the ledger. Do not build trail cards yet.

### 1.1 Remap CSS tokens

File: `kanban/web-ui/src/styles/globals.css`

- [x] Shift surfaces toward warm dark (Pepper/BBQ/Char/Iron vibe). Keep token names (`surface-0`, `accent`, …). Tune accent so it still reads as Phuong (current orange is allowed if contrast holds).

### 1.2 Match terminal selection

File: `kanban/web-ui/src/terminal/theme-colors.ts`

- [x] Same background / selection as the new surfaces.

### 1.3 Update token docs

File: `kanban/AGENTS.md` (design tokens section)

- [x] Replace GitHub-blue examples if they still appear. New hex values must match `globals.css`.

### 1.4 Verify

- [x] App boots, no visual regressions that hide text (contrast on tabs, buttons, Phuong panel).
- [x] Existing sidebar/PTY still work; they just sit on warmer surfaces.

**Checkpoint:** Token PR. No new components.

> **Done** — `9341527`. Warm Pepper/BBQ/Char-inspired surfaces, parchment text, Phuong orange accent kept. Vite + runtime boot; sidebar, Phuong panel, and bottom PTY readable. No new components. Hex in `globals.css` / `theme-colors.ts` / `AGENTS.md` match.

---

## Phase 2: Ledger schema and API (no UI redesign)

### 2.1 Add SQLite module

- [x] New: `kanban/src/ledger/` (schema, migrations, queries, `appendEvent`).
- [x] Tables: `projects`, `outcomes`, `agent_runs`, `events` as specified in the hierarchy plan.
- [x] Single-user file location: under the existing runtime home (e.g. `~/.cline/kanban/ledger.sqlite`), not inside a git repo.

### 2.2 Import existing workspaces

On boot or first ledger open:

- [x] Each Kanban workspace → `projects` row
- [x] Each board card → one `outcomes` row + one `agent_runs` row
- [x] Do not invent a tool trail from old PTY logs

Keep writing `board.json` until Phase 2.4 so current UI still works.

### 2.3 tRPC read path

Files: `kanban/src/trpc/runtime-api.ts` or a new `ledger-api.ts` wired in `app-router.ts` / `runtime-server.ts`.

- [x] `listProjects` (can wrap existing)
- [x] `listOutcomes(projectId)`
- [x] `listRuns(outcomeId)`
- [x] `listEvents(outcomeId)`

### 2.4 Dual-write from task create/start

When today’s `create_chat` / `addTaskToColumn` / `startTask` fire, also insert outcome + run rows and a `spawn` event if a process starts.

- [x] `kanban/src/manager/phuong-tools.ts`
- [x] `kanban/src/state/workspace-state.ts` or the runtime API that mutates the board
- [x] `kanban/src/terminal/session-manager.ts`

### 2.5 Verify

- [x] Create a chat via Phuong or Dashboard.
- [x] SQLite has project, outcome, run.
- [x] Old UI still functions (still board-backed).

**Checkpoint:** Ledger exists and dual-writes. UI unchanged except tokens from Phase 1.

> **Done** — `4d0c584`. `kanban/src/ledger/` at `~/.cline/kanban/ledger.sqlite`. Boot import + tRPC `ledger.list*`. Dual-write from board mutations / `create_chat`; `spawn` only when `session-manager` starts a process. board.json still written. 34 tests + scripted create-chat verify (project/outcome/queued run; no invented events).

---

## Phase 3: Structured events into the trail

Without this, Phase 5 is makeup on a terminal.

### 3.1 Phuong events

File: `kanban/src/manager/phuong-session.ts`

- [x] On SDK session events, `appendEvent` with `run_id` null, `kind` message/tool/system as appropriate. Scrub credentials (existing `credential-scrubber.ts`).

### 3.2 Pi worker events

Prefer, in order:

1. pi RPC / JSON stream if we can subscribe without dropping the PTY
2. Parse session JSONL with `parseSessionEntries` (already used in `session-history.ts`)
3. Last resort: status hooks only (`agent_start` / `agent_end` / `STATUS:`) — better than nothing, not enough for tool cards

File: `kanban/src/terminal/agent-session-adapters.ts` plus a small ingest helper under `kanban/src/ledger/` or `kanban/src/manager/`.

Map `STATUS:` (`task-status-protocol.ts`) to run `reported_status` and a `status` event.

- [x] Path 1: keep the PTY. Enrich the existing pi ExtensionAPI hook (`tool_execution_start` / `tool_result` / `agent_end`) and ingest via `hooks.ingest`. Do not switch the worker to `--mode json` / `--mode rpc`.
- [x] Path 2: `mapPiSessionEntriesToLedger` + `ingestPiSessionJsonl` for catch-up from session JSONL.
- [x] `STATUS:` → `agent_runs.reported_status` + `status` event (`kanban/src/ledger/pi-ingest.ts`).

> **Done (3.2)** — Live ingest is the in-process pi extension (PTY stays). JSONL mapper is available for catch-up. `STATUS:` writes `reported_status` + a `status` event keyed by `run_id`.

### 3.3 Gates and artifacts

`run_gate` / `attach_artifact` write `gate` / `artifact` events keyed by `run_id` / `outcome_id`.

- [x] `recordGateEvent` / `recordArtifactEvent` in `kanban/src/ledger/sync.ts` (append + scrub).
- [x] `run_gate` / `attach_artifact` in `phuong-api.ts` write those events after a completed gate or attach.

### 3.4 Live stream

File: `kanban/src/server/runtime-state-hub.ts`

Broadcast new events so the client can append without polling.

- [x] `appendEvent` notifies `onLedgerEventAppended`.
- [x] Hub batches and broadcasts `ledger_events_appended`.
- [x] Client stream hook appends by `outcome_id` (no trail cards).

### 3.5 Verify

- [x] One Phuong turn + one pi run produces inspectable `events` rows (messages and at least spawn/status).
- [x] Tool calls appear as rows when ingest path 1 or 2 works.

**Checkpoint:** The database has a real trail. GUI still old.

> **Done (3.3–3.5)** — `run_gate` / `attach_artifact` append scrubbed `gate` / `artifact` events keyed by `run_id` + `outcome_id`. Hub broadcasts `ledger_events_appended` from `appendEvent`. Client stream can append without polling. Tests: Phuong turn (`run_id` null) + pi run (spawn / tool / status) + gate / artifact. No trail UI.

---

## Phase 4: Outcome is the unit (runtime nouns)

### 4.1 API contract

File: `kanban/src/core/api-contract.ts`

- [x] Add outcome/run/event types. Stop adding fields to `RuntimeBoardCard` for product features.

### 4.2 Phuong tools

File: `kanban/src/manager/phuong-tools.ts` and `phuong-context.ts`

- [x] `create_outcome` / `spawn_run` (keep `create_chat` as a compatibility alias that creates outcome+run for one release)
- [x] `list_outcomes` / `list_runs`
- [x] Prompt contract stays on the **outcome** description; run prompt is the unit slice

### 4.3 Status without columns

Kanban hooks that move cards between columns should instead update `outcomes.status` / `agent_runs.status`.

File: `kanban/src/terminal/agent-session-adapters.ts`, hook notify path.

- [x] `to_in_progress` / `to_review` write `agent_runs.status` + `outcomes.status`. Run lookup uses `run.outcomeId` (split nouns). Board column moves stay compatibility-only.

### 4.4 Verify

- [x] Multi-unit Phuong request creates one outcome and N runs.
- [x] `list_chats` still works via alias or is removed after UI cutover.

**Checkpoint:** Domain matches the hierarchy plan. Board JSON is compatibility only.

> **Done (4.1–4.4)** — `RuntimeOutcome` / `RuntimeAgentRun` / event kinds in `api-contract.ts`. `create_outcome` + `spawn_run` + `list_outcomes` / `list_runs`; `create_chat` / `list_chats` stay as one-release aliases. Prompt contract is on the outcome description; run prompt is the unit slice. Hook `to_in_progress` / `to_review` write ledger status via `run.outcomeId` (no sibling outcome). Tests: one outcome + N runs, `list_chats` alias, hook status without columns. No Phase 5 UI.

---

## Phase 5: Own frontend (Cline chrome off) + trail

Depends on Phase 1 tokens and Phase 3 events. Prefer Phase 4 nouns first.

This is the step that ditches Cline Kanban as the product UI. It is not a new app.

### 5.0 Own the shell

- [x] Same `kanban/web-ui`. Same Clerk gate (`main.tsx`) and session token on tRPC.

- [x] Keep on the product path:

- Clerk + Bearer tRPC
- Phuong panel
- Phase 1 tokens
- Watch-only + Interject
- Optional PTY disclosure
- Ledger `list*` + live hub

- [x] Remove from the product path (do not ship as primary UI):

- Cline agent chat panel / composer / model picker / MCP settings
- Cline onboarding carousel, `cline-setup-section`, `cline-icon`
- Featurebase widget
- PostHog / Cline leftover telemetry (disable or delete; do not send our events to a Cline project)
- `BoardData` as the main `App.tsx` view model (board stays compatibility-only until Phase 6)

Do not add a second origin that talks to the runtime without Clerk.

### 5.0b Layout order (tune when we get there)

- [x] Do not keep the Cline leftover stack (left project tree → fat top bar → PTY as hero → Phuong as a side thought). Reorder at implementation. Starting order, changeable in this phase:

**Talk home (Phuong default)**

1. Project tabs (top, small)
2. Phuong composer + her trail
3. Overflow for settings / git / debug
4. No PTY unless the user opens it

**Watch (outcome selected)**

1. Project tabs
2. Outcome header (title + status)
3. Trail (main)
4. Nested run chips (not a second chat sidebar)
5. Phuong still reachable (compact, not a second product)
6. PTY last — disclosure on a run

Phone-width follows the same order: tabs → header/composer → trail → overflow. No columns.

### 5.1 Trail components

- [x] New: `kanban/web-ui/src/components/trail/`
- [x] Implement the card map in the visual plan. Data from `listEvents` + live hub.

### 5.2 Project tabs and outcome header

- [x] `kanban/web-ui/src/components/top-bar.tsx` — small project tabs
- [x] `kanban/web-ui/src/App.tsx` — main view is selected outcome + trail
- [x] Retire `project-navigation-panel.tsx` as the primary nav (keep a compact outcome/run list if needed)

### 5.3 Phuong panel

- [x] `kanban/web-ui/src/components/phuong/phuong-chat-panel.tsx` — same tokens and card density. Watch-only banner unchanged. Compact variant on watch.

### 5.4 Demote PTY

- [x] Optional disclosure on a run (“live terminal”). Default view is the trail.

### 5.5 Verify

- [x] Opening an outcome shows a Crush-like stream from DB events.
- [x] Tool cards, spawn rows, status pills visible on a real run.
- [x] No Crush/Charm branding.
- [x] Interject still unlocks worker input.
- [x] Phone-width: tabs + trail usable (scroll, no kanban columns).

**Checkpoint:** This is the user-visible product cutover. The browser app is Phuong’s, not Cline Kanban’s.

> **Done (5.0–5.5)** — Same `kanban/web-ui` + Clerk. Product view is Talk home (project tabs → Phuong) or Watch (header → trail from `listEvents` + hub → run chips → compact Phuong → PTY disclosure). Left project tree, Cline chat/onboarding/setup, Featurebase, and PostHog are off the product path. `BoardData` stays compatibility-only. No Phase 6.

---

## Phase 6: Stop writing the board

### 6.1 Reads from ledger only

Workspace UI and Phuong tools no longer require `board.json` for listing or status.

- [x] Product paths: `list_outcomes` / `list_runs` / `listEvents`, Talk/Watch, `spawn_run` start, `list_chats` alias.
- [x] `startTask` / `run_gate` / `attach_artifact` / `list_artifacts` resolve the run from the ledger (`run_id`), not a board card.

### 6.2 Stop column mutations

File: `kanban/src/core/task-board-mutations.ts` — unused by product paths (may remain for tests until deleted).

- [x] `spawn_run` / `create_chat` / `startTask` do not write or move board columns.
- [x] Hook `to_in_progress` / `to_review` already write ledger status — App no longer syncs session state into columns.

### 6.3 Verify

- [x] Fresh project: no dependence on board columns for a full outcome → runs → trail loop.
- [x] Restart process: outcomes, runs, events reload from SQLite.

**Checkpoint:** Kanban board is leftover code, not the source of truth.

> **Done (6.1–6.3)** — Product listing/status and `spawn_run` start read the ledger. `startTask` keys worktree / PTY by `run_id` with `baseRef=HEAD`. No product-path column mutations. `task-board-mutations.ts` remains for leftover board tests until Phase 7. Restart reloads outcomes / runs / events from SQLite.

---

## Phase 7: Cleanup (only after Phase 6 is stable)

- [x] Remove unused board UI from the product bundle: `kanban-board.tsx`, `board-card.tsx`, drag-and-drop, `TaskCreateDialog` / `useTaskEditor`, and column-only `use-board-interactions` wiring. Talk/Watch unchanged.
- [x] Drop `create_chat` / `list_chats` aliases. Phuong prompt uses `create_outcome` + `spawn_run` + `list_outcomes` + `list_runs`.
- [x] Do **not** add Crush to `agent-catalog.ts`.
- [x] Snapshot `board.json` importer test with `kanban/test/fixtures/board-import/board.json`.
- Leftover CLI / shutdown trash moves may still touch `board.json`. `task-board-mutations.ts` stays for those leftover paths.

**Checkpoint:** Board UI is gone from the product bundle. Ledger is the listing/status SoT. Kanban runtime (worktrees, PTY, tRPC, session-manager, Clerk) unchanged.

> **Done (7)** — Unused board canvas / create-task / column-interaction files deleted from `kanban/web-ui`. Phuong tools no longer expose `create_chat` / `list_chats`. Importer fixture covers leftover `board.json`. No Crush in `agent-catalog.ts`.

---

## Explicit non-goals (do not sneak into a phase)

- Installing or spawning Crush
- Postgres / multi-user
- Pixel-perfect Charmtone hex from Crush source
- Recreating Bubble Tea layouts in the browser
- Making PTY parse the primary trail
- A second frontend / new Vite app
- Replacing worktrees, PTY, tRPC, session-manager, or Clerk
- Starting the UI cutover before Phase 3 events exist
- Custom auth rewrite in the same slice as the trail

---

## Suggested PR slices

| PR | Phases | Notes |
|---|---|---|
| Docs | 0 | This change |
| Tokens | 1 | Visual, low risk |
| Ledger dual-write | 2 | Backend |
| Event ingest | 3 | Backend |
| Nouns | 4 | Phuong tools + contract |
| Cutover UI | 5 | Own shell (Cline chrome off) + tabs + trail |
| Board off | 6–7 | Delete SoT, then dead UI |

Do not combine Phase 5 with Phase 2. The trail must read real events.

---

## After this runsheet

- Memory write-back (old Phase 7 in `docs/BUILD-RUNSHEET.md`) still applies, keyed by `outcome_id`.
- Orchestration Phase B (verifier role) from `docs/PHUONG-ORCHESTRATE-ADOPTION-PLAN.md` becomes a `agent_runs.role = verifier` row, not a special chat type.
