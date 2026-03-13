# Phoung v3

Phoung is your project manager for coding work.  
You chat with Phoung in the review UI.  
Phoung can create coding tasks, spawn coding sub-agents in gVisor-sandboxed containers, and open merge requests for your approval.

## Project Overview

- Purpose: run a practical coding workflow where AI agents produce merge requests and you stay in control of merge decisions.
- Primary agent: Phoung, powered by the pi-mono coding agent SDK.
- Sub agents: short-lived coding workers that run in gVisor-sandboxed Docker containers with mounted repo workspaces.
- Interface: review dashboard for chat, tasks, run logs, and PR context.
- State model: file-based memory and session data, no database required.

## Architecture

### Context Engineering

Phoung uses a two-layer context architecture inspired by context engineering principles:

**Company graph (`memory/`)** — Phoung's knowledge of the entire organization:
```
memory/
├── system-prompt.md           # Phoung identity and rules
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

**Per-project context (in each repo)** — what sub-agents see:
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

### Runtime Components

- `phoung-api`: Express API that hosts chat, task operations, PR operations, logs, and cron trigger endpoints.
- `phoung-ui`: React review UI for conversations, task status, and technical context.
- `phoung-nginx`: reverse proxy to expose a single entrypoint.
- `subagent` image: on-demand gVisor-sandboxed worker container that runs the coding agent CLI and exits when work is done.

### Core Source Modules

- `main-agent/src/phoung.ts`: session lifecycle, model routing, stream handling for chat.
- `main-agent/src/extension.ts`: custom tool definitions exposed to Phoung.
- `main-agent/src/spawner.ts`: Docker/gVisor orchestration for sub-agent runs with mounted workspaces.
- `main-agent/src/repos.ts`: local repo management — clone, pull, git worktrees, context injection.
- `main-agent/src/memory.ts`: task files, conversation files, activity logs, memory documents.
- `main-agent/src/github.ts`: GitHub PR operations such as list, details, merge, close.
- `main-agent/src/server.ts`: REST and SSE transport layer for UI and automation.

### Agent Workflow

1. You send a request in the UI.
2. API streams request to a Phoung session.
3. Phoung can call custom tools such as `spawn_subagent`, `register_project`, or `update_task`.
4. Spawner pulls latest repo, creates a git worktree, injects relevant context, and launches a gVisor container.
5. Sub-agent works in the mounted workspace with full project context available.
6. On exit, host pushes changes, opens PR, and cleans up worktree.
7. Task metadata and activity logs are written to `memory/projects/<project>/tasks`.
8. You review, approve, and merge.

### Spawn Flow

```
Register project → clone to repos/<name>/
                              │
Spawn subagent ───────────────┤
  1. git pull origin main     │
  2. git worktree add          │
  3. inject context files      │
  4. docker run --runtime=runsc with bind mount
  5. subagent works in /workspace
  6. on exit: commit, push, PR from host
  7. worktree cleanup
```

### Tooling Model

Phoung uses native pi-mono tool calls.  
Custom tools currently include:

- `spawn_subagent` — spawn a coding sub-agent with optional context injection
- `register_project` — clone a repo and set up project memory structure
- `list_tasks`
- `update_task`
- `ask_human`
- `check_prs`
- `create_memory`

Built-in tools such as file read, write, edit, and shell remain available through pi-mono.

### Persistence Model

- `memory/system-prompt.md`: primary behavior and operating constraints.
- `memory/subagent-prompt.md`: worker template used during spawn.
- `memory/overview.md`: cross-project context index.
- `memory/org/`: company-wide decisions and strategy.
- `memory/research/`: domain knowledge.
- `memory/projects/<project>/`: project context, memories, conversations, active tasks, completed tasks.
- `repos/<project>/`: local git clones of all registered project repos.

### API Surface

Key endpoints:

- `GET /health`
- `GET /tasks`
- `GET /tasks/:taskId`
- `POST /tasks/:taskId/merge`
- `POST /tasks/:taskId/reject`
- `GET /tasks/:taskId/activity`
- `GET /tasks/:taskId/runs/:run/log`
- `GET /tasks/:taskId/pr-info`
- `POST /chat` (SSE streaming)
- `GET /conversations`
- `GET /conversations/:convId`
- `POST /conversations/new`
- `GET /models`
- `GET /projects`
- `GET /logs/:service`
- `POST /cron/wake`

## Setup

### Prerequisites

- Docker host (Linux recommended for gVisor support)
- Ansible 2.15 or newer
- SSH access
- API credentials for your selected model providers and GitHub

### Configuration

Create `.env` at repo root with values such as:

```env
KIMI_API_KEY=
ZAI_API_KEY=
ANTHROPIC_API_KEY=
GITHUB_TOKEN=
DEFAULT_MODEL=
SUBAGENT_MODEL=
MAX_CONCURRENT_SUBAGENTS=3
SUBAGENT_IMAGE=phoung/subagent:latest
SUBAGENT_MEMORY_LIMIT=4g
SUBAGENT_CPUS=2
SUBAGENT_RUNTIME=runsc
REPOS_DIR=/app/repos
WORKSPACES_DIR=/tmp/clawdeploy-workspaces
```

### gVisor Setup

gVisor provides user-space kernel isolation for sub-agent containers. The deploy playbook installs it automatically. For manual setup:

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

Set `SUBAGENT_RUNTIME=runsc` in `.env`. To run without gVisor (e.g. local dev), leave it as `runc`.

### Deploy

```bash
source .env
cd deploy
./deploy.sh deploy-v2
```

### Access UI

```bash
./deploy.sh tunnel
```

Open `http://localhost:8080`.

## Secret Safety Before Push

- Keep real credentials only in `.env` or secure secret managers, never in tracked files.
- `.gitignore` already excludes `.env` and `.env.*` except explicit examples.
- Before every push, run a quick staged scan:

```bash
git diff --cached | rg -n "sk-|github_pat_|AKIA|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|API_KEY=|TOKEN="
```

- If a match appears, remove it from staged changes before push.

## Stack

TypeScript, Express, React, Vite, Tailwind, Docker, gVisor, pi-mono SDK, Ansible.
# phoung
