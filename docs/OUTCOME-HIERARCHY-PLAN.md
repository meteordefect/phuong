# Outcome Hierarchy Plan

Replace leftover Kanban structure with the product we actually want: project tabs, feature outcomes, nested pi subagents, and a database-backed action trail.

This is the product/architecture plan. Visual language (Crush-inspired cards, palette, density) lives in `docs/CRUSH-VISUAL-STEAL-PLAN.md`. Execution order for both is `docs/OUTCOME-CRUSH-RUNSHEET.md`.

Crush is **not** part of this product. Workers stay **pi**. The dashboard does not embed a Charm TUI.

## Objective

End state:

- Small project tabs at the top, not a heavy left project tree as the primary nav.
- Under a project, work is grouped as **outcomes** (a feature or result), not as a flat list of chats.
- Each outcome can spawn multiple **pi subagent runs**.
- The database is the source of truth for projects, outcomes, runs, conversations, and the action trail.
- The GUI is a projection of that tree. Phuong and Dashboard read the same records.
- A live PTY is optional debug, not the historical record.

## Locked decisions

- Keep **pi** as the worker and as Phuong’s in-process SDK. Do not convert the stack to Crush.
- Keep worktrees, Clerk, model tiers `T0`–`T3`, gates, artifacts, and the external memory repo.
- Kill board columns as a product concept (`backlog` / `in_progress` / `review` / `trash` as the user’s model).
- One chat is no longer one feature. An **outcome** is the feature. **Runs** are children.
- SQLite on the VPS is enough for single-user v1. Postgres is a later multi-user move.
- The runtime is the only writer of execution state. The GUI inserts intent (new outcome / spawn run). It does not mark a run `running` by itself.
- Memory repo stays durable knowledge (context, decisions, learnings). The DB is operational truth (what was asked, which runs fired, tools, STATUS, artifacts).
- Watch-only workers stay the default. Interject remains an explicit unlock.

## Current state (what we are leaving)

Today the UI already hides the board, but the runtime is still Kanban:

| User-facing idea | Actual storage |
|---|---|
| Project | Git workspace in `~/.cline/kanban/workspaces/` + `index.json` |
| Chat | Card in `board.json`, usually in `backlog` |
| Chat status | Fake column + `sessions.json` PTY summary |
| Live work | PTY byte stream in the browser |
| Phuong history | JSONL under the memory repo / `.phuong-sessions` |
| Artifacts | Files hung off the card |

There is no parent “this feature spawned these three workers.” `create_chat` dumps sibling cards into the project.

Key files that still encode the old model:

- `kanban/src/core/api-contract.ts` — `RuntimeBoardCard`, columns, dependencies
- `kanban/src/state/workspace-state.ts` — `board.json` / `sessions.json` / `meta.json`
- `kanban/src/core/task-board-mutations.ts` — column moves and card links
- `kanban/src/manager/phuong-tools.ts` — `create_chat` / `list_chats` / `start_chat`
- `kanban/web-ui/src/components/project-navigation-panel.tsx` — left project + chat list
- `kanban/web-ui/src/App.tsx` — `HomeMainView` locked to `"chats"`, board still in memory

## Target domain model

```text
projects
  └── outcomes                         -- one feature / one result
        ├── agent_runs                 -- each pi (or later optional CLI) subagent
        │     └── events               -- the trail
        └── events                     -- Phuong plan, gates, reports on the outcome
```

### Tables (v1 SQLite)

**projects**

- `id`, `name`, `repo_path`, `created_at`, `updated_at`
- Maps 1:1 to an existing Kanban workspace / git checkout for v1.

**outcomes**

- `id`, `project_id`, `title`, `description` (feature/result spec)
- `status`: `open` | `in_progress` | `verifying` | `done` | `blocked` | `parked`
- `created_at`, `updated_at`
- Description is the contract: objective, in-scope/out-of-scope, done-criteria. Same spirit as today’s `create_chat` prompt contract, but one level up.

**agent_runs**

- `id`, `outcome_id`, `role`: `worker` | `verifier` | `gate`
- `agent`: `pi` (only supported worker in v1)
- `tier` (`T0`–`T3`), `model`, `prompt`
- `worktree_path`, `pi_session_path` (nullable)
- `status`: `queued` | `running` | `done` | `failed` | `blocked` | `needs_context`
- `reported_status` (`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`)
- `created_at`, `started_at`, `ended_at`

**events**

Append-only. This is the trail the GUI renders.

- `id`, `project_id`, `outcome_id`, `run_id` (nullable — null means outcome-level / Phuong)
- `kind`: `user_message` | `assistant_message` | `tool_call` | `tool_result` | `status` | `gate` | `artifact` | `file_change` | `spawn` | `system`
- `payload` JSON
- `created_at`

**artifacts** (optional split table, or `kind=artifact` events with a file path)

Keep current attach-artifact behavior; store a row plus the file on disk under the worktree / `.phuong/artifacts/`.

### Status vs Kanban columns

| Old column | New home |
|---|---|
| backlog | outcome `open` or run `queued` |
| in_progress | outcome `in_progress`, run `running` |
| review | outcome `verifying` |
| trash | `parked` or hard delete later; do not keep a trash column in the UI |

Board dependencies can wait. Outcome-level sequencing is enough for v1 (Phuong dispatches runs when ready). Revisit explicit run-to-run waits only if parallel work needs it.

## UX

```text
┌─────────────────────────────────────────────────────────────┐
│  [Proj A] [Proj B] [+]                          settings    │  ← small tabs
├─────────────────────────────────────────────────────────────┤
│  Outcome: Ship login                                        │
│  Description of the feature / result                        │
│                                                             │
│  Trail (Crush-styled cards — see visual plan)               │
│    Phuong: plan + routing table                             │
│    spawn  worker-1  (pi T1)                                 │
│    tool   edit src/auth.ts                                  │
│    status DONE                                              │
│    spawn  verifier (pi T2)                                  │
│    gate   npm test  exit 0                                  │
│    artifact  login.png                                      │
│                                                             │
│  Nested runs list (optional right/lower rail)               │
│    worker-1 running · verifier queued                       │
└─────────────────────────────────────────────────────────────┘
```

Phuong remains the default home for *talking*. Opening an outcome on the Dashboard is watch-only: you see the trail. Interject still unlocks a worker input if needed.

Live PTY: a disclosure / debug pane on a run, not the center of the product.

Layout order is a Phase 5 implementation decision (`docs/OUTCOME-CRUSH-RUNSHEET.md` §5.0b). Do not keep the Cline leftover stack. Starting order: tabs → Phuong (talk) or outcome header + trail (watch) → run chips → overflow → PTY last. Tune when we build the shell.

## Runtime vs database

The DB stores **intent and history**. One runtime actor executes.

1. GUI or Phuong inserts an `outcomes` row (and optionally `agent_runs` with `queued`).
2. Runtime watches queued runs (or is called synchronously from Phuong tools, same as today’s `startTask`).
3. Runtime creates the worktree, starts pi, writes `running`, appends `spawn` / tool / message events.
4. On `STATUS:` or process exit, runtime writes run status and outcome rollup.
5. GUI subscribes (websocket / tRPC stream) and re-renders the trail.

Do not let the browser set `running`. Do not let pi write SQLite directly. Adapters emit structured events into a small runtime sink.

## Phuong tools (target)

Keep the orchestration protocol in `docs/PHUONG-ORCHESTRATE-ADOPTION-PLAN.md`. Change the nouns.

| Today | Target |
|---|---|
| `create_chat` | `create_outcome` (spec only) and/or `spawn_run` under an outcome |
| `list_chats` | `list_outcomes` + `list_runs` |
| `start_chat` | `start_run` / resume |
| `check_chat_status` | `check_run` + outcome rollup |
| `run_gate` / `attach_artifact` | same, but keyed by `outcome_id` / `run_id` |

Trivial work can still be one outcome with one run. Multi-unit work: one outcome, many runs, routing table announced first.

Phuong session events from `kanban/src/manager/phuong-session.ts` append to `events` with `run_id` null.

## Worker events (keep pi)

PTY ANSI is not the trail.

v1 path:

1. Keep launching pi in a worktree (existing adapter + hooks).
2. Additionally ingest structured events:
   - Prefer pi RPC / SDK stream if we can attach without rewriting the worker.
   - Fallback: tail/parse pi session JSONL (`@mariozechner/pi-coding-agent` `parseSessionEntries`, already used in `kanban/src/manager/session-history.ts`).
3. Map to `events.kind` (`assistant_message`, `tool_call`, `tool_result`, `status`).
4. Keep PTY streaming for the optional live pane.

Existing Kanban hooks (`to_review`, `to_in_progress`, `activity`) become DB status writes, not column moves.

## Insertion points

New (justified): a small persistence module, e.g. `kanban/src/ledger/` (SQLite schema, queries, event append). Do not spread SQL through tRPC handlers.

Reuse / reshape:

| File | Why |
|---|---|
| `kanban/src/core/api-contract.ts` | Add outcome/run/event types; stop treating board columns as the public model |
| `kanban/src/state/workspace-state.ts` | Stop being source of truth; become a migrator from `board.json` then shrink |
| `kanban/src/manager/phuong-tools.ts` | Outcome/run tools |
| `kanban/src/manager/phuong-session.ts` | Append Phuong SDK events to ledger |
| `kanban/src/terminal/agent-session-adapters.ts` | Keep pi launch; hook DB status instead of columns |
| `kanban/src/terminal/session-manager.ts` | Start/stop still process-oriented; notify ledger |
| `kanban/src/trpc/runtime-api.ts` | Outcome/run/event procedures + stream |
| `kanban/src/server/runtime-state-hub.ts` | Broadcast ledger changes, not only board/session JSON |
| `kanban/web-ui/src/App.tsx` | Tab shell + outcome main view |
| `kanban/web-ui/src/components/top-bar.tsx` | Host project tabs (shrink current chrome) |
| `kanban/web-ui/src/components/project-navigation-panel.tsx` | Demote or replace; chats become runs under an outcome |
| `kanban/web-ui/src/hooks/use-project-agent-chats.ts` | Replace with outcome/run queries |

Do not add Crush to `agent-catalog.ts` as part of this plan.

## Migration

1. On first boot with ledger enabled, import each workspace as a `projects` row.
2. Each existing board card becomes an **outcome** with a **single child run** (lossy but honest: we never had a parent feature).
3. Keep `board.json` read-only until a successful import, then stop writing it.
4. Do not try to reconstruct a full tool trail from old PTY logs.

## Out of scope

- Replacing pi with Crush (see visual plan: Crush is a mood board).
- Multi-user Postgres.
- Nested agents beyond one outcome → many runs.
- Recreating Kanban drag-and-drop or a board view.
- Making the browser the source of truth.

## Risks

- If we restyle the UI before the ledger, we will fake hierarchy in React and paint ourselves into another `board.json`. Domain model first, then chrome.
- If we keep PTY as the record, the Crush-like trail will be a terminal dump with makeup. Structured events are required for the visual plan to mean anything.
- Dual-write (`board.json` + SQLite) must be short-lived.

## Relationship to other docs

- `docs/PHUONG-CONDUIT.md` — still true: Phuong is the talk entry, Dashboard is the ledger. Dashboard’s grouping becomes project → outcome → runs.
- `docs/PHUONG-ORCHESTRATE-ADOPTION-PLAN.md` — protocol stays; nouns change from chat to outcome/run.
- `docs/KANBAN-FULL-BUILD-PLAN.md` — historical; this document supersedes the “projects-and-chats / board internally” product shape.
- `docs/CRUSH-VISUAL-STEAL-PLAN.md` — how the trail should look.
- `docs/OUTCOME-CRUSH-RUNSHEET.md` — what to build in order.
