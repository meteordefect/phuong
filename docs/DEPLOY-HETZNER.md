# Deploy Phuong to a new Hetzner VPS

Own control plane for **this** Phuong stack only. Do not install onto a host that already runs another agent product under shared paths/ports.

Use existing SSH deploy keys from prior FriendLabs deploys when possible.

## Prerequisites

- Hetzner Cloud API token
- SSH key already in Hetzner **or** local key at `~/.ssh/friendlabs-deploy` (see `deploy/ansible/inventory.ini.example`)
- Domain DNS ready (optional but recommended for TLS) — use a **Phuong-specific** hostname
- Secrets: Clerk, `KIMI_API_KEY`, `ZAI_API_KEY` (optional), GitHub token if needed

## 1. Provision the server

```bash
cd deploy
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# set hcloud_token, and either:
#   use_existing_ssh_key = "your-existing-hetzner-key-name"
# or ssh_public_key = "~/.ssh/friendlabs-deploy.pub"
#
# Prefer a dedicated server_name, e.g. phuong-control-plane (default)

./deploy.sh terraform-init
./deploy.sh terraform-apply
```

Terraform writes the new IP into Ansible inventory when apply succeeds.

## 2. Inventory & env

```bash
cd deploy
# inventory.ini should point at the new IP
# ansible_ssh_private_key_file=~/.ssh/friendlabs-deploy

cp .env.example .env   # if present; otherwise create from previous VPS .env
# Required highlights:
# DOMAIN=phuong.your.host   # Phuong-only hostname
# KIMI_API_KEY=...
# PHUONG_MODEL_T0=kimi-coding/kimi-k2.7
# PHUONG_MODEL_T2=kimi-coding/kimi-k3
# PHUONG_MODEL_T3=kimi-coding/kimi-k3
# DEFAULT_MODEL=...   # Phuong's own model
# SUBAGENT_MODEL=...  # fallback for T1 / unset tiers
# Clerk publishable + secret keys for the UI build
```

Install under `/opt/phuong` (Ansible default). Do not reuse another product's data directories.

## 3. Deploy app

```bash
cd deploy
./deploy.sh kanban   # or full site playbook
# status:
./deploy.sh status
```

Playbooks live under `deploy/ansible/playbooks/` (`kanban-deploy.yml`, `site.yml`).

## 4. Smoke check

1. Open `https://$DOMAIN` (or server IP) — Clerk login.
2. **Phuong** is the default home: message her to create work.
3. Open **Dashboard**, click a chat — watch-only terminal, no accidental interject.
4. Confirm Pi starts with tier models (`journalctl -u kanban` / agent logs).

## Dual access reminder

- **Phuong** = conduit (talk only to her)
- **Dashboard** = optional project/chat ledger + live watch + artifacts

Either path is enough; both always stay in sync because Phuong writes the same project chats the Dashboard lists.

## Reusing previous keys

If the prior VPS used `friendlabs-deploy`:

```hcl
# terraform.tfvars
use_existing_ssh_key = "friendlabs-deploy"  # exact name in Hetzner console
```

Ansible:

```ini
ansible_ssh_private_key_file=~/.ssh/friendlabs-deploy
```

Do **not** commit private keys or `.env` files.

## Netcup (manual VPS, no Terraform)

If the box is already provisioned (e.g. netcup Debian):

1. Put your deploy private key at `~/.ssh/friendlabs-deploy` (or set `SSH_KEY`).
2. Install the matching public key in `root`'s `authorized_keys` on the VPS.
3. Create `deploy/ansible/inventory.ini` from the example and set `ansible_host` to the VPS IP.
4. Copy `deploy/.env.example` → `deploy/.env` and fill Clerk + LLM keys. Leave `DOMAIN=` empty for plain HTTP on the IP; set `DOMAIN` + DNS for TLS.
5. From `deploy/`: `./deploy.sh kanban`

Current netcup target (Aug 2026): `159.195.213.113` / `v2202608386140495566.powersrv.de`.

## Hermes front-end (repeatable)

`./deploy.sh kanban` also installs Hermes when `ZAI_API_KEY` (or another LLM key) is set in `deploy/.env`. See `docs/HERMES-FRONT-END.md`.
