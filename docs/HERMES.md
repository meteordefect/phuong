# Hermes product model

Hermes (Phuong) is the always-on manager on the VPS. The Dashboard is optional.

## Dual entry (either works)

| Entry | Role |
|-------|------|
| **Hermes** | Primary conduit. User talks here from phone or desktop. She plans, creates project chats, routes models, runs gates, attaches artifacts, and reports. |
| **Dashboard** | Optional ledger. Project → chat grouping for logical browsing. Worker chats are **watch-only** by default (observe, do not interject). |

Users can live entirely in Hermes chat and never open Dashboard. They can also open Dashboard to watch live Pi sessions and E2E screenshots without typing into workers.

## Flow

```text
You (phone / desktop) ──message──► Hermes (VPS)
                                      │
                                      ├─ create_chat(tier=T0|T1|T2|T3) under project
                                      ├─ Pi workers in worktrees (model by tier)
                                      ├─ run_gate / attach_artifact
                                      └─ report in Hermes chat

Dashboard ◄── same chats & artifacts (watch-only)
```

## Model tiers

| Tier | Meaning | Default model (override via env) |
|------|---------|----------------------------------|
| T0 | Mechanical / boilerplate | `PHUONG_MODEL_T0` → `kimi-coding/kimi-k2.7` |
| T1 | Standard | `PHUONG_MODEL_T1` → `SUBAGENT_MODEL` / `DEFAULT_MODEL` / light |
| T2 | Complex | `PHUONG_MODEL_T2` → `kimi-coding/kimi-k3` |
| T3 | High-risk | `PHUONG_MODEL_T3` → `kimi-coding/kimi-k3` |

Set on the VPS:

```bash
PHUONG_MODEL_T0=kimi-coding/kimi-k2.7
PHUONG_MODEL_T1=kimi-coding/kimi-k2.7
PHUONG_MODEL_T2=kimi-coding/kimi-k3
PHUONG_MODEL_T3=kimi-coding/kimi-k3
KIMI_API_KEY=...
```

## Watch vs interject

Worker chats open **read-only**. Banner: “Watching — Hermes is handling this.”  
**Interject** unlocks input when the user explicitly wants to type into a worker. Prefer staying in Hermes.

## Artifacts

Hermes can `attach_artifact` paths under a chat worktree (e.g. `.phuong/artifacts/login.png`). Artifacts appear on the Dashboard chat view for phone/desktop review of E2E proof.

## Related plans

- `docs/PHUONG-ORCHESTRATE-ADOPTION-PLAN.md` — orchestration protocol
- `docs/BUILD-RUNSHEET.md` — build phases
- `docs/DEPLOY-HETZNER.md` — new VPS deploy
