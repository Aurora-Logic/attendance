# Deployment

Three documents, and it matters which you are in:

| Document | Answers |
|---|---|
| **This one** | What is this build, is it ready, and what does it need from us? |
| `DEPLOY-CHECKLIST.md` | The one-time path from an empty VPS to employees punching. |
| `RUNBOOK.md` | Running it afterwards — start, stop, logs, backup, restore. |

Read this one first. The checklist assumes the answer here is yes.

---

## What you are deploying

A workforce attendance web application for **G C Communication**, Nashik:
punch in and out with a photograph and a geofence, shift rules, leave,
holidays, approvals, thirteen reports, and Excel export. Payroll is **not** run
here — the product produces the inputs and hands them off.

It is a monorepo: a NestJS API, a React web app installable as a PWA, and a
shared contract package that both compile against. PostgreSQL, Redis, and
S3-compatible object storage for punch photographs.

## Is it ready?

**The code is.** Every requirement ID in the PRD is implemented except
`REQ-J-04` Payroll Input, which the client dropped. At the last full run:

```
API      1591 tests    86 files
Web       400 tests    28 files
Shared     41 tests
typecheck  clean       lint clean
production build       clean
```

**What is verified, and how** — because "tests pass" and "it works" are
different claims:

- **Every route**, driven in a real browser: 22 routes, no 4xx/5xx, no console
  exceptions, no horizontal overflow, at 1440px and 360px.
- **Every create flow**, read back from the API rather than from a toast — a
  screen that renders perfectly and saves nothing passes a structural check.
- **NFR-02**, benchmarked against the dataset the requirement names: 500
  employees × 24 months = 365,000 attendance days. Worst first-page latency
  **54ms** over a month, **345ms** over the full two years, against a 1.5s
  limit. Re-runnable: `apps/api/bench/`.
- **Excel export**, by downloading a produced file and opening it: real zip,
  frozen header, autofilter, column widths, header block, generated-at on the
  organisation's clock.
- **Touch targets**, with `(pointer: coarse)` asserted before measuring, in
  both dimensions.

**Security.** Three review passes. The most recent found nothing at its
reporting bar and is auditable — it enumerated every export section against its
own SQL, ran `EXPLAIN` on the live database, and grepped every XSS sink. The
pass before it found three High findings, all fixed and each proven by a test
that fails without its fix. Worth knowing: the *second* pass found that two of
the first pass's fixes had reintroduced the same defect one step away. **A
single clean review is not evidence; run one more against whatever lands after
this.**

## What it still needs from you

Nothing in this list is code. Deployment is blocked on it anyway.

| # | Input | Without it |
|---|---|---|
| 1 | VPS, domain, DNS already pointing at it | No TLS, no deploy. DNS propagation is the slowest thing here — do it first. |
| 2 | Object storage: Cloudflare R2 credentials, or the decision to run MinIO on the box | No punch photographs |
| 3 | The employee roster, in the bulk-import format | An empty muster on day one |
| 4 | **Opening leave balances per employee** | The accrual job runs on the 1st and cannot reconstruct the year behind it. Balances that start wrong stay wrong. |
| 5 | This year's holiday list | Every holiday computes as a working day and shows as absence |
| 6 | Real leave types: entitlement, carry-forward cap, negative limit, notice days | Placeholder types reach production |
| 7 | Real shift timings — in, out, break | The placeholder General shift judges every punch |
| 8 | Office coordinates and geofence radius | Mobile punch geofencing cannot be enabled |

Items 5–8 are set in the app, as the administrator, not with SQL. The checklist
§4 walks through them.

## Things that will surprise you if nobody says them

**The seed creates one employee, not twenty-five.** `VY-0001`, named
"Administrator", is the record the seeded login acts as — rename it to yourself.
The twenty-five example people are a developer convenience and are off unless
`--with-example-people` is passed. They were on by default until recently, and
would have appeared in your muster and every export, undeletable the moment
anything referenced them.

**There is no email.** Invitations and password resets are links the
administrator copies out of the app and passes on. There is no self-service
"forgot password" — a locked-out person asks an administrator.

**Punches and the leave ledger are append-only**, enforced by database
triggers. This is deliberate: attendance history cannot be erased by deleting
the person it belongs to. The practical consequence is that an employee with
punches can only be *retired*, never deleted, and a database with test punches
in it cannot be cleaned by deleting rows — it needs a fresh database.

**Do not run the API test suite twice at once.** Each test file resets its own
organisation, so two runs delete each other's rows and the failures appear in
leave accrual, in code nobody touched. A Postgres advisory lock now refuses the
second run with a message saying so, rather than letting both corrupt each
other.

**Deploy to a fresh database.** Migrations plus the seed. Nothing from a
development database travels, and nothing should.

## Order of operations

1. Read this document. Confirm the eight inputs above are in hand.
2. `DEPLOY-CHECKLIST.md` §1–§3 — VPS, TLS, migrate, seed, first administrator.
3. `DEPLOY-CHECKLIST.md` §4 — load your data, in the app.
4. `DEPLOY-CHECKLIST.md` §5 — **invite one person and have them complete it end
   to end** before inviting anyone else. One failed invitation is a fix; forty
   is an incident.
5. `DEPLOY-CHECKLIST.md` §6 — the verification list, including a **restore into
   a scratch database**. A backup that has never been restored is a hope.
6. `RUNBOOK.md` from then on.

## What day one does not include

Stated in full in `DEPLOY-CHECKLIST.md` §7. In short: Payroll Input, email,
TOTP, and the TallyPrime, CRM and ERP modules. Scheduled exports run but
deliver to the Downloads tray rather than to an inbox.

One open policy question, `REQ-G-10`: cancelling leave on or after its start
date still needs an approver key rather than raising an approval request. It
changes who may cancel, so it is the client's decision rather than a defect.

## If something is wrong

`RUNBOOK.md` covers logs, health, the job monitor, backup and restore.
`GET /api/v1/ready` names the dependency that is down rather than failing
generically. Production errors currently live in `vy logs api` and nowhere
else — error tracking is deferred pending a decision on adding Sentry, and it
is worth watching those logs directly for the first few days.

`docs/OPEN-QUESTIONS.md` carries every decision that was deferred rather than
guessed, with the recommended default that is currently in force.
