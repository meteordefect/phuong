# Kanban Fork Full Build Plan

## Objective

Build a new product on top of a permanent imported copy of `cline/kanban` inside this repository and deploy it to a VPS as the primary always-on system.

End state:

- you open a secure web app hosted on your VPS
- the app is your forked Kanban UI and runtime
- `Phoung` is the manager agent you talk to
- `Phoung` plans work, breaks it into tasks, and manages task flow
- `pi` is the worker agent used for Kanban task execution
- `GLM-5` is the default execution model for `pi`
- memories live outside this repo in separate git-backed memory repositories
- memory never leaks into the main application repo
- `v1` is explicitly single-user
- the design can later support multiple users, each with isolated memory and workspace state

This plan intentionally does not optimize around the current `clawdeploy` implementation. It keeps only the parts worth preserving and treats the imported Kanban code as the new core.

## Locked Decisions

The following are now considered decided for `v1`:

- `v1` is single-user only
- the primary runtime lives on the VPS
- the Kanban code is imported permanently into this repo and becomes the main product base
- memory lives outside this repo in a separate git-backed repository on the VPS
- `Phoung` is the manager and planner
- `pi` is the default worker runtime
- `GLM-5` via `ZAI` is the default worker model
- `pi` is integrated through a structured process integration path, with `RPC` as the preferred implementation shape
- workers run directly on the VPS inside Kanban worktrees for `v1`
- Docker is not required for `v1` worker execution
- upstream Kanban support for other agents may remain in the codebase, but `pi` is the only worker we actively integrate and support in `v1`
- **auth is Clerk** — `@clerk/react` on the client, `@clerk/backend` JWT verification on the server. Auth is conditional on env vars (`VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`); when unset, the app runs without auth for local development.
- **no Tailscale gate** — the app goes straight to public HTTPS with Clerk as the auth layer. No intermediate Tailscale-only access phase.
- **domain is `beta.friendlabs.ai`** — Clerk redirect URLs and TLS are configured for this domain

## Product Definition

This system is not just "Kanban with a chat box". It is a hosted manager-and-workers platform.

### User experience

- You log into a secure web UI on the VPS.
- The main surface is your forked Kanban board.
- A manager panel lets you chat with `Phoung`.
- `Phoung` can create, prioritize, link, and start tasks on the board.
- When a task runs, Kanban creates an isolated worktree and launches `pi`.
- `pi` works the task using `GLM-5`.
- Review, diffs, comments, commits, and PR actions happen through the Kanban UI.
- When meaningful task events happen, the relevant project memory is updated in the external memory repo.

### Platform definition

- imported `Kanban` code is the execution substrate and operator UI.
- `Phoung` is the planning and orchestration layer.
- `Memory repos` are the durable knowledge layer.
- `pi` is the default worker runtime.
- `VPS` is the primary runtime host.
- `Laptop/browser` is the client, not the source of truth.

## Core Architecture Decision

The system should be deployed primarily on the VPS, not on your laptop.

Reason:

- tasks must continue while your laptop is asleep or off
- the manager agent must be always available
- worktrees and agent sessions must persist independent of your local machine
- secure remote access should feel like a personal SaaS

### Deployment model

Primary runtime:

- runs on the VPS
- hosts Kanban runtime, UI, manager services, worker runtime integration, and memory sync services

Client access:

- browser from laptop, desktop, tablet, or phone
- authenticated over HTTPS

Optional local mode:

- later, a local dev instance can exist for debugging or experimentation
- it is not the production control plane

## Non-Negotiable System Principles

### 1. Memory is external

Memories do not live in this repo.

They live in separate git repositories or a dedicated memory storage root outside the app code checkout. The app references them, mounts them, syncs them, and writes to them, but never vendors them into the main product repo.

### 2. Manager memory is not board state

Kanban workspace state is operational runtime state. It is not durable memory.

Examples of runtime state:

- board columns
- task sessions
- checkpoints
- worktree metadata

Examples of durable memory:

- project context
- decisions
- conversations
- strategic notes
- long-term learnings
- `PI` plans

### 3. Multi-tenant safety is designed from the start

`v1` is single-user, but the architecture should avoid choices that make later user isolation impossible.

That means:

- each user has isolated auth scope
- each user or org has isolated memory roots
- each workspace is associated to an owning principal
- task execution must not cross tenants
- secrets and git remotes are scoped per tenant

### 4. Manager and worker are different roles

`Phoung` is not a task worker.

`Phoung`:

- reads broad context
- decides project relevance
- decomposes work
- routes tasks
- updates memory
- asks for human input when needed

`pi`:

- works a concrete task in a concrete worktree
- sees only scoped context
- writes code, runs commands, and returns results

## Target System Architecture

## Layer 1: Auth and tenancy

Responsibilities:

- user login
- session handling
- tenant ownership
- secure access to board, repos, memories, and settings

Requirements:

- HTTPS-only
- server-side session validation
- per-user or per-org identity
- future support for multiple users and isolated data domains

Likely implementation:

- keep the current direction of secure hosted login instead of raw localhost access
- place auth in front of both UI and API
- scope all runtime access by authenticated principal

## Layer 2: Kanban fork

This is the main app shell.

Responsibilities:

- web UI
- task board
- review/diff panels
- git actions
- runtime session streaming
- worktree lifecycle
- worker launch

Upstream base:

- import the full `cline/kanban` codebase into this repo in a permanent dedicated location
- preserve upstream architecture where possible
- add new product-specific capabilities behind clear seams
- preserve enough history and structure that upstream comparison remains possible

## Layer 3: Manager service (`Phoung`)

This becomes a first-class service connected to the Kanban fork.

Responsibilities:

- chat interface
- planning and decomposition
- task creation and linking
- memory read/write orchestration
- project-aware context retrieval
- deciding which memories to load
- deciding which task context to inject

`Phoung` should operate as a manager-control plane above Kanban, not as a replacement for Kanban runtime internals.

## Layer 4: Worker runtime (`pi`)

Responsibilities:

- execute task prompts in worktrees
- use `GLM-5` by default
- report progress and review-ready transitions
- support task-local plan/act behavior as needed
- integrate with Kanban through a structured process protocol rather than brittle terminal scraping

Initial model policy:

- default worker agent: `pi`
- default model: `GLM-5`
- default provider: `ZAI`
- allow per-task override later

## `pi` integration approach

`pi` is not treated as the planner. It is treated as the worker runtime.

`pi` already supports:

- CLI mode
- JSON mode
- RPC mode for process integration
- SDK embedding

For this fork, the preferred implementation path is:

- Kanban remains the task/worktree/session shell
- `pi` is launched as a worker process
- the integration layer communicates with `pi` through `RPC`
- model selection is pinned to `zai/glm-5`

Reason:

- this matches Kanban's existing process-oriented worker model better than a deep native runtime fork
- it gives us structured events and control
- it avoids treating `pi` as a second special in-process runtime like upstream Cline

## Layer 5: Memory service

Responsibilities:

- mount and manage external memory repositories
- read/write memory safely
- commit and push memory updates on a schedule or event basis
- prevent memory content from entering the app repo
- enforce tenant memory isolation

This service must be a separate concept from Kanban workspace persistence.

## Memory Architecture

## Memory layout

Use a dedicated root on the VPS, outside the main app checkout.

Suggested pattern:

```text
/srv/clawdeploy/
  app/                  # this repo / deployed product code
  data/
    tenants/
      <tenant-id>/
        memories/
          base-control.git-or-working-copy/
        repos/
          <project-repo>/
        worktrees/
          ...
        runtime/
          ...
```

Or, if one memory repo per tenant plus project structure inside it:

```text
<memory-root>/
  system-prompt.md
  overview.md
  org/
  projects/
    <project>/
      context.md
      memories/
      conversations/
      tasks/
      plans/
```

## Memory rules

- memory repos are never committed into this app repo
- memory roots are mounted or referenced by path
- all writes happen through a memory service layer
- memory commits are attributed to the tenant/service identity
- backups are regular and automated
- project memories are loaded selectively, not globally

## Selective loading design

`Phoung` should continue the selective memory pattern:

1. load system and overview context
2. identify relevant project(s)
3. read only the relevant project context
4. inspect memory filenames or indexes
5. load only what is needed for the current task or conversation

This principle must remain intact after migration.

## `PI` Design

`PI` is a manager-level planning object, not a Kanban task flag.

Suggested structure:

- `id`
- `title`
- `goal`
- `owner`
- `tenant`
- `projects`
- `status`
- `time horizon`
- `success criteria`
- `linked memories`
- `task graph`
- `review notes`
- `outcomes`

Suggested storage:

- keep `PI` records in the external memory repo under project or org planning folders
- expose them in the app through manager APIs
- derive Kanban tasks from `PI` plans

Suggested behavior:

- `Phoung` creates or updates `PI`
- `Phoung` emits executable task cards into Kanban
- task completion status rolls back up into `PI`

## Security Model

## Access

- app accessible only through HTTPS
- authenticated sessions required
- no raw public unauthenticated Kanban runtime exposure
- admin-only access for early stages

## Worker execution model

For `v1`, workers run directly on the VPS inside Kanban-managed worktrees.

Target architecture:

- Kanban manages worktree lifecycle
- Kanban launches `pi` for each task
- `pi` runs directly in the task worktree on the VPS
- model and provider are pinned by product configuration
- review, diff, and git flow stay in the Kanban shell

Reason:

- it matches upstream Kanban more closely
- it reduces fork complexity
- it gets to a usable hosted product faster
- single-user `v1` does not require multi-tenant-grade worker isolation

Future option:

- container-backed worker isolation can be added later if multi-user hosting or stronger isolation becomes necessary

## Deployment Architecture

## VPS services

Target production stack:

- reverse proxy
- web UI
- Kanban runtime API/server
- manager service (`Phoung`)
- memory service
- worker launcher / container orchestrator
- optional database for auth, tenant metadata, and operational records
- git/memory backup jobs

## Secure login

Goal:

- log into the product like a SaaS built for you

Implementation (decided):

- Clerk is the auth provider
- client-side: `ClerkProvider` + `RequireAuth` gate in `web-ui/src/main.tsx`, token synced to a module-level store for non-React consumers (tRPC client, WebSocket URLs)
- server-side: `@clerk/backend` `verifyToken()` in `src/auth/clerk-verify.ts`, guards all `/api/*` HTTP and all WebSocket upgrades
- env vars: `VITE_CLERK_PUBLISHABLE_KEY` (build-time), `CLERK_SECRET_KEY` (runtime)
- when env vars are unset, auth is skipped (local dev mode)

## Networking

- public ingress only through reverse proxy
- internal services only on private network
- worker execution network policies should be as tight as practical
- secrets available only to services that need them

## Current Repo Strategy

This repo becomes the home of the imported Kanban code and the hosted product built around it.

## What to keep conceptually

Keep:

- `Phoung` as manager concept
- selective context loading idea
- external memory repo idea
- project-scoped context organization
- secure VPS deployment direction
- `pi` as worker agent

## What to retire or stop centering

Retire as primary architecture:

- current custom review UI as the long-term main surface
- current custom task board model
- current app-specific worker orchestration as the final execution substrate
- Docker-first worker orchestration as the `v1` assumption

These may remain temporarily during migration, but they are not the end state.

## Repository restructuring target

High-level desired structure:

```text
/
  kanban/                # imported upstream code, permanently kept here
  manager/
  memory-service/
  deploy/
  docs/
```

Practical note:

- do not over-refactor on day one
- first land the plan and choose the target layout
- then migrate code into the new shape in phases

## Build Tracks

The build should be broken into parallel but ordered tracks.

## Track A: Import and baseline Kanban runtime ✅

Goal:

- establish the fork as the new foundation

Deliverables:

- upstream Kanban code imported into this repo
- upstream code kept permanently for reference and ongoing product work
- builds and runs on the VPS
- secure reverse-proxied access
- persistent runtime storage paths configured for server use

Files/modules expected to matter:

- upstream `src/cli.ts`
- upstream `src/server/runtime-server.ts`
- upstream `src/trpc/runtime-api.ts`
- upstream `src/trpc/workspace-api.ts`
- upstream `src/state/workspace-state.ts`
- upstream `web-ui/src/App.tsx`

> Done — Kanban v0.1.47 imported, builds and boots locally. VPS deploy pending (Phase 4 in runsheet).

## Track B: Add auth and tenancy ✅

Goal:

- make the fork safe to expose remotely

Deliverables:

- login flow
- auth middleware
- tenant/user scoping
- scoped resource access

This track must happen before exposing the app publicly.

> Done — Clerk auth integrated. Client-side gate in `web-ui/src/auth/`, server-side JWT verification in `src/auth/clerk-verify.ts`. All HTTP API and WebSocket paths protected. Tenant scoping deferred to multi-user phase.

## Track C: Add `Phoung` manager service

Goal:

- restore the manager experience on top of Kanban

Deliverables:

- manager chat UI panel
- manager API endpoints
- task creation APIs from manager to Kanban
- memory retrieval and summary pipeline
- task graph generation

Current code likely worth mining:

- `main-agent/src/phoung.ts`
- `main-agent/src/server.ts`
- `main-agent/src/memory.ts`

These should be treated as source material, not sacred architecture.

## Track D: Add memory service

Goal:

- external durable memory with backup and tenant isolation

Deliverables:

- memory repo path management
- read/write abstraction
- selective project loading
- git commit/push automation
- leak-prevention rules

Current source material:

- `docs/MEMORY-SEPARATION.md`
- `main-agent/src/memory.ts`

## Track E: Add `pi` worker runtime ✅ (initial integration)

Goal:

- make `pi + GLM-5` the default Kanban worker

Deliverables:

- worker catalog entry
- launch config
- model configuration for `GLM-5`
- provider configuration for `ZAI`
- task event parsing
- proper review-ready signaling
- `RPC` integration path from Kanban to `pi`

Likely upstream integration points:

- `src/core/agent-catalog.ts`
- `src/terminal/agent-registry.ts`
- `src/terminal/agent-session-adapters.ts`
- `src/trpc/runtime-api.ts`

> Done (initial) — pi registered in agent catalog, adapter created in `agent-session-adapters.ts`, launches with `-p --no-session`. RPC integration and structured event parsing deferred to later hardening.

## Track F: Worker runtime hardening

Goal:

- strengthen worker execution policy after the direct VPS worktree model is working

Deliverables:

- process supervision improvements
- resource controls if needed
- optional later container-backed execution design
- cleanup and restart behavior
- operational hardening

This does not block `v1`. It is a later hardening track.

## Track G: Memory sync from task lifecycle

Goal:

- make execution outcomes enrich long-term project memory

Deliverables:

- event schema for task lifecycle
- memory update rules
- summary extraction rules
- project folder routing rules

Examples:

- task started -> append execution record
- task asked question -> log decision point
- task completed -> add summary and artifacts
- PR opened -> record implementation outcome
- important new pattern -> create/update project memory note

## Track H: VPS deployment and operations ✅

Goal:

- production-grade hosted system

Deliverables:

- systemd service (`kanban.service.j2`) with auto-restart, journald logging, env file
- nginx reverse proxy (`kanban-nginx.conf.j2`) with TLS, WebSocket support, Cloudflare-compatible headers
- Ansible playbook (`kanban-deploy.yml`) — one-command deploy via `./deploy.sh kanban`
- Let's Encrypt TLS via certbot with auto-renewal cron
- UFW firewall (SSH + HTTP + HTTPS only)
- pi installed globally, set as default agent
- git configured for SSH-based GitHub access on VPS

> Done — No Docker. Node.js runs directly on VPS via systemd. Deploy is `./deploy.sh kanban`.

## Migration Phases

> **Note:** The actual execution order is tracked in `docs/BUILD-RUNSHEET.md`. The original phase numbering below has been revised to match the runsheet. Key changes from the original plan: pi integration was done early (Phase 2, not Phase 5), auth uses Clerk (decided, not open), Tailscale was dropped, and Phase 3+4 were merged.

## Phase 1: Import Kanban and boot locally ✅

Outcome:

- permanent Kanban code imported into this repo
- baseline app builds and runs locally

## Phase 2: Add `pi` as Kanban agent ✅

Outcome:

- pi registered in Kanban agent catalog
- pi launches tasks in worktrees
- model defaults to `GLM-5` via `ZAI`

## Phase 3: Add Clerk auth ✅

Outcome:

- Clerk login gate on the client
- JWT verification on all API and WebSocket paths
- auth conditional on env vars (local dev works without auth)

## Phase 4: Deploy to VPS with public access ✅

Outcome:

- app runs on VPS behind nginx + TLS at `beta.friendlabs.ai`
- Clerk auth active with production keys
- pi executes tasks using ZAI/GLM (model from `DEFAULT_MODEL` env var)
- `./deploy.sh kanban` for one-command deploy via Ansible
- systemd service, UFW firewall, Let's Encrypt TLS all configured

## Phase 5: Add external memory service

Outcome:

- memory moved out of app repo
- memory service owns reads/writes
- backups and git sync jobs are live

## Phase 6: Add Phoung manager service

Outcome:

- `Phoung` chat exists inside the hosted product
- `Phoung` can create and manipulate board tasks

## Phase 7: Connect memory to task lifecycle

Outcome:

- project memories evolve automatically and stay neatly separated

## Phase 8: Production hardening

Outcome:

- systemd service, Ansible playbook, backups, health monitoring
- deployment is robust and operationally safe

## Concrete Planning Decisions To Lock Early

These must be resolved early because they affect the whole design.

### 1. Repository layout ✅ decided

Kanban lives in `kanban/` subdirectory. Upstream `.git` removed, code is part of this repo. Extensions (auth, manager, memory) added inside `kanban/src/` to keep a single build.

### 2. Auth stack ✅ decided

Clerk. Client-side `@clerk/react`, server-side `@clerk/backend` JWT verification. Auth boundaries live outside the Kanban core in `src/auth/` and `web-ui/src/auth/`.

### 3. Worker execution mode ✅ decided

Direct VPS worktree execution for `v1`. Pi launches as a CLI process in the Kanban-managed worktree. Container-backed execution deferred.

### 4. Memory repo model

Decide:

- one memory repo per tenant
- or one monorepo with per-tenant folders

Recommendation:

- one memory repo per tenant or org is cleaner for future SaaS isolation

### 5. Event model for memory updates

Decide:

- which task events become durable memory writes

Recommendation:

- start narrow and structured, not freeform

### 6. Agent surface strategy ✅ decided

Upstream agent support left in the codebase. Pi is the only actively integrated and supported worker in `v1`. Pi is registered in the agent catalog and has a dedicated adapter.

## Suggested Initial Deliverable Sequence

Build in this order (revised to match actual execution):

1. ✅ import and boot Kanban fork locally
2. ✅ add `pi` as Kanban agent (moved up — needed early to validate the fork)
3. ✅ add Clerk auth (Tailscale step dropped — going straight to public Clerk-gated access)
4. ✅ deploy to VPS with public HTTPS + Clerk (systemd, nginx, TLS, pi, UFW)
5. externalize memory service and backup jobs ← **next**
6. add `Phoung` manager service and chat surface
7. connect memory to task lifecycle
8. production hardening (systemd, Ansible, backups, monitoring)

## Definition of Done

The migration is complete when all of the following are true:

- the primary system runs on the VPS
- you can securely log in through the browser
- the main UI is your Kanban-based product
- you can chat with `Phoung` inside the product
- `Phoung` can create and manage task flows
- Kanban tasks execute through `pi`
- `GLM-5` is the default worker model
- `ZAI` is the default worker provider
- project memories live outside the app repo
- memory updates are backed up to git regularly
- task outcomes update the correct project memory without leaking across projects
- the architecture can support future tenant isolation

## Immediate Next Step

The technical implementation plan is `docs/BUILD-RUNSHEET.md`. It contains step-by-step execution instructions for each phase.

Current status: Phases 1–4 complete. The system is live at `beta.friendlabs.ai` with Clerk auth, pi task execution (ZAI/GLM), and full deploy automation. Next action is Phase 5 — adding the external memory service.
