# Setu — Specification Package

Workforce attendance platform. Attendance now; CRM and Tally-backed ERP later, on the same foundation.

## What's here

| File | Put it | What it's for |
|---|---|---|
| `CLAUDE.md` | **Repo root** | Standing rules Claude Code reads every session. shadcn-only, no natives, no emoji, Definition of Done. |
| `01-product-requirements.md` | `/docs` | Every functional requirement, numbered `REQ-x-nn`. The source of truth for *what* gets built. |
| `02-technical-design.md` | `/docs` | Architecture, stack, full data model, APIs, photo pipeline, keyboard layer, Tally seams, security. |
| `03-scope-and-delivery-plan.md` | `/docs` | Phases 0–5 with acceptance criteria, exit gates, and risks. |
| `04-questionnaire.md` | `/docs` | 158 discovery questions. Partly answered — the rest are still open. |
| `05-decisions.md` | `/docs` | **Confirmed answers. Overrides any assumed default in 01–03.** Read this first. |

## Setup

```bash
mkdir setu && cd setu
git init
mkdir docs
# CLAUDE.md at root, 01–05 into docs/
```

Then open Claude Code and give it this:

> Read CLAUDE.md, then docs/05-decisions.md, then docs/01, 02, 03 in full.
> 05-decisions.md overrides any assumed default in the other documents.
> Confirm the open items in 05 §"Still open" that block Phase 0, then begin
> Phase 0 from docs/03. Work in vertical slices, reference REQ IDs in commits,
> and install every component through the shadcn MCP.

## Before Phase 1 can finish, I need from you

1. Office Google Maps link (for the 100 m geofence centre)
2. General shift timings — in, out, break
3. Office IP address(es), for the web punch allowlist

## Before Phase 2

4. Leave types with entitlement, carry-forward cap, negative limit, notice days

## Before Phase 3

5. Who runs payroll, and the exact columns they need each month
6. Attendance cycle — calendar month, or a cutoff like 26th–25th

## Non-negotiables, in one line each

- Every component from shadcn, installed via the shadcn MCP. Nothing native, including date pickers.
- Fully responsive; pickers become bottom sheets on phones; 44px touch targets.
- No emojis. Icons only.
- No card inside a card. One hierarchy across all 19 screens.
- TallyPrime keyboard parity, hint chip on every shortcut.
- Punch photos compressed automatically; lists load thumbnails only.
- Admin has full CRUD everywhere — except punches and the audit log, which are append-only and corrected by voiding, not editing.
- No salary, tax, or money calculation. Ever.
