# Hermes front-end for Phuong

Hermes is the always-on talk layer on the same VPS as Phuong. You message Hermes; it creates/starts project chats through `phuong-ctl`. You can still use the Dashboard manually — both paths share the same board.

```text
You ↔ Hermes (CLI / optional Telegram gateway)
         └─ phuong-ctl → Phuong (:3484) → Pi workers

You ↔ Dashboard (manual New Chat) ─────────────↗
```

## Repeatable deploy

With `deploy/.env` filled (at least `ZAI_API_KEY`):

```bash
cd deploy
./deploy.sh kanban    # Phuong runtime + Hermes + phuong-ctl
# or refresh Hermes only:
./deploy.sh hermes
```

What Ansible does each time:

1. Installs/updates Hermes non-interactively (`--skip-setup --non-interactive`)
2. Writes `~/.hermes/config.yaml` (`HERMES_PROVIDER` / `HERMES_MODEL`)
3. Writes `~/.hermes/.env` — maps `ZAI_API_KEY` → `GLM_API_KEY`
4. Installs `SOUL.md` + `skills/phuong`
5. Installs `/usr/local/bin/phuong-ctl` and `/usr/local/bin/kanban`
6. Installs `hermes.service` — **starts only if** `TELEGRAM_BOT_TOKEN` is set

## Day-to-day

```bash
# On the VPS
phuong-ctl health
phuong-ctl projects
hermes                 # interactive CLI talk

# Create + start a Pi chat for decipher
phuong-ctl create --project decipher --tier T1 --start --prompt "..."
```

## Telegram (optional)

Add to `deploy/.env`:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USERS=your_telegram_user_id
```

Then `./deploy.sh hermes` — gateway unit starts and Hermes is reachable from your phone.

## Isolation

- Hermes data: `/root/.hermes`
- Phuong runtime: `/opt/kanban` (systemd `kanban`)
- Repos: `/opt/repos`
- Do not reuse another product's Hermes home or ports on this host
