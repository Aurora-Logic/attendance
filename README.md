# Delta Attendance

Employee attendance, leave and payroll system for a small-to-mid Indian company.
Build brief: [attendance-system-claude-code-prompt.md](attendance-system-claude-code-prompt.md).
Business rules and their defaults: [DECISIONS.md](DECISIONS.md).
Where this is heading — the full ERP module map and wave plan: [ECOSYSTEM.md](ECOSYSTEM.md).

**Current state:** production-shaped. React 19 web app, Fastify API with JWT auth
and a capability matrix, Postgres via Prisma for attendance truth, Redis-backed
export worker, 249 tests, and a Playwright sweep over 26 routes at four viewport
widths.
## Requirements

- Node 20+ (developed on 24.15)
- pnpm 10+
- Docker, for Postgres / Redis / MinIO (`pnpm infra:up`)

## Setup

```bash
pnpm install
cp .env.example .env
pnpm infra:up       # postgres :5433, redis :6379, minio :9000 (console :9001)
pnpm --filter @attendance/api exec prisma migrate deploy
pnpm dev:api        # http://localhost:3000
pnpm dev            # http://localhost:5177
```

Postgres is mapped to **5433** so it does not collide with a local 5432.

## Layout

```
apps/web              React 19 + Vite 8 + TypeScript, shadcn/ui
apps/api              Fastify 5 — JWT auth, permission matrix, punches/leave/approvals,
                      payroll, exports, Tally. Postgres via Prisma 7 for attendance
                      truth; a JSON store file carries what has no table yet.
packages/shared       The domain: day-computation engine, late policy, leave maths,
                      payroll paise maths, geofencing, RBAC matrix, procurement
docker-compose.yml    Postgres 17 + Redis 7 + MinIO, with the selfie bucket seeded
```

`packages/shared` is the single source of truth for the API contract. Both sides
import the same Zod schemas; there is no hand-maintained type duplication.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Web app in dev mode (:5177) |
| `pnpm dev:api` | API in watch mode (:3000) |
| `pnpm build` | Build every workspace package |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | 249 tests: 155 shared · 23 web · 71 api |
| `pnpm lint` | oxlint |
| `pnpm infra:up` / `infra:down` | Postgres, Redis and MinIO via Docker |
| `node scripts/verify-ui.mjs` | Playwright sweep: 26 routes × 4 viewports, fails on any console error or horizontal overflow |

Demo logins (development seed): `admin@delta.dev / Admin@123`, `hr@delta.dev / Hr@12345`,
`ops@delta.dev / Ops@1234`, `employee@delta.dev / Emp@1234`. **Change these before
any real deployment** — see the checklist below.

## What works end to end

Punching (camera selfie, live GPS geofence, offline IndexedDB queue that replays on
reconnect), the late/half-day/overtime engine, leave with a real balance ledger,
approvals with scope-aware routing, the roster generated from rules, month lock →
immutable payroll runs in exact paise, payslips, the bank transfer sheet, Tally
vouchers, server-side Excel exports on a BullMQ worker, an append-only audit log in
Postgres, a capability matrix enforced identically by the UI and the API, and the
procurement → sales → stock → expenses modules.

Attendance truth (punches, approvals, the leave ledger, declared calendar days,
month locks, audit rows) lives in Postgres. Anything without a table yet round-trips
through a JSON store file, written atomically.

## Deploying

### 1. Configure

Copy `.env.example` to `.env` and set, at minimum:

```bash
NODE_ENV=production
JWT_ACCESS_SECRET=$(openssl rand -base64 48)   # under 32 chars → the API refuses to start
CORS_ORIGINS=https://attendance.yourcompany.com
DATABASE_URL=postgresql://user:pass@host:5432/attendance
VITE_API_URL=https://api.yourcompany.com       # a production web build fails without this
```

`NODE_ENV=production` also turns on `Secure` auth cookies and the CORS allowlist.

### 2. Build and run

```bash
pnpm install --frozen-lockfile
pnpm --filter @attendance/api exec prisma migrate deploy
pnpm build                       # web → apps/web/dist, api → apps/api/dist
node apps/api/dist/index.js      # or: pnpm --filter @attendance/api start
```

Serve `apps/web/dist` as static files behind any web server. The API handles
`SIGTERM`/`SIGINT` by draining in-flight requests, closing the export worker and
flushing the store — safe for rolling restarts.

### 3. First-run checklist

1. Sign in as the seeded admin and immediately change the password
   (`POST /auth/change-password`, or the account menu).
2. Reset or remove the other seeded logins.
3. Settings → Branding: company name and logo.
4. Settings → Departments, Roster, and the attendance rules.
5. Settings → Tally: company and ledger names (see the in-app guide).
6. Payroll → Bank details for each employee, and the debit account in settings.
7. Back up **both** Postgres and `apps/api/.data/store.json` — the store file holds
   what has no table yet, and a corrupt one stops the API rather than silently
   reseeding over live records.

### Security posture

JWT access (15 min) and refresh (30 days) in `httpOnly` cookies, `Secure` in
production; bcrypt password hashing with per-user change and admin reset; login
lockout after five failures; global and per-route rate limits; `helmet` security
headers; an explicit CORS allowlist; a capability matrix checked server-side on
every route; and an append-only audit log. Bank account numbers are masked in every
read and never written to the audit log in full.

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
