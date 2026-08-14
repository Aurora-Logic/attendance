---
name: vyuha-structure
description: Code structure and quality review for Vyuha - module boundaries, layering, shared contracts, the UI constitution, and the Definition of Done. Use when reviewing generated code, before committing multi-file changes, when asked "is this clean", "review the structure", or when deciding where a new piece of code belongs.
---

# Vyuha structure and quality review

The constitution is `CLAUDE.md` at the repo root; this skill is its
enforcement checklist. Review against each section and report findings with
file:line. The goal is that nobody can tell which parts a given session wrote.

## 1. Boundaries

- `platform/` must never import from `modules/`; one module must never import
  another. The authority is the `moduleBoundaries` rule in
  `packages/config/eslint.base.js` - it already covers alias and
  relative-path escapes and pre-registers `crm`/`erp`.
- Run `pnpm --filter @vyuha/api lint` after any cross-directory change; a
  clean lint IS the boundary check, do not re-derive it by eye.
- Attendance-specific logic in a platform module (or platform concerns inside
  `modules/attendance/`) is a finding even when no import crosses - the rule
  is about ownership, not just imports.

## 2. Layering

- Controllers validate (Zod pipe) and delegate. Any business branch in a
  controller is a finding.
- Repositories own SQL. The database may not be touched outside a
  `*.repository.ts` (or the platform db module). Grep for `db.` / `drizzle`
  usage outside repositories to check.
- Request/response shapes live in `packages/shared` as Zod schemas. A type
  declared twice (once in api, once in web) is drift waiting to happen - a
  finding.
- No `any`. No non-null assertion on API data.

## 3. UI constitution

- Every component from shadcn, installed via the shadcn MCP - never pasted
  from memory. Compositions of primitives live in
  `apps/web/src/components/shared/`.
- Zero native form controls in feature code: grep features for
  `<input type="date"`, `<input type="time"`, `<select`, raw `<button`,
  `<table`, `<dialog`. The record-table/form/page-header patterns in
  `components/shared/` are the house patterns - reuse, never fork.
- Icons: the codebase uses `@phosphor-icons/react` throughout, while
  CLAUDE.md still says lucide (OPEN-QUESTIONS P0-6, undecided). Follow the
  codebase (phosphor) for consistency and do NOT "fix" imports back to
  lucide - flag the contradiction instead, the decision is the user's.
- No emojis anywhere. No box-in-box (a card inside a card). Tailwind plus
  theme tokens only - no inline style objects, no CSS modules.
- Every screen works at 360px and 1920px; pickers become sheets on small
  screens; touch targets at least 44px.

## 4. Mock data discipline

- Sample/fixture fallbacks are allowed only as DEV-gated dynamic imports
  behind `import.meta.env.DEV`, and only on reads, and every screen that can
  fall back must render `SampleDataNotice`. The two sanctioned shims are
  `features/attendance/api.ts` and `features/leave/dev-fixture-fallback.ts`.
- A fallback must never stand in for a **record-scoped** read. Invented rows
  are recognisable as a demonstration when they are the organisation's; the
  same rows presented as the history of one named person are a fabrication.
  `useAuditLog` refuses the fallback whenever `entityId` is set.
- The proof is the bundle, not the source: after `pnpm --filter @vyuha/web build`,
  grep `apps/web/dist/assets/*.js` for fixture identifiers - they must be
  absent (the fallback compiles to dead code). A fixture name in the
  production bundle is a hard finding.

## 5. Definition of Done (per task)

From CLAUDE.md, applies without exception:

- Types and lint clean, zero warnings.
- Zod validates every request body; RBAC enforced server-side and reflected
  in the UI (hidden, or disabled with a reason).
- Audit log written for every state-changing action.
- Empty, loading, and error states implemented - not just the happy path.
- Keyboard path works; shortcut registered and hint chip rendered where one
  applies; new shortcuts appear in the Ctrl+F1 sheet automatically via the
  registry.
- Responsive at 360px, verified not assumed.
- Migration reversible; nothing destructive without explicit instruction.
- Unit tests for domain logic, integration test for every new endpoint, REQ
  ID in the commit message.

## 6. Reporting

Rank findings by cost-to-fix-later, not by ease-of-spotting. State plainly
what was checked and what was not. Prefer a fix that deletes a mechanism over
one that adds a special case.
