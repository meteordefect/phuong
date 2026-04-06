# Memory Separation Plan

## Goal

Separate Phuong's memory files into their own Git repository (`meteordefect/base-control`) so the brain is independent of the application code. The memory is the most valuable asset — it should outlive any specific tool, be portable, backed up, and version-controlled independently.

## Why

- **Portability** — If we outgrow Phuong or build a v2, the memory repo just gets pointed at the new system. Knowledge persists.
- **Backup** — A cron auto-commits and pushes hourly. Full git history of every decision, memory, and conversation.
- **Multi-device** — VPS runs the primary. Local can pull the same repo for read access or running Phuong locally.
- **Clean deploys** — `clawdeploy` can be torn down and redeployed without touching the brain.
- **Audit trail** — Git blame shows when Phuong learned something and in what context.

## What Moves

Everything currently in `clawdeploy/memory/` moves to `base-control`:

```
base-control/
├── system-prompt.md
├── subagent-prompt.md
├── overview.md
├── skills/
│   ├── review/SKILL.md
│   ├── plan/SKILL.md
│   ├── qa/SKILL.md
│   └── ship/SKILL.md
├── projects/
│   └── phuong/
│       ├── context.md
│       ├── memories/
│       ├── conversations/
│       └── tasks/
│           ├── active/
│           └── completed/
├── org/
│   ├── decisions/
│   └── strategy/
├── general/
│   ├── conversations/
│   └── memories/
├── research/
├── conversations/
│   └── inbox/
└── logs/
```

## What Stays

`clawdeploy` keeps all application code:

```
clawdeploy/
├── main-agent/        (API server)
├── review-ui/         (chat UI)
├── subagent/          (Docker worker image)
├── deploy/            (deployment stack)
├── docker-compose.yml
├── nginx.conf
├── .env
└── docs/
```

## Implementation Steps

### Prerequisites
- Deploy clawdeploy with all current changes first
- Verify everything works on the VPS

### Step 1: Initialize the memory repo on the VPS

```bash
cd /path/to/deployed/memory
git init
git remote add origin git@github.com:meteordefect/base-control.git
git add -A
git commit -m "initial: seed memory from clawdeploy"
git push -u origin main
```

### Step 2: Clone to a standalone location

```bash
# Clone to a permanent location outside clawdeploy
git clone git@github.com:meteordefect/base-control.git /data/phuong-memory
```

### Step 3: Update clawdeploy config

In `.env`:
```
MEMORY_DIR=/data/phuong-memory
```

In `docker-compose.yml`, update the volume mount for the API container:
```yaml
volumes:
  - /data/phuong-memory:/app/memory
```

### Step 4: Restart containers

```bash
docker compose down && docker compose up -d
```

### Step 5: Verify

- Open the review-ui, start a conversation — confirm Phuong loads its system prompt and knows its projects
- Check that modes show up (the skills are loading from the new location)
- Confirm task listing works

### Step 6: Remove memory from clawdeploy

Once verified, remove the `memory/` directory from `clawdeploy` and add it to `.gitignore`:

```bash
# In clawdeploy repo
echo "memory/" >> .gitignore
git rm -r --cached memory/
git commit -m "chore: move memory to base-control repo"
git push
```

### Step 7: Set up auto-backup cron

On the VPS:

```bash
# /etc/cron.d/phuong-memory-backup
0 * * * * cd /data/phuong-memory && git add -A && git diff --cached --quiet || git commit -m "auto: $(date -u +\%Y-\%m-\%dT\%H:\%M)" && git push
```

This runs hourly, only commits when there are actual changes.

## Future Considerations

- **Local development**: Clone `base-control` locally, point `MEMORY_DIR` at it, run Phuong in simple mode without Docker
- **Multiple agents**: Other tools or agents could read/write to the same memory repo
- **Memory pruning**: Old conversation logs and completed tasks could be archived to a separate branch or pruned periodically to keep the repo lean
