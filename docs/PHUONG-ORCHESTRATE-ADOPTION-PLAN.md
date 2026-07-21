# Phuong Orchestration Adoption Plan

Adapt useful ideas from [claude-orchestrate](https://github.com/midego1/claude-orchestrate) into Phuong + Pi. **Do not install the Claude Code plugin.** Strip Claude harness assumptions (plugin marketplace, `/orchestrate` skill, Anthropic-only haiku/sonnet/opus/fable routing, `.claude/orchestrate-runs/`, Claude `Agent` tool / SendMessage resume). Keep the portable protocol ideas only.

Source of truth for ideas: the repo’s portable protocol (`portable/orchestrator.md`), rewritten for our runtime.

## Goal

Make Phuong a disciplined orchestrator over Pi chats:

1. Decompose substantive work into units with machine-checkable done-criteria.
2. Dispatch each unit as a Pi chat in an isolated worktree (already how Kanban works).
3. Verify with evidence before trusting `STATUS: DONE`.
4. Triage failures (spec / environment / capability) under a hard retry budget.
5. Integrate and report what shipped vs what is parked.

Trivial turns stay direct: single-chat fixes and conversational questions skip the protocol.

## Role mapping (Claude stripped)

| Orchestrate concept | Phuong / Pi equivalent | Notes |
|---|---|---|
| Orchestrator | **Phuong** | Plans, routes, synthesizes. Does not implement code. |
| Foreman | **Phuong (same session)** for v1 | No separate foreman agent yet. Phuong owns the dispatch loop via tools. |
| Worker | **Pi chat** (`create_chat` → worktree + PTY) | One unit ≈ one chat. |
| Verifier | **Verifier Pi chat** or **Gate 1 tool** | Evidence required; never trust worker self-report alone. |
| Run archive | **Project memory + run folder under memory repo** | Not `.claude/`. Prefer `/data/phuong-memory/...` or a Phuong-owned runtime path. |
| Checkpoint | **`checkpoint.json` per orchestration run** | Written by Phuong tools / manager service, not by Claude harness. |
| Model tiers T0–T3 | **Capability tiers mapped to available providers** | Today Pi is mostly GLM-5 via ZAI. Tiering starts as depth/spec strictness; model routing is Phase B only if we can pass per-chat model. |

## Take vs skip

### Take (high value)

| Element | Why it fits | First insertion point |
|---|---|---|
| Scope gate (orchestrate only substantive work) | Avoids overhead on trivial chats | `kanban/src/manager/phuong-context.ts` system prompt |
| Decompose → announce routing table → dispatch | Makes Phuong plans inspectable before spend | Same prompt + optional `propose_plan` tool |
| Unit dispatch contract (objective, context, done-criteria, output format) | Improves Pi success rate; enables gates | `create_chat` prompt assembly in `phuong-tools.ts` |
| Gate 1 — mechanical checks | Free evidence: test / lint / build / grep invariant | New Phuong tool e.g. `run_gate` wrapping workspace commands |
| Gate 2 — evidence-gated review | Catches “looks done” lies | Second chat with verifier prompt, or Phuong-invoked review chat |
| Failure triage: spec / env / capability | Aligns with existing `NEEDS_CONTEXT` / `BLOCKED` | Extend routing rules in `phuong-context.ts` |
| Hard retry budget (max 3 dispatches per unit) | Stops silent retry loops | Prompt rules first; later enforce in manager state |
| Ship gate (integrated review before “done”) | Catches cross-chat breakage | Phuong final pass after all units `DONE` |
| Checkpoint + dispatch log | Crash recovery for multi-chat plans | New manager module + memory/runtime storage |
| Status markers already in Pi | Keep / strengthen; do not replace | `kanban/src/prompts/append-system-prompt.ts` + `task-status-protocol.ts` |

### Skip / defer (Claude-specific or premature)

| Element | Why skip now |
|---|---|
| Claude Code plugin / marketplace / `/orchestrate` skill | Wrong runtime |
| Anthropic model names as hard requirements | We run Pi + ZAI/GLM (and whatever Phuong’s model is) |
| Separate Opus “foreman” sub-agent | Extra agent surface; Phuong can own the loop until volume forces a split |
| Claude Task worktree / SendMessage resume semantics | Kanban already isolates worktrees; resume is `start_chat` + session state |
| Nested background-agent notification routing rules | Not our harness |
| Full escalation ladder across model families | No per-chat model API yet |
| Ultracode / xhigh / Claude effort menu | Not portable; use prompt depth guidance instead |
| Shipping as a third-party plugin | This stays product logic inside Phuong |

## Prerequisites (before this upgrade)

Finish remaining Phase 6.4 items from `docs/BUILD-RUNSHEET.md` if not already solid:

- Phuong tools create/start chats reliably (`create_chat`, `list_chats`, `start_chat`, `check_chat_status`)
- Memory context assembly (system prompt → overview → project context)
- Status parsing from Pi final messages (`STATUS:` / `REASON:`)

This upgrade assumes those exist and builds protocol discipline on top.

## Phased upgrade

### Phase A — Protocol in Phuong (prompt + prompt contract)

**Objective:** Phuong behaves like an orchestrator without new infrastructure.

**Touch:**

1. `kanban/src/manager/phuong-context.ts` — replace/extend `PHUONG_SYSTEM_PROMPT` with stripped protocol:
   - Scope gate
   - Decompose + routing table format (unit / tier / done-criteria / verifier / dispatches)
   - Do not implement; only `create_chat`
   - After `DONE`, require Gate 1 (or ask user) before declaring success
   - Triage rules mapped to existing statuses
   - Retry budget: original → one same-tier rewrite → one escalate/decompose → surface
2. Optional mirror in external memory `system-prompt.md` (base-control) so production Phuong loads the same rules via `assemblePhuongSystemPrompt()`
3. `kanban/src/manager/phuong-tools.ts` — enrich `create_chat` description so prompts must include:
   - Objective
   - In-scope / out-of-scope
   - Done-criteria (preferably commands or grep checks)
   - Files/subsystems touched
   - Required final `STATUS` marker (already enforced by append prompt)

**Acceptance:**

- Ask Phuong for a multi-file feature → it announces a unit table before creating chats
- Trivial ask → no table, at most one chat or direct answer
- Each created chat prompt contains done-criteria

**Out of scope for A:** new tools, checkpoint files, model routing.

---

### Phase B — Gates and triage tools

**Objective:** Evidence becomes tool-backed, not prompt-only.

**Touch:**

1. Extend `BoardOperations` + `phuong-tools.ts`:
   - `run_gate` — run configured Gate 1 commands in a chat’s worktree (or project cwd); return exit code + truncated output reference
   - `create_verifier_chat` (or `create_chat` with `role: "verifier"`) — Pi chat whose only job is PASS/FAIL per criterion with cited evidence
2. Extend `phuong-context.ts` routing:
   - `DONE` without Gate 1 pass → not shippable
   - `DONE_WITH_CONCERNS` → triage; may spawn verifier or rewrite
   - `NEEDS_CONTEXT` → answer in-place / resume; do not new-chat same unit
   - `BLOCKED` → classify spec vs env vs capability; apply retry budget
3. Optionally extend `task-status-protocol.ts` / append prompt so workers can emit evidence refs (e.g. `EVIDENCE: <path or command summary>`) — keep STATUS enum stable

**Acceptance:**

- Phuong can refuse to call a unit done when Gate 1 fails
- Verifier chats return per-criterion PASS/FAIL with citations
- Same prompt is not silently retried more than budget allows (prompt-enforced; soft OK)

**Model note:** If/when Kanban can pass a model per chat start, map:

| Tier | Meaning | Suggested mapping (example) |
|---|---|---|
| T0 | Mechanical | cheapest/fastest available |
| T1 | Standard | current Pi default (GLM-5) |
| T2 | Complex | strongest available worker |
| T3 | Frontier | Phuong’s own model / rare |

Until then, tiers are **depth labels in the dispatch prompt only**.

---

### Phase C — Run state (checkpoint + archive)

**Objective:** Multi-chat plans survive Phuong session restarts.

**Touch:**

1. New module e.g. `kanban/src/manager/orchestration-run.ts`
   - Create run id
   - Write `checkpoint.json` + `dispatch-log.md`
   - Update before each dispatch wave and after each integration decision
2. Storage location (pick one, keep memory repo clean of secrets):
   - Preferred: under project memory `projects/<name>/orchestrations/<runId>/`
   - Alternative: Kanban runtime state next to workspace metadata
3. New tools: `start_orchestration`, `get_orchestration`, `update_unit_status`
4. Wire Phase 7 memory lifecycle later so completed runs summarize into project memory

**Checkpoint shape (stripped, provider-agnostic):**

```json
{
  "runId": "…",
  "project": "…",
  "baselineRef": "…",
  "dispatchTally": { "used": 0, "cap": 0 },
  "units": [
    {
      "id": "U1",
      "chatId": "…",
      "tier": "T1",
      "status": "pending|in-flight|verified|failed|surfaced|integrated",
      "dispatches": 0,
      "doneCriteria": ["…"],
      "evidenceRef": null
    }
  ],
  "nextAction": "…"
}
```

**Acceptance:**

- Kill Phuong session mid-plan → new session can load checkpoint and continue
- Independent verified units still report as shippable when one unit is surfaced

---

### Phase D — Integration / ship gate (later)

**Objective:** Close the loop after parallel Pi chats.

Only after A–C are stable:

- Sequential integration policy (merge/PR review order) using existing git/PR flow
- Ship gate: one integrated review chat (or Phuong-driven Gate 1 over full diff) + one fix round max
- Optional UI: show orchestration run table in Phuong panel (not a kanban board revival)

## Explicit non-goals

- Installing or vendoring `midego1/claude-orchestrate` as a dependency
- Restoring the kanban board UI for orchestration
- Docker/gVisor worker isolation (v1 stays VPS worktrees)
- Multi-user orchestration accounting
- Automatic spend / token budgeting across providers

## Suggested kickoff order

1. **Phase A only** in the first upgrade PR (prompt + `create_chat` contract).
2. Dogfood on a real multi-file task on `beta.friendlabs.ai`.
3. Phase B tools once prompt discipline proves useful.
4. Phase C when multi-chat plans regularly outlive a single Phuong session.

## Files likely touched by Phase A kickoff

| File | Change |
|---|---|
| `kanban/src/manager/phuong-context.ts` | Stripped orchestration protocol in system prompt |
| `kanban/src/manager/phuong-tools.ts` | Stronger `create_chat` / status tool descriptions |
| `docs/BUILD-RUNSHEET.md` | Link this plan as next Phase 6/8 work |
| External `base-control` `system-prompt.md` | Mirror production prompt (separate repo; out of band) |

## Risks

- **Prompt-only Phase A is soft enforcement** — models can skip the table; mitigate with tool descriptions and later checkpoint tools.
- **Gate 1 needs known commands per project** — start with project-local conventions (e.g. `npm test`, `npm run lint`) from memory `context.md`, don’t hardcode one monorepo script.
- **Verifier chats cost money/time** — use Gate 1 first; Gate 2 only when criteria aren’t mechanical.
- **Don’t fight existing STATUS protocol** — extend routing; don’t invent a parallel status system.

## Verdict for kickoff

Start with **Phase A**. It is the smallest change that captures most of the value from claude-orchestrate after stripping Claude harness and Anthropic routing. Phases B–D turn that behavior into durable product machinery.
