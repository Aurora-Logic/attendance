# Delta Attendance

Employee attendance, leave and payroll system for a small-to-mid Indian company.
Build brief: [attendance-system-claude-code-prompt.md](attendance-system-claude-code-prompt.md).
Business rules and their defaults: [DECISIONS.md](DECISIONS.md).

**Current state: Phase 0 complete.** UI shell, theme, shared table and seeded demo
data. No backend yet — Phase 1 brings the schema, auth and RBAC.

## Requirements

- Node 20+ (developed on 24.15)
- pnpm 10+
- Docker (for Postgres / Redis / MinIO — **not yet installed on this machine**)

## Setup

```bash
pnpm install
cp .env.example .env
pnpm dev            # http://localhost:5173
```

Infrastructure (needed from Phase 1 onward):

```bash
pnpm infra:up       # postgres :5432, redis :6379, minio :9000 (console :9001)
pnpm infra:down
```

## Layout

```
apps/web              React 19 + Vite 8 + TypeScript, shadcn/ui
packages/shared       Zod schemas, status enums, settings defaults, money helpers
docker-compose.yml    Postgres 17 + Redis 7 + MinIO, with the selfie bucket seeded
```

`packages/shared` is the single source of truth for the API contract. Both sides
import the same Zod schemas; there is no hand-maintained type duplication.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Web app in dev mode |
| `pnpm build` | Build every workspace package |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm lint` | oxlint |
| `pnpm infra:up` / `infra:down` | Docker services |

## What works right now

- App shell: collapsible sidebar, header with breadcrumb, light/dark/system toggle
- Dashboard with stat cards and a stacked weekly chart (seeded numbers)
- Daily Register: the shared `DataTable` with sort, search, column visibility,
  row selection, pagination, skeleton loading and an empty state
- Every planned route resolves, labelled with the phase that delivers it

## What is stubbed

Everything else. No API, no database, no auth — the dashboard and register read
from `apps/web/src/lib/seed.ts`, which produces data in the exact `attendance_days`
shape so Phase 3 swaps in TanStack Query and deletes nothing else.

## UI conventions

Read [DECISIONS.md §3](DECISIONS.md) before touching a component. In short:
registry components are used unmodified, `className` is for layout only, sizes come
from the registry's own tokens, and colours come from semantic CSS variables.

Adding a component:

```bash
cd apps/web && pnpm dlx shadcn@latest add @shadcn/<name>
```

Two things that look like components but are not — build them from the
documented composition instead:

- `data-table` → `table` + TanStack Table v8 (already built, reuse it)
- `date-picker` → `popover` + `calendar`
- `form` → `field` + React Hook Form `Controller`
