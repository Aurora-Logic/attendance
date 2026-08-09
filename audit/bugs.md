# audit/bugs.md

Running record. Phase 6 is where this is completed; entries are added as they
are confirmed so nothing is reconstructed from memory later.

A bug is only "fixed" here when it has a regression test named against it.

---

## Fixed in Phase 0

### P0-1 — Seeded credentials shipped in the production bundle *(critical, security)*

**Root cause.** Vite derives `import.meta.env.DEV` from `NODE_ENV`, not from the
build mode, and the repo's `.env` carries `NODE_ENV=development` for the API.
Every `vite build` therefore produced a *development* bundle.

**Failure.** The sign-in page renders a one-click button per seeded account. The
passwords were compiled into `dist/`, so anyone loading a deployed instance was
one click from ADMIN.

```
$ grep -c "admin@delta.dev" apps/web/dist/assets/*.js
index-DkXypHtB.js:1
session-DLaM0Sz_.js:1
```

**Fix.** `apps/web/vite.config.ts` pins `import.meta.env.DEV/PROD` and
`process.env.NODE_ENV` for a production build, so the flags are correct on any
machine whatever a developer's `.env` says. The account list sits behind
`import.meta.env.DEV` and is eliminated with it.

**Regression test.** `apps/web/src/lib/session.dev-accounts.test.ts` — greps the
real build output for every seeded password, and fails if the React refresh
runtime reappears (which would mean the flags are wrong again and the
credential check has quietly stopped meaning anything).

---

### P0-2 — Production build failed; the app could not be deployed *(high)*

Same root cause as P0-1. The development bundle carried React's dev build, so
the entry chunk was 629 kB against the deliberate 600 kB precache budget, and
`vite build` aborted.

**Fix.** As P0-1. Entry chunk 629 kB → 454 kB and the build succeeds.
**Regression test.** Shares P0-1's build assertion.

---

### P0-3 — One paise settled a ₹1,18,000 vendor bill *(critical, money)*

`apps/api/src/ops.ts` `POST /payments` accepted client-supplied allocations with
one check: `amountPaise > allocatable`. That guards over-*payment*, not
over-*allocation*.

```json
{ "amountPaise": 1, "allocations": [{ "docId": "<bill>", "amountPaise": 11800000 }] }
```

1 is not greater than 11800000, so it passed and the bill read as settled.

**Fix.** Allocations are now measured against server-computed outstanding, per
bill, mirroring the already-correct `POST /receipts`: unknown or foreign bill,
non-positive amount, amount over that bill's outstanding, duplicate bill, and
a total that does not equal the payment are each refused.

**Regression tests.** `apps/api/src/ops.test.ts` — six cases, including the
exact attack, plus two that keep honest manual and automatic allocation working.

---

### P0-4 — Any employee could export the whole company's attendance *(critical, security)*

`requirePermission` distinguished only `NONE` and `VIEW`, so `SELF`,
`OWN_TEAM`, `OWN_BRANCH` and `ALL` were all "allowed". `reports.view` is held at
`SELF` by EMPLOYEE and PICKER, and the three `/exports` routes build a
company-wide register with no filtering. Confirmed live: an employee queued a
daily register for the whole company, HTTP 201, and could list everyone's jobs.

**Fix.** The guard takes a `minScope`; routes that cannot narrow results to the
caller's reach declare what they need. The three export routes require full
reach. `/attendance/days`, which already filters through `scopeReaches`, is
untouched.

**Behaviour change to note:** OPERATIONS (`OWN_TEAM`) can no longer export.
The register is company-wide and cannot currently be filtered; the honest fix
is to make the export scope-aware, then relax this.

**Regression tests.** `apps/api/test/api.test.ts` — employee refused on POST and
GET, HR still allowed, and a scope-filtering route confirmed unaffected.

---

### P0-5 — Rate limiting was configured and completely inert *(high, security)*

400 requests to `/health` in seconds: all 200, no `x-ratelimit` headers.
`@fastify/rate-limit` binds through an `onRoute` hook, which only fires for
routes registered *after* the plugin finishes loading; `buildServer` never
awaited the registration, so every route existed first. All four limits were
dead: global 300/min, login 20/min, change-password 5/min, punch 30/min.

Isolated with a three-way comparison:

```
register THEN route         -> {"200":8}
route THEN register         -> {"200":8}
AWAITED register then route -> {"200":5,"429":3}
```

Helmet and CORS survived because they use `onRequest`, which is why every
security header was present and this looked healthy.

**Fix.** `buildServer` is async and awaits the registration.

**Follow-on found by the fix.** 300/min keyed on IP is a whole-company ceiling:
every employee in an office shares one address, and behind a proxy
(`TRUST_PROXY` off by default) they share the proxy's. A single verification
sweep exhausted it. Now keyed by session, with signed-out traffic still keyed
by IP so the login limiter still catches one source spraying many accounts.

**Regression tests.** `apps/api/test/api.test.ts` — login flood reaches 429,
headers present, punch flood throttled, and a spray across many addresses
throttled where the per-email lockout cannot see it.

---

## Fixed in Phase 2

### P2-1 — A wide table's swipe escaped to the browser's back gesture *(high)*

`components/ui/table.tsx` scrolled horizontally with
`overscroll-behavior-x: auto`. Swiping a wide table past its edge chains to the
parent and then to the browser, which on a phone is back-navigation. The
symptom people report is "the page scrolls sideways" even though `<body>` never
moves — which is why a document-overflow check never caught it. Measured at
473px of scroll on `/attendance` at 320px.

**Fix.** `overscroll-x-contain` on the Table container, so it holds for every
table in the product at once.
**Regression test.** `scripts/verify-overflow.mjs` fails on any horizontally
scrollable region lacking containment.

### P2-2 — The punch screen was 448px wide inside a 320px phone *(high)*

A grid item defaults to `min-width: auto`, so a single-column grid is floored by
its content's min-content width. The `lg` track guarded against this with
`minmax(0,1fr)`; the base track did not. The result was a 128px inner scroll on
the one screen a field user opens every day.

**Fix.** `grid-cols-[minmax(0,1fr)]` at the base width in `routes/punch.tsx`.
**Regression test.** `scripts/verify-overflow.mjs` encodes decision B11: on
mobile-first routes nothing may scroll sideways at all, which is stricter than
rule 1.6 and is what rule 5.3 actually asks for. Proved to fail by reverting
the fix.

---

## Confirmed, not yet fixed

### B-0 — Card titles carry no heading semantics *(medium, accessibility)*

Every route has exactly one `<h1>` and no skipped levels — rule 1.4's top-level
requirement already holds, verified across all 27 routes.

But shadcn's `CardTitle` renders a `<div>`. Rule 1.4 wants card titles as H3,
and today the document outline is an H1 and nothing else: a screen-reader user
cannot navigate a screen by its sections.

Not fixed yet on purpose. Promoting `CardTitle` to `<h3>` in isolation would
create H1 → H3 skips, which rule 1.4 also forbids — the section-level H2s have
to exist first. That is per-screen work and belongs in Phase 3, where each
screen is being rebuilt anyway.

### B-2 — Product history has no end-to-end click-through *(low, coverage)*

The rate-history popover (5.8) is covered by 18 unit tests in
`packages/shared/src/product-history.test.ts` and 7 route tests in
`apps/api/test/api.test.ts`, and `scripts/verify-product-history.mjs` proves the
behaviour end to end at the API. What is **not** covered is a browser
click-through of "Apply this rate".

The icon renders only where the document is editable, which today is
`/estimates/new` alone — the estimate detail screen is read-only. Composing
there needs a customer and a product chosen through two pickers, and driving
them reliably is its own piece of work. A test that cannot run is worse than an
acknowledged gap, so this is recorded rather than faked.

Worth deciding separately: **should the history icon appear on a read-only
document too?** Seeing what a customer was last charged is useful even when you
cannot change the line. The order says "when a product is selected on a line,
show an info icon" without restricting it to edit mode.

### B-1 — Leave can be granted past zero, and no one can correct it *(high)*

Employee `e4` holds **CL = −6** (opening +7, availed −13) on the running
instance. The domain treats a negative balance as impossible.

There is also **no endpoint to adjust a leave balance at all** — balances come
only from the seed, so HR cannot grant, accrue or correct one. That is the
Appendix B1 gap showing up as a live defect.

Deferred to Phase 6 with the rest of the leave work. Not patched in Phase 0
because it is a domain change, not a hole in the perimeter.

---

## Recovered from the earlier 18-finder audit — to be re-verified in Phase 6

104 findings were gathered by an 18-way adversarial audit. Its verification
stage is **not trustworthy**: 150 of 227 agents died on a session limit, and
the harness counted a dead verifier as a refutation, so real findings were
misfiled as rejected. The synthesis stage never ran.

All 104 are therefore treated as credible-but-unverified and re-checked in
Phase 6. They are recovered in the workflow journal at
`~/.claude/projects/.../workflows/wf_20da1641-e09/journal.jsonl`.

The ones rated critical by their finder, for triage order:

| Area | Finding | File |
| --- | --- | --- |
| Auth | Logout invalidates nothing; the old refresh token still mints 30-day sessions | `server.ts:561` |
| Auth | Refresh re-mints the OLD role — a demoted user keeps privileges 30 days | `server.ts:482` |
| Attendance | Night-shift punch-out 11+ min past shift end lands on the next date; the night pays zero | `shift.ts:49` |
| Leave | Multi-day leave with `part=FIRST_HALF` debits full days but pays half | `server.ts:1592` |
| Leave | A decided approval stays PENDING in Postgres while its ledger debit lands | `repositories.ts:243` |
| Persistence | `hydrateFromDb` silently deletes store rows that never reached Postgres | `repositories.ts:383` |
| Tally | Company-mismatch guard is disarmed by the heartbeat preceding every push | `tally.ts:119` |
| Tally | First sync of a company with >2000 masters is dropped permanently | `agent.ts:235` |
| Fulfilment | E-way bill threshold compared against freight, not consignment value | `fulfilment.ts:368` |
| Web | Punch page never derives `punchedIn` from the server; punch-out posts a second punch-in | `punch.tsx:231` |
| Web | Settings never read from the API; Save writes localStorage over the server's config | `settings.tsx:497` |
| Web | Guards enforce a compiled-in permission matrix, never the server's live one | `session.tsx:91` |

Six further findings concern payroll and are deleted outright by Section 2.

---

## Test-hygiene defects found in my own verification

- `scripts/verify-notifications.mjs` hardcoded leave type CL and consumed a
  day's balance on every run, so it eventually failed with
  `INSUFFICIENT_BALANCE` and looked like a product fault — while masking the
  real one above. It now reads the balances first, picks a type with cover, and
  uses a distinct date per run so a second run is not an overlapping duplicate.
- Same class as two earlier cases: a verification script that depends on
  accumulated state stops testing and starts reporting its own leftovers.
