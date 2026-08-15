# Build Runsheet

Step-by-step execution plan for the Phuong/Kanban rebuild. Each phase produces a working checkpoint. Do not skip phases — each depends on the previous.

**Current execution track:** outcome hierarchy + Crush-inspired visuals is `docs/OUTCOME-CRUSH-RUNSHEET.md` (plans: `docs/OUTCOME-HIERARCHY-PLAN.md`, `docs/CRUSH-VISUAL-STEAL-PLAN.md`). This file remains the historical Phases 1–7 record.

## Phase 1: Import Kanban and boot locally ✅

### 1.1 Clone upstream Kanban

```
git clone https://github.com/cline/kanban.git kanban/
rm -rf kanban/.git
```

Remove the upstream `.git` so it becomes part of this repo, not a submodule.

### 1.2 Install and build

```
cd kanban
npm install
npm run install:all
npm run build
```

Verify the build completes without errors.

### 1.3 Boot locally

```
cd kanban
npx tsx src/cli.ts
```

Open the local URL in a browser. Verify:

- board loads
- you can create a task card
- you can start a task (with any installed agent, e.g. claude or codex)
- worktree is created
- task runs and produces output

### 1.4 Checkpoint

Kanban runs locally as an unmodified fork. Commit this as the baseline.

> **Done** — committed `ff73a90`, Kanban v0.1.47 imported, builds and boots at `localhost:3484`.

---

## Phase 2: Add `pi` as a Kanban agent ✅

### 2.1 Extend the agent ID enum

File: `kanban/src/core/api-contract.ts`

Add `"pi"` to the `runtimeAgentIdSchema` enum.

### 2.2 Add catalog entry

File: `kanban/src/core/agent-catalog.ts`

Add a `pi` entry to `RUNTIME_AGENT_CATALOG`:

- id: `"pi"`
- label: `"Pi"`
- binary: `"pi"`
- baseArgs: `["-p", "--no-session"]`
- autonomousArgs: `[]`
- installUrl: link to pi docs

Add `"pi"` to `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS`.

### 2.3 Create the pi adapter

File: `kanban/src/terminal/agent-session-adapters.ts`

Create `piAdapter: AgentSessionAdapter` following the codex adapter pattern:

- reads `DEFAULT_MODEL` or `SUBAGENT_MODEL` from env and passes as `--model` flag (pi defaults to google provider otherwise)
- pass prompt as the last argument
- wire up hook context for activity tracking
- add to the `ADAPTERS` map

### 2.4 Verify pi integration

- boot Kanban
- select `pi` as the active agent in settings
- create a task, start it
- verify pi launches in the worktree
- verify activity appears on the card

### 2.5 Checkpoint

pi runs tasks through Kanban locally. Commit.

> **Done** — committed `ff73a90`. Pi appears in onboarding + settings, detected on PATH, launches with `-p --no-session --model <DEFAULT_MODEL>`. Also added `"pi"` to `normalizeAgentId` allowlist in `runtime-config.ts` (without this, pi selection was silently reverted to cline on every config load).

---

## Phase 3: Add Clerk auth ✅

### 3.1 Install Clerk dependencies

```
cd kanban
npm install @clerk/backend
cd web-ui
npm install @clerk/react
```

### 3.2 Client-side Clerk integration

Files created:

- `kanban/web-ui/src/auth/session-token-store.ts` — module-level token getter/cache so non-React code (tRPC client, WebSocket URLs) can access the Clerk session token
- `kanban/web-ui/src/auth/clerk-auth-gate.tsx` — `ClerkAuthGate` component wrapping `ClerkProvider`, `RequireAuth` (shows `<SignIn />` when unauthenticated), and `TokenSync` (keeps the token store in sync via `useAuth().getToken`)
- `kanban/web-ui/src/main.tsx` — wraps the app in `ClerkAuthGate` when `VITE_CLERK_PUBLISHABLE_KEY` is set; falls through to no-auth mode when unset (local dev)

### 3.3 Server-side auth middleware

Files created:

- `kanban/src/auth/clerk-verify.ts` — `verifyHttpRequest()` and `verifyWebSocketUpgrade()` using `@clerk/backend` `verifyToken()`. Auth is enabled when `CLERK_SECRET_KEY` env var is set; when unset, all requests pass through (local dev mode).

Files modified:

- `kanban/src/server/runtime-server.ts` — all `/api/*` HTTP requests are verified before reaching tRPC. WebSocket upgrade on `/api/runtime/ws` verifies token from query param before completing the upgrade.
- `kanban/src/terminal/ws-server.ts` — terminal WebSocket upgrades (`/api/terminal/io`, `/api/terminal/control`) verify token before completing the upgrade.

### 3.4 Auth token propagation

Files modified:

- `kanban/web-ui/src/runtime/trpc-client.ts` — injects `Authorization: Bearer <token>` header into all tRPC requests
- `kanban/web-ui/src/runtime/use-runtime-state-stream.ts` — passes `?token=<jwt>` query param on WebSocket connections; guards against connecting when auth is enabled but token isn't ready yet (race condition on page load)
- `kanban/web-ui/src/terminal/persistent-terminal-manager.ts` — passes `?token=<jwt>` on terminal WebSocket connections

### 3.5 Clerk project setup (manual step)

- create a Clerk application at dashboard.clerk.com
- set allowed redirect URLs to the VPS domain
- get publishable key and secret key
- add to `.env`:
  - `VITE_CLERK_PUBLISHABLE_KEY` (client-side, used at build time)
  - `CLERK_SECRET_KEY` (server-side, used at runtime)

### 3.6 Checkpoint

Clerk auth code is integrated. When env vars are set, the app requires sign-in and verifies all API/WebSocket requests. When env vars are unset, the app runs without auth for local development.

> **Done** — Clerk auth integrated into both client and server. Auth is conditional on env vars.

---

## Phase 4: Deploy to VPS with public access ✅

### 4.1 Deploy with one command

From `deploy/`:

```
./deploy.sh kanban
```

This runs the `kanban-deploy.yml` Ansible playbook which:

1. Installs Node.js 22 on the VPS (if missing)
2. Syncs the `kanban/` source to `/opt/kanban/kanban/`
3. Copies `.env` to `/opt/kanban/.env`
4. Runs `npm install && npm run install:all && npm run build` (sources `.env` first so `VITE_CLERK_PUBLISHABLE_KEY` is baked into the client build)
5. Installs a systemd service (`kanban.service`) that runs `node dist/cli.js --host 127.0.0.1 --port 3484 --no-open`
6. Installs nginx config (`kanban-nginx.conf.j2`) that proxies `https://beta.friendlabs.ai` → `127.0.0.1:3484` with WebSocket support
7. Obtains TLS certificate via certbot (Let's Encrypt)
8. Sets up UFW firewall (SSH + HTTP + HTTPS only)

The playbook also:

- Installs `@mariozechner/pi-coding-agent` globally (so `pi` binary is on PATH)
- Sets `pi` as the default Kanban agent in `/root/.cline/kanban/config.json`
- Configures git to use SSH for GitHub (`url.git@github.com:.insteadOf https://github.com/`)
- Restarts the Kanban service after every build

### 4.2 Deploy files

- `deploy/ansible/playbooks/kanban-deploy.yml` — Ansible playbook
- `deploy/ansible/templates/kanban.service.j2` — systemd unit
- `deploy/ansible/templates/kanban-nginx.conf.j2` — nginx reverse proxy config (uses `map` for conditional WebSocket `Connection` header)

### 4.3 Operations

```
./deploy.sh kanban-status    # check systemd service status
./deploy.sh kanban-logs      # stream journalctl logs
./deploy.sh kanban-restart   # restart the service
./deploy.sh ssh              # SSH into the VPS
```

### 4.4 VPS setup (manual, one-time)

Before the first deploy, set up the VPS project repos:

```
ssh root@<vps-ip>
ssh-keygen -t ed25519 -C "kanban-vps"  # add public key to GitHub
git clone git@github.com:youruser/yourproject.git /opt/repos/yourproject
```

Then add the project in the Kanban UI using the local path (e.g. `/opt/repos/yourproject`).

### 4.5 Verify

- open `https://beta.friendlabs.ai`
- Clerk login page appears
- sign in
- board loads, Pi is the selected agent
- can create and run a task with pi (uses ZAI/GLM model from `DEFAULT_MODEL` env var)
- worktrees created on VPS filesystem at `/root/.cline/worktrees/`
- unauthenticated requests to `/api/trpc/*` return 401
- WebSocket connections without token are rejected

### 4.6 Checkpoint

Kanban + pi + Clerk auth running on VPS, publicly accessible at `beta.friendlabs.ai`. Commit deploy config.

> **Done** — Deployed and verified. Clerk auth, WebSocket streaming, pi task execution with ZAI/GLM all working. Key fixes applied: pi added to `normalizeAgentId` allowlist, pi adapter passes `DEFAULT_MODEL` as `--model` flag, nginx uses conditional `Connection` header for WebSocket proxying through Cloudflare, build step sources `.env` for `VITE_CLERK_PUBLISHABLE_KEY`.

---

## Phase 5: Add external memory service ✅

### 5.1 Create memory service module

File: `kanban/src/memory/` (new directory)

Port from `archive/v1/main-agent/src/memory.ts`:

- `memory-service.ts` — core read/write operations
- `memory-loader.ts` — selective loading (system prompt → overview → project context → specific memories)
- `memory-sync.ts` — git commit and push automation

Key adaptation: the service reads from `MEMORY_DIR` env var pointing to the external `base-control` repo clone on the VPS.

### 5.2 Set up external memory repo on VPS

```
git clone git@github.com:meteordefect/base-control.git /data/phuong-memory
```

Set `MEMORY_DIR=/data/phuong-memory` in the runtime env.

### 5.3 Add memory cron

Hourly auto-commit and push:

```
0 * * * * cd /data/phuong-memory && git add -A && git diff --cached --quiet || git commit -m "auto: $(date -u +\%Y-\%m-\%dT\%H:\%M)" && git push
```

### 5.4 Add memory tRPC procedures

File: `kanban/src/trpc/app-router.ts`

Add a `memory` sub-router:

- `memory.loadOverview` — returns system prompt + overview
- `memory.loadProjectContext` — returns context for a specific project
- `memory.listProjects` — returns project names
- `memory.listMemories` — returns memory filenames + summaries for a project
- `memory.loadMemory` — returns a specific memory file

### 5.5 Verify

- memory loads from `/data/phuong-memory` on VPS
- changes to memory files are committed hourly
- tRPC procedures return correct data

### 5.6 Checkpoint

External memory repo is live, readable by the app, auto-backed-up. Commit.

> **Done** — Memory service implemented. `kanban/src/memory/` created with three modules: `memory-service.ts` (core read ops, frontmatter parsing via js-yaml), `memory-loader.ts` (selective context assembly), `memory-sync.ts` (git commit/push). tRPC `memory` sub-router added to `app-router.ts` with 7 procedures (loadOverview, loadProjectContext, listProjects, listMemories, loadMemory, getStatus, sync). `memory-api.ts` factory wired into `runtime-server.ts`. Ansible playbook updated to clone `meteordefect/base-control` to `/data/phuong-memory`, set `MEMORY_DIR` in env, and install hourly cron for auto-backup. VPS deploy pending.

---

## Phase 6: Add Phuong manager service and rebuild UI ✅ (in progress)

### Design change: projects-and-chats, no board

The kanban board UI has been removed. The user interface now follows a projects-and-chats model:

- **Left sidebar** — lists projects; each expands to show its chat sessions and a "+ New Chat" button
- **Center panel** — the active agent chat (Pi terminal or Cline SDK chat)
- **Phuong sidebar** — an orchestration agent chat panel for planning and memory access

The board data model still exists internally (each chat is a task on the internal board's backlog column), but the board columns, cards, drag-and-drop, and `CardDetailView` have all been removed from the UI. `HomeMainView` is locked to `"chats"`.

### 6.1 Rebuild UI as projects-and-chats ✅

Files modified:

- `kanban/web-ui/src/App.tsx` — removed `KanbanBoard` render, `CardDetailView`, board-mode branching, `handleOpenBoardFromSidebar`. `selectedCard` and `boardSelection` set to `null` constants. Sidebar always visible.
- `kanban/web-ui/src/components/project-navigation-panel.tsx` — removed Board button, `isBoardView`/`onOpenBoard` props. Added "+ New Chat" button. Chat list items use collapsible toggle.
- `kanban/web-ui/src/hooks/use-project-agent-chats.ts` — `HomeMainView` type narrowed from `"chats" | "board"` to `"chats"`.
- `kanban/web-ui/src/hooks/use-home-project-agent-chat-panel.tsx` — empty state now shows "New Chat" button instead of "Create a task on the board" message. Accepts `onCreateNewChat` callback.

### 6.2 Add new chat creation ✅

When the user clicks "+ New Chat" in the sidebar or the center panel empty state:

1. `handleCreateNewChat` in `App.tsx` calls `addTaskToColumnWithResult(board, "backlog", ...)` with the project's default branch ref
2. The new task is selected via `setSelectedTaskId`
3. The `useHomeProjectAgentChatPanel` hook renders the appropriate agent panel (Pi terminal or Cline chat)

### 6.3 Add Phuong sidebar panel ✅

Phuong is integrated as a sidebar agent panel (`PhuongChatPanel`) using the existing Kanban sidebar agent surface. It can read project memory and orchestrate across projects.

### 6.4 Remaining Phase 6 work

- Wire Phuong tools to create new chats and start tasks programmatically
- Memory write-back from Phuong conversations
- Phuong context assembly using the external memory service (system prompt → overview → project context → relevant memories)

### 6.4b Phuong orchestration protocol

Adopt the stripped orchestration protocol from `docs/PHUONG-ORCHESTRATE-ADOPTION-PLAN.md` (ideas from claude-orchestrate, Claude harness removed). Product direction: **Phuong as conduit, Dashboard optional** — see `docs/PHUONG-CONDUIT.md`.

- **Phase A (prompt + `create_chat` contract)** — done: scope gate, routing table, unit prompt contract, Gate 1 soft check, triage + retry budget
- **Phuong-first + model routing** — done: Phuong default home, watch-only workers, tier→model on `create_chat`, `run_gate` / `attach_artifact`
- **Phase B remaining** — verifier chat role, stronger Gate 1 project conventions, memory write-back (Phase 7)
- **Phase C+** — checkpoint / run archive, then ship gate

### 6.5 Checkpoint

UI rebuilt as projects-and-chats. Phuong integrated as sidebar agent. New chat creation works. Committed and deployed.

---

## Phase 7: Connect memory to task lifecycle

### 7.1 Define task lifecycle events

Events that write to memory:

| Event | Memory action |
|-------|---------------|
| Task created | Append to project task log |
| Task started | Record execution start |
| Task asked question (review) | Log decision point |
| Task completed | Write summary + outcome |
| PR opened | Record implementation result |
| PR merged | Mark task complete in memory |

### 7.2 Add event hooks

File: `kanban/src/memory/task-lifecycle.ts`

Subscribe to Kanban workspace state changes. When a task transitions state, write the appropriate record to the project memory.

### 7.3 Wire to Phuong

Phuong should read recent task outcomes when planning new work. Add task history to the context assembly in `phuong-context.ts`.

### 7.4 Verify

- complete a task through the full cycle
- check `/data/phuong-memory/projects/<project>/tasks/` for the written record
- verify Phuong can reference past task outcomes in conversation

### 7.5 Checkpoint

Task lifecycle enriches memory automatically. Commit.

---

## Phase 8: Production hardening

> **Note:** Most of 8.1 and 8.2 were completed as part of Phase 4. Remaining items are backup strategy and health monitoring.

### 8.1 Process supervision ✅ (done in Phase 4)

- systemd service with auto-restart (`kanban.service`)
- logs to journald
- environment file for secrets (`/opt/kanban/.env`)

### 8.2 Ansible deployment playbook ✅ (done in Phase 4)

`deploy/ansible/playbooks/kanban-deploy.yml` handles:

- sync repo to VPS
- build Kanban fork (sources `.env` for build-time vars)
- install pi globally (`npm i -g @mariozechner/pi-coding-agent`)
- set pi as default agent
- configure systemd service
- configure nginx with TLS (Let's Encrypt via certbot)
- configure firewall (UFW: SSH + HTTP + HTTPS only)

### 8.3 Backup strategy

- memory repo: hourly git push (Phase 5)
- Kanban workspace state: daily rsync or git backup
- Clerk: managed by Clerk (SaaS)

### 8.4 Health monitoring

- nginx health endpoint
- Kanban runtime health check
- systemd watchdog

### 8.5 Checkpoint

Production-ready deployment. Commit.

---

## Summary: file locations after build

```
clawdeploy/
├── kanban/                    # imported cline/kanban fork
│   ├── src/
│   │   ├── core/              # agent catalog (with pi), api contract
│   │   ├── server/            # runtime server (with Clerk auth)
│   │   ├── terminal/          # agent adapters (with pi adapter), session manager
│   │   ├── trpc/              # app router (with memory sub-router)
│   │   ├── memory/            # memory service, loader, sync
│   │   ├── auth/              # Clerk JWT verification
│   │   └── ...                # upstream Kanban modules
│   ├── web-ui/
│   │   ├── src/
│   │   │   ├── App.tsx                     # composition root (projects+chats layout)
│   │   │   ├── components/
│   │   │   │   ├── project-navigation-panel.tsx  # left sidebar (projects, chats, + New Chat)
│   │   │   │   └── ...
│   │   │   ├── hooks/
│   │   │   │   ├── use-home-project-agent-chat-panel.tsx  # center panel agent chat logic
│   │   │   │   ├── use-project-agent-chats.ts             # chat list state, localStorage persistence
│   │   │   │   └── ...
│   │   │   ├── auth/              # Clerk client-side auth gate
│   │   │   ├── terminal/          # persistent terminal manager, WebSocket
│   │   │   └── runtime/           # tRPC client, state stream
│   │   └── ...
│   ├── package.json
│   └── ...
├── deploy/
│   ├── ansible/               # VPS provisioning and deployment
│   ├── deploy.sh
│   └── ...
├── docs/
│   ├── BUILD-RUNSHEET.md      # this file
│   ├── KANBAN-FULL-BUILD-PLAN.md
│   ├── CLINE-KANBAN-ADOPTION-REPORT.md
│   ├── MEMORY-SEPARATION.md
│   ├── ARCHITECTURE.md        # v1 arch (historical reference)
│   └── ...
├── archive/
│   └── v1/                    # old Phuong stack (reference only)
├── .gitignore
└── README.md
```

## External (on VPS, not in this repo)

```
/data/phuong-memory/           # base-control git repo clone
├── system-prompt.md
├── overview.md
├── projects/
│   └── <project>/
│       ├── context.md
│       ├── memories/
│       ├── conversations/
│       └── tasks/
├── org/
├── general/
└── skills/
```
