# Crush Visual Steal Plan

Steal Crush’s **look and composition** for our React dashboard. Do not run Crush, embed Crush, or depend on Charm’s TUI stack.

Product structure (tabs, outcomes, runs, DB trail) lives in `docs/OUTCOME-HIERARCHY-PLAN.md`. This document is only the visual language. Execution order is `docs/OUTCOME-CRUSH-RUNSHEET.md`.

## Objective

When someone opens an outcome, the center of the screen should feel like Crush’s message stream: warm dark, dense, tool calls as cards, quiet chrome. That stream is **our DB `events` rows**, not a Charm process.

Crush stays a mood board. The new design is ours.

## Locked decisions

- Do not add Crush as a worker, iframe, or PTY theme engine.
- Do not copy Charm logos, wordmarks, or the name “Crush” into the product UI.
- Do not vendor Crush Go UI code (`internal/ui`, Lip Gloss, Bubble Tea). It will not render in React and the Crush license is FSL-1.1-MIT.
- Do approximate Charmtone (Pepper / Char / Butter / Coral / Julep) as **our CSS tokens**.
- Apply the language to the **event trail**, outcome header, project tabs, and compact status — not to a fake terminal skin over ANSI.
- Live PTY remains an optional disclosure, using the same surface tokens so it does not look like a second product.

## What Crush actually is (so we steal the right things)

Crush is a Bubble Tea app styled with Lip Gloss and the Charmtone palette (`charmtone.Pepper`, `Char`, `Iron`, `Sash`, `Butter`, `Coral`, `Julep`, `Charple`, …). The feel comes from:

1. Warm dark surfaces (brown-black, not GitHub `#1F2428` blue-gray).
2. A single vertical stream of typed blocks (user, assistant, tool, shell, status).
3. Tool calls as first-class cards (name, path, short result) instead of a raw log.
4. Almost no sidebar weight; status lives in a thin bar (model, tokens, session).
5. Markdown and syntax color sitting on the same background as the chat.

We already have dark surfaces and an orange accent (`#FF6B35`) in `kanban/web-ui/src/styles/globals.css`. The gap is temperature (still IDE-gray text/borders), layout (left project tree + PTY as the main artifact), and missing tool/event cards.

## Steal list (do)

### 1. Palette — Charmtone-inspired tokens

Map into `@theme` in `kanban/web-ui/src/styles/globals.css`. Keep token **names** ours (`surface-0`, `accent`, …) so components do not speak Charmtone.

Approximate mapping (tune by eye against Crush screenshots; do not require pixel-perfect Charm hex):

| Our token | Crush vibe | Role |
|---|---|---|
| `surface-0` | Pepper | App background |
| `surface-1` | BBQ | Tabs / raised header |
| `surface-2` | Char | Cards, inputs |
| `surface-3` | Iron | Hover / pressed |
| `text-primary` | Sash / Salt | Body |
| `text-secondary` | Smoke | Meta |
| `text-tertiary` | Oyster / Squid | Timestamps, hints |
| `accent` | Warm primary (Butter-adjacent or our existing orange if it still reads as Phuong) | Focus, selected tab, primary actions |
| `status-green` | Julep / Guac | DONE, gate pass |
| `status-red` | Coral / Sriracha | BLOCKED, gate fail |
| `status-orange` / gold | Mustard / Zest | running, concerns |
| `status-cyan` | Malibu / Sardine | tool / shell |
| `status-purple` | Dolly / Blush | Phuong / planner events |
| borders | Char / Iron | Hairline, not bright GitHub gray |

Also update `kanban/web-ui/src/terminal/theme-colors.ts` so the optional PTY matches the same surfaces and selection color.

Keep Geist / system sans for UI. Mono for payloads, paths, and tool names — Crush’s “editorial terminal” mix.

### 2. Composition — one stream of typed cards

Build a trail, not a board and not a full-screen xterm.

Event kinds from the hierarchy plan → card types:

| `events.kind` | Card |
|---|---|
| `user_message` | Quiet right-ish or labeled “You” block |
| `assistant_message` | Markdown body, no chat-bubble chrome |
| `tool_call` | Compact header: tool name + path/args one-liner; collapsible detail |
| `tool_result` | Muted, truncated, expand for full |
| `spawn` | Thin rail: agent, tier, model, run id |
| `status` | Pill: `DONE` / `NEEDS_CONTEXT` / … |
| `gate` | Command + exit code + snippet |
| `artifact` | Thumbnail or filename chip |
| `file_change` | Path + plus/minus |
| `system` | Bare meta |

This is the main thing people mean by “it looks like Crush.”

New components (keep them small, in `kanban/web-ui/src/components/trail/`):

- `trail-stream.tsx` — virtualized list of events
- `trail-card.tsx` — shared padding, hairline, kind color
- `trail-tool-card.tsx`
- `trail-status-pill.tsx`
- `trail-spawn-card.tsx`

Do not implement these as wrappers around the PTY. They consume ledger events.

### 3. Quiet chrome

Steal Crush’s lack of IDE clutter:

- Project switcher as **small top tabs** (see hierarchy plan), not a wide collapsible tree as the hero.
- Outcome title + one-line status in a short header, not a Kanban card stack.
- Thin footer/status: active model, token/cost if we have it, run state. Crush footer energy, our data.
- Shrink `top-bar.tsx` git/shortcut/debug clusters; move rare actions behind one overflow.

### 4. Density and type

- Tighter vertical rhythm than current chat/terminal padding.
- Tool headers 12–13px mono; markdown 14px sans.
- 6–8px card radius (`rounded-md` / `rounded-lg`), not large chat bubbles.
- Syntax highlighting on the same dark field (reuse existing markdown renderer if Cline panel already has one; restyle, do not add a second markdown stack unless needed).

### 5. Motion (minimal)

Crush feels alive because the working state is a small pulse, not a spinner takeover.

- One subtle “working” mark on the active run card.
- No page-level spinners once the trail has rows.
- Stream append, do not reload the list.

## Do not steal

| Item | Why |
|---|---|
| Crush binary / `crush run` | Wrong runtime; fights the DB trail |
| Bubble Tea / Lip Gloss / Glamour | Terminal libraries |
| Charm logo, “Your new coding bestie”, Crush wordmark | Trademark / product identity |
| Hyper provider upsell, model picker chrome copied 1:1 | Their product |
| Full-screen TUI layout with a prompt bang `!` | We are a web conduit + ledger |
| Copy-pasted Go theme structs | License + useless in CSS |
| Catwalk / Charm screenshot assets in the repo | Not our art |

Inspiration from public screenshots is fine. Shipping their UI is not.

## Where it lands in our UI

| Surface | Visual job |
|---|---|
| Project tabs | Charm-quiet nav |
| Outcome header | Title + status pills, no board card |
| Center | Trail stream (the Crush feeling) |
| Nested runs | Small list or chips, not a second sidebar of “chats” |
| Phuong home | Same card language so talk vs watch is one system |
| Optional PTY | Same tokens, visually secondary |

Phuong chat panel (`kanban/web-ui/src/components/phuong/phuong-chat-panel.tsx`) should use the same cards for her messages once her events are in the ledger. Until then, restyle the existing panel to the new tokens so it does not look like leftover Kanban.

## Insertion points

| File | Change |
|---|---|
| `kanban/web-ui/src/styles/globals.css` | Token remap; trail utility classes if Tailwind is awkward |
| `kanban/web-ui/src/terminal/theme-colors.ts` | Match PTY to tokens |
| `kanban/AGENTS.md` | Update the documented design tokens so future UI work does not reintroduce GitHub-blue |
| `kanban/web-ui/src/components/top-bar.tsx` | Compact chrome + tab host |
| `kanban/web-ui/src/components/ui/*` | Buttons/borders follow new contrast |
| `kanban/web-ui/src/components/trail/*` | New (only when events exist) |
| `kanban/web-ui/src/components/detail-panels/cline-markdown-content.tsx` | Candidate markdown restyle for assistant cards |
| `kanban/web-ui/src/components/phuong/phuong-chat-panel.tsx` | Token + density pass |

No backend files belong in this plan except that **without ledger events, the trail cards have nothing honest to show**. Visual work that only reskins xterm is a failed steal.

## Sequencing with the product plan

1. Tokens can land early (safe, isolated). That is the only visual work that should precede the ledger.
2. Trail components need `events` (hierarchy plan). Building fake cards on PTY parse is a dead end.
3. Tab chrome lands with the outcome UX, not as a one-off CSS experiment on the current sidebar.

See `docs/OUTCOME-CRUSH-RUNSHEET.md` for the interleaved order.

## Acceptance

The steal is done when:

- A screenshot of an outcome trail reads as “Crush-like stream” without anyone running Crush.
- Tool calls are cards, not a terminal wallpaper.
- No Crush/Charm branding in the app.
- Phuong and Dashboard share the same tokens and card language.
- Optional PTY looks like a detail view, not the product.

## Reference (mood only)

- Crush repo: https://github.com/charmbracelet/crush
- Charmtone names as used in Crush `internal/ui/styles/themes.go` (read, do not copy into this repo)
- Our current tokens: `kanban/web-ui/src/styles/globals.css`
