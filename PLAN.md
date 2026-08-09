# Execution plan — Full Product Hardening Pass

Status: **approved. Phase 0 in progress.**

Decisions taken (2026-08-09):
- **A —** Phase 0 runs first: public admin login, payment over-allocation,
  `requirePermission` reach, broken production build, dead rate limiting.
- **B —** Print documents (`components/*-document.tsx`) are exempt from the
  no-native-`<table>` rule, with the reason recorded in the ESLint config.
- **C —** The emoji gate covers JSX text and string literals only, not comments.
- **B11 —** Punch is mobile-first at 320px. Dispatch board and procurement
  analytics are desktop-only below 1024px, with an honest message rather than a
  squeezed layout. Everything else is fully responsive.

Baseline commit: `5836e79`. Working tree clean.

---

## 0. What I did before writing this

Read the work order end to end, then measured the things it asks me to fix so
the plan carries real numbers rather than estimates.

| Measured | Result |
| --- | --- |
| Native-control violations outside `components/ui/` | **53** across 6 files |
| Emoji/dingbat occurrences in source | **177**, of which **1** is user-visible |
| ESLint | **not configured anywhere** — no config at root or in any package |
| Production web build | **fails** — cannot deploy today |
| Rate limiting | **completely inert** — all four configured limits dead |
| Bug audit (18 parallel finders, completed earlier) | **104 findings**, 20 rated critical |

The line-by-line audit output becomes `audit/native-components.md` in Phase 1.

---

## 1. STOP-AND-ASK — three things I will not decide for you

The work order says to raise conflicts rather than guess. These block me.

### A. There is a critical live vulnerability. It outranks the whole work order.

`apps/web/src/routes/login.tsx` renders one-click sign-in buttons for every
seeded account, and the real passwords are compiled into the client bundle:

```
$ grep -c "admin@delta.dev" apps/web/dist/assets/*.js
apps/web/dist/assets/index-DkXypHtB.js:1
apps/web/dist/assets/session-DLaM0Sz_.js:1
```

Anyone who loads the deployed app is one click from ADMIN. It is not
dev-gated. Two more of the same severity, both reproduced:

- `POST /payments` validates only over-*payment*, never over-*allocation*.
  `{amountPaise: 1, allocations:[{docId: <₹1,18,000 bill>, amountPaise: 11800000}]}`
  passes and settles the bill for one paise. (`apps/api/src/ops.ts:125`)
- `requirePermission` only distinguishes `NONE` and `VIEW`. `SELF`,
  `OWN_TEAM`, `OWN_BRANCH` and `ALL` are all treated as "allowed", so a
  capability granted at SELF scope reads company-wide data.
  (`apps/api/src/server.ts:302`)

**Proposal: a Phase 0 ahead of everything, fixing only these three plus the
broken build and the dead rate limiting.** Days of UI work while the login page
hands out admin is the wrong order. Say the word and Phase 0 starts immediately.

### B. Print documents vs. "no native `<table>`"

38 of the 53 native-control violations are `<table>` / `<td>` / `<th>` /
`<textarea>` inside `po-document.tsx` and `estimate-document.tsx` — the
**printable** PO and estimate. shadcn `Table` wraps content in an
`overflow-x-auto` div, which breaks print pagination: a long table stops
splitting across pages.

**Options:**
1. Exempt `components/*-document.tsx` from the rule, documented in the ESLint
   config as a print-only carve-out. *(my recommendation)*
2. Convert them and accept that a PO longer than one page prints wrong.
3. Build a separate print-table primitive in `components/ui/`.

### C. "No emoji" — comments or only UI copy?

Of 177 hits, 173 are `→` inside code comments (`pick → pack → dispatch`). One
is user-visible (`✓` in `fulfilment-dispatch.tsx:350`, which I wrote).

1.3 says "strip every emoji from UI copy…" but also "fail the build on any hit
in `src/`". Those disagree.

**Options:**
1. Enforce on JSX text and string literals only; leave comments alone.
   *(my recommendation — 1 fix instead of 174, and comment arrows aid reading)*
2. Enforce on everything, including comments.

### D. Two things I cannot run myself

- **`/ultrareview` (Phase 7)** is user-triggered and billed; I cannot launch it.
  When we reach Phase 7 you run `/code-review ultra`, and I act on the output.
- **`/loop` (after every phase)** is a scheduler, not a test runner. I read
  "run `/loop` until it comes back clean" as *run the exhaustive
  find-bugs-and-fix cycle until a full pass finds nothing new*, which is what
  the earlier 18-finder audit did. Confirm that reading.

---

## 2. Phase order and what each delivers

Each phase ends with the full verification gate: `pnpm -r test`,
`pnpm -r typecheck`, the Playwright sweep, the interaction suite, then the
bug-hunt loop until a clean pass. Then a summary, then the next phase.

### Phase 0 — Critical security and deployability *(proposed; not in the order)*
Public admin login removed; payment allocation validated; `requirePermission`
enforces reach; production build restored under the 600 KB shell budget; rate
limiting actually bound. Regression test for each.

### Phase 1 — Component audit and replacement
`audit/native-components.md` first (full list, before any fix). Replacements
pulled through the shadcn MCP. Compose the time picker from `Popover` +
`Command` per 1.2. ESLint installed and configured — **new dependency**:
`eslint`, `typescript-eslint`, `eslint-plugin-react` (nothing is configured
today), with `react/forbid-elements` failing the build. Emoji check wired to
the same gate.

### Phase 2 — Layout, overflow, responsiveness
`AppShell` / `PageHeader` / `PageToolbar` / `PageContent` built and every route
migrated. Playwright overflow test at all 8 breakpoints, failing CI. Settings
and mobile punch overflow fixed. 1.5 box-in-box applied per screen as migrated.

### Phase 3 — Screen work
Reports, Dispatch board, Punch (mobile), Procurement analytics, Roles &
permissions, Calculator, notification badge, product history on estimate/PO
lines. Every screen checked against the apple-design skill, not only these.

### Phase 4 — Tally keyboard parity
Real TallyPrime keys per Section 6, the contextual action panel, Indian number
formatting, expression-evaluating amount fields, short-form date entry, PWA
install path. `docs/keyboard-shortcuts.md` as the single source, in-app cheat
sheet generated from it.

### Phase 5 — Backend and dashboard connectivity audit
`audit/connectivity.md`: route × API matrix, dashboard figures cross-checked
against direct queries, orphans, error-handling gaps, N+1s. Fix categories 3–5;
escalate anything still on mock data.

### Phase 6 — Full test sweep
`audit/bugs.md`. Starts from the 104 findings already gathered plus everything
new. Every fix carries a regression test.

### Phase 7 — `/ultrareview` — **you run it**, I act on it.

### Phase 8 — `/security-review` — I can run this one. `audit/security.md`.

---

## 3. Payroll removal — what it touches

Section 2 is a deletion with reach. Before I cut:

**Delete:** `packages/shared/src/payroll.ts`, `disbursement.ts` (bank transfer
file), `apps/api/src/payroll.ts`, payroll routes, `apps/web/src/routes/payroll.tsx`,
payroll permissions, the Tally "payroll posting" settings tab, salary records
on the store, and the `payrollDebitAccount` / salary-ledger settings.

**Keep, but rename away from payroll:** the **month lock**. It currently exists
to stop edits to a paid month, and leave/approval logic depends on it. The
attendance export needs exactly the same concept — a locked period. I plan to
keep it as "locked attendance period". Flagging because it is the one payroll
concept I am *not* deleting.

**Add:** the per-employee, per-period Excel export from Section 2.

This also deletes 6 of the 104 audit findings outright (they are payroll bugs).

---

## 4. Appendix B — the twelve decisions

I need these answered before the phases that depend on them. Not urgent today
except B11, which shapes Phase 2.

| # | Question | My recommendation |
| --- | --- | --- |
| B1 | Leave management has had no design pass | Treat as a sixth priority screen in Phase 3 |
| B2 | Financial year / locked period / change-period | **Real gap.** No FY concept exists; only month locks. `F2`/`Alt+F2` need one. Build in Phase 4 |
| B3 | Dashboard design pass | Fold into Phase 3 |
| B4 | Settings information architecture | Fold into Phase 2 (I am there anyway for the overflow) |
| B5 | Estimate / PO screen layout and entry speed | Phase 4 — they are the keyboard-critical screens |
| B6 | Master data screens | Audit in Phase 5, fix in a follow-up |
| B7 | Audit trail | **Exists** (`recordAudit`, `/audit` screen). Needs a review, not a build |
| B8 | Approval workflows | Leave/PO approval exist; estimate threshold approval does not. Needs your decision |
| B9 | Import (`Alt+O`) and backup (`Alt+Y`) | **Neither exists.** Recommend leaving both keys unbound rather than faking them |
| B10 | Print templates | Exist for PO and estimate. GST correctness unverified — add to Phase 5 |
| B11 | Which screens are mobile vs desktop-only | **Blocks Phase 2.** Recommend: punch = mobile-first; dispatch board and procurement analytics = desktop-only with an honest small-screen message; everything else responsive |
| B12 | Notification system beyond the badge | Persisted feed with read/unread exists. `Ctrl+Alt+N` centre needs building — Phase 4 |

---

## 5. How I will report

After each phase: what changed, what was verified and how, what I could not
do and why. No phase is called done because it compiles.
