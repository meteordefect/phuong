# Phuong — Architecture

## Overview

Phuong is a project manager agent for coding work. You chat with Phuong through a review dashboard. Phuong creates tasks, spawns coding sub-agents in gVisor-sandboxed Docker containers with mounted repo workspaces, and opens merge requests for your approval. All state is file-based — no database required.

```
┌──────────────────────────────────────────────────────────────┐
│                         YOU (Human)                          │
│                                                              │
│   Chat with Phuong ◄──────────► Review UI                    │
│   (business context,             (tasks, diffs,              │
│    task assignment)                merge/reject)              │
└──────────┬───────────────────────────┬───────────────────────┘
           │                           │
           ▼                           │
┌──────────────────────┐               │
│  PHOUNG (main agent) │               │
│                      │               │
│  - Knows all projects│               │
│  - File-based memory │               │
│  - Spawns sub-agents │               │
│  - Manages task queue│               │
└──────────┬───────────┘               │
           │                           │
     ┌─────┴──────┐                    │
     ▼            ▼                    │
┌─────────┐ ┌─────────┐               │
│Sub-Agent│ │Sub-Agent│  ◄─────────────┘
│(gVisor) │ │(gVisor) │    (GitHub PRs are
│         │ │         │     the interface)
└────┬────┘ └────┬────┘
     │           │
     ▼           ▼
   GitHub PR   GitHub PR
```

---

## Context Engineering

Phuong uses a two-layer context architecture to keep agent context windows small while providing full project awareness.

### Layer 1: Company Knowledge Graph (`memory/`)

Phuong's knowledge of the entire organization. Loaded selectively — Phuong reads the overview first, then drills into only the relevant project.

```
memory/
├── system-prompt.md           # Phuong identity and rules
├── subagent-prompt.md         # Sub-agent template
├── overview.md                # All projects overview
├── org/
│   ├── decisions/             # Cross-project decisions with reasoning
│   └── strategy/              # Vision, positioning, open dilemmas
├── projects/<name>/
│   ├── context.md             # Project context (stack, repo, priorities)
│   ├── memories/              # Project-specific knowledge
│   ├── conversations/         # Chat history
│   └── tasks/                 # Active and completed tasks
├── research/                  # Deep domain knowledge
├── general/                   # Cross-project memories
└── logs/                      # Cron logs
```

**Loading hierarchy** — Phuong goes deeper only as needed:

| Level | What | When loaded |
|-------|------|-------------|
| 0 | `system-prompt.md` | Always (~1KB) |
| 1 | `overview.md` | Always (~2KB) |
| 2 | `projects/<name>/context.md` | When Phuong identifies the relevant project |
| 3 | `projects/<name>/memories/` | Phuong scans filenames, loads only what's relevant |

### Layer 2: Per-Project Context (in each repo)

What sub-agents see. Lives in the repo itself so it stays in sync with the code.

```
project-repo/
├── .clawdeploy/
│   └── context/
│       ├── ROUTING.md         # What context is available
│       ├── patterns.md        # Confirmed code conventions
│       ├── decisions.md       # Architectural choices with reasoning
│       └── debugging.md       # Solutions to recurring problems
└── src/
```

During spawn, Phuong can also inject relevant company-level context from `memory/` into the workspace at `.clawdeploy/injected/`.

---

## Runtime Components

| Component | Description |
|-----------|-------------|
| `phuong-api` | Express API hosting chat, task operations, PR operations, logs, SSE stream, and cron trigger |
| `phuong-ui` | React review dashboard for conversations, task status, and technical context |
| `phuong-nginx` | Reverse proxy exposing a single entrypoint on port 8080 |
| `subagent` image | On-demand gVisor-sandboxed worker container that runs the pi coding agent CLI |

### Docker Compose Stack

```yaml
services:
  api         # Node/Express, mounts memory/, repos/, workspaces/, Docker socket
  review-ui   # Vite build → nginx:alpine static
  nginx       # Reverse proxy: / → review-ui, /api/ → api
```

All three services run on an internal bridge network. Nginx exposes port 8080.

---

## Core Source Modules

### main-agent/

| Module | Purpose |
|--------|---------|
| `phuong.ts` | Session lifecycle, model routing (Kimi, ZAI, Anthropic), stream handling |
| `extension.ts` | Custom tool definitions exposed to Phuong |
| `spawner.ts` | Docker/gVisor orchestration — worktree bind mount, post-exit push/PR, cleanup |
| `repos.ts` | Local repo management — clone, pull, git worktrees, context injection |
| `memory.ts` | Task files, conversation files, activity logs, memory documents |
| `github.ts` | GitHub PR operations — list, details, merge, close |
| `server.ts` | REST and SSE transport layer |
| `config.ts` | Env-based configuration |
| `index.ts` | Entry point |

### review-ui/

| Module | Purpose |
|--------|---------|
| `App.tsx` | Layout shell: sidebar + main content + logs drawer, event bus wiring |
| `Sidebar.tsx` | Persistent left sidebar — task list with status badges, conversation history |
| `ChatView.tsx` | Chat interface with SSE streaming |
| `TaskDetailView.tsx` | Full task detail — prompt, activity timeline, PR info, merge/reject actions |
| `MonitorView.tsx` | System overview/monitoring |
| `ContextPanel.tsx` | Right panel — PR file changes with +/- counts, CI status |
| `LogsDrawer.tsx` | Collapsible bottom drawer for service logs (Ctrl+\`) |
| `MessageCard.tsx` | Message rendering with inline action cards |
| `api.ts` | API client |
| `lib/eventBus.ts` | Pub/sub event bus for cross-panel communication |
| `lib/usePreserveScroll.ts` | Scroll preservation hook across re-renders |

### subagent/

| File | Purpose |
|------|---------|
| `Dockerfile` | Ubuntu 24.04 image with git, gh CLI, Node.js, pi-coding-agent |
| `entrypoint.sh` | Decode prompt, run pi CLI in `/workspace`, commit (host handles push/PR) |

---

## Agent Workflow

### Chat Flow

1. You send a message in the review UI.
2. API streams request to a Phuong session.
3. Phuong can call custom tools (`spawn_subagent`, `register_project`, `update_task`, etc.).
4. Responses stream back to the UI via SSE.

### Spawn Flow

```
register_project → clone to repos/<name>/
                              │
spawn_subagent ───────────────┤
  1. git pull origin main     │
  2. git worktree add          │
  3. inject context files      │
  4. docker run --runtime=runsc with bind mount
  5. subagent works in /workspace
  6. on exit: commit, push, PR from host
  7. worktree cleanup
```

Key points:
- Sub-agents never clone repos — they work with mounted git worktrees.
- Push and PR creation happen on the host after the container exits, not inside the container.
- Worktrees are ephemeral and cleaned up after use.

### Interaction Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| Live chat | You type a message | Phuong responds conversationally, can spawn agents immediately |
| Cron wake-up | `POST /cron/wake` | Phuong reads task list, processes queue, writes results to files |

### Human-in-the-Loop

- Phuong never merges PRs — only you do, through the review UI.
- When Phuong encounters something it can't resolve, it uses `ask_human` to pause and wait for your input.
- The `ask_human` tool supports two modes: `notify` (agent continues) and `handoff` (agent waits for reply).

---

## Tool Definitions

Phuong uses native pi-mono tool calls. Custom tools:

| Tool | Purpose |
|------|---------|
| `spawn_subagent` | Spawn a coding sub-agent with optional model override, reasoning level, and context injection |
| `register_project` | Clone a repo and set up project memory structure |
| `list_tasks` | List all tasks across projects |
| `update_task` | Update task status and metadata |
| `ask_human` | Pause and request human input (notify or handoff mode) |
| `check_prs` | Check PR status for a project |
| `create_memory` | Create a new memory document |

Built-in tools (file read, write, edit, shell) remain available through pi-mono.

---

## API Surface

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/tasks` | GET | List all tasks |
| `/tasks/:taskId` | GET | Get task details |
| `/tasks/:taskId/merge` | POST | Merge task PR |
| `/tasks/:taskId/reject` | POST | Reject/close task PR |
| `/tasks/:taskId/activity` | GET | Task activity timeline |
| `/tasks/:taskId/runs/:run/log` | GET | Sub-agent run log |
| `/tasks/:taskId/pr-info` | GET | PR metadata and file changes |
| `/chat` | POST | SSE streaming chat |
| `/chat/active` | GET | Check for active chat turn (turn recovery) |
| `/conversations` | GET | List conversations |
| `/conversations/:convId` | GET | Get conversation history |
| `/conversations/new` | POST | Start new conversation |
| `/models` | GET | Available LLM models |
| `/projects` | GET | Registered projects |
| `/logs/:service` | GET | Service logs |
| `/cron/wake` | POST | Trigger cron wake-up |
| `/events/stream` | GET | SSE event stream for live updates |

---

## Review UI Layout

Three-panel IDE-style layout with persistent sidebar and collapsible log drawer.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Phuong                                     [model] [new chat] [⚙]  │
├────────────┬─────────────────────────────────┬───────────────────────┤
│            │                                 │                       │
│  SIDEBAR   │         MAIN CONTENT            │    CONTEXT PANEL      │
│            │                                 │    (conditional)      │
│  Tasks     │  Chat / Task detail             │                       │
│  --------  │                                 │  File changes         │
│  task-005  │                                 │  PR info              │
│    Coding  │                                 │  CI status            │
│  task-006  │                                 │                       │
│    PR Open │                                 │                       │
│            │                                 │                       │
│  History   │                                 │                       │
│  --------  │                                 │                       │
│  conv-1    │                                 │                       │
│  conv-2    │                                 │                       │
│            │                                 │                       │
│            ├─────────────────────────────────┴───────────────────────┤
│            │  LOGS DRAWER (collapsible, Ctrl+`)                      │
│            │  [API] [UI] [Nginx]                                     │
│            │  > 2026-03-08 14:30:02 INFO  Agent spawned for task-005 │
├────────────┴────────────────────────────────────────────────────────┤
│  [input bar]                                              [Send]    │
└─────────────────────────────────────────────────────────────────────┘
```

**Sidebar**: Persistent left rail showing all tasks with status badges and conversation history. Clicking navigates the main content area.

**Main content**: Switches between chat view and task detail view based on sidebar selection.

**Context panel**: Appears when viewing a task with a PR — shows changed files with +/- counts, CI check status, branch name.

**Logs drawer**: Collapsible bottom panel showing service logs. Persists across views.

### UI Patterns

- **Event bus**: Cross-panel pub/sub for coordinated updates without redundant polling.
- **SSE live updates**: Real-time push for task status changes, agent events. Polling as fallback.
- **Smart refresh**: Signature-based render skipping — only re-render when data actually changes.
- **Scroll preservation**: Scroll position maintained across data refreshes.
- **Page visibility pause**: Polling pauses when the browser tab is hidden.
- **Turn recovery**: If the page reloads during a streaming response, the UI reconnects to the running turn.
- **Structured dispatch/reply**: `ask_human` dispatches render as threaded timeline cards with reply forms.
- **Lazy tab initialization**: Views only fetch data on first activation.

---

## Security Model

### gVisor Sandboxing

Sub-agent containers run with gVisor (`runsc`) for user-space kernel isolation. The Docker runtime is configurable via `SUBAGENT_RUNTIME` (set to `runc` for local dev without gVisor).

### Branch Protection

- Sub-agents can only push to feature branches: `task/<task-id>-<slug>`.
- Push and PR creation happen on the host, not inside the container.
- GitHub branch protection rules enforce PR review requirements on `main`.
- Only you can merge — Phuong never merges.

### Action Guardrails

Phuong's tool calls are defined in code with explicit parameter schemas. There is no freeform action parsing — tools are registered with the pi-mono SDK and validated at call time. Merge operations are only available through the review UI API, never through agent tools.

### Resource Limits

Sub-agent containers run with configurable memory and CPU limits (`SUBAGENT_MEMORY_LIMIT`, `SUBAGENT_CPUS`). Maximum concurrent sub-agents is enforced (`MAX_CONCURRENT_SUBAGENTS`).

---

## Persistence Model

All state is stored as files. No database.

| Path | Contents |
|------|----------|
| `memory/system-prompt.md` | Phuong identity and operating constraints |
| `memory/subagent-prompt.md` | Worker template used during spawn |
| `memory/overview.md` | Cross-project context index |
| `memory/org/` | Company-wide decisions and strategy |
| `memory/research/` | Domain knowledge |
| `memory/projects/<project>/` | Project context, memories, conversations, tasks |
| `repos/<project>/` | Local git clones of all registered project repos |

Task files use YAML frontmatter for structured metadata (status, branch, PR number, model config) with markdown body for the prompt and progress notes.

Conversations are stored as markdown with frontmatter, one file per session.

---

## Deployment

### Prerequisites

- Linux VPS (Ubuntu 22.04+ for gVisor support)
- Ansible 2.15+ on your local machine
- SSH access to the server (key-based)
- At least one LLM API key (Kimi, ZAI/GLM, or Anthropic)
- GitHub personal access token

### Configuration

```bash
cp .env.example .env
```

Required settings:
- At least one LLM API key (`KIMI_API_KEY`, `ZAI_API_KEY`, or `ANTHROPIC_API_KEY`)
- `GITHUB_TOKEN`

See `.env.example` for all available settings including sub-agent model, resource limits, container runtime, and paths.

### Deploy to Server

```bash
cd deploy
cp ansible/inventory.ini.example ansible/inventory.ini
# Edit inventory.ini — set your server IP

./deploy.sh deploy-v2
```

This syncs the repo to your server, builds all containers, installs gVisor, and starts the stack.

### Access

```bash
cd deploy
./deploy.sh tunnel
```

Open `http://localhost:8080`. Override SSH key: `SSH_KEY=~/.ssh/my-key ./deploy.sh tunnel`.

### Local Dev

```bash
docker compose up -d
```

Set `SUBAGENT_RUNTIME=runc` in `.env` to run without gVisor locally.

### gVisor Manual Setup

If not using the deploy playbook:

```bash
ARCH=$(uname -m)
URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"
wget "${URL}/runsc" "${URL}/containerd-shim-runsc-v1"
sudo install -o root -g root -m 0755 runsc /usr/local/bin/
sudo install -o root -g root -m 0755 containerd-shim-runsc-v1 /usr/local/bin/
```

Add to `/etc/docker/daemon.json`:
```json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc"
    }
  }
}
```

Then `sudo systemctl restart docker`.

---

## Stack

TypeScript, Express, React, Vite, Tailwind, Docker, gVisor, pi-mono SDK, Ansible.
