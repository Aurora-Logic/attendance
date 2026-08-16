# Phase 6a — where it stands

Working notes, not a specification. `10-scope-and-delivery-plan-phase-6-8.md`
§2 is the deliverable list; this says which of it is done and what the next
session should pick up. Delete this file when 6a closes.

Branch: **`phase-6a`**. Stable attendance build is tagged **`v1.0.0-attendance`**
at `c30941d` and contains none of this work.

---

## Done

| Deliverable | Commit | Proof |
|---|---|---|
| REQ-P-05 boundary lint extended to `crm`, `sales`, `purchase` | `4bc4e9e` | Throwaway violations in both directions refused |
| REQ-P-01 approvals → `platform/approvals` | `531890a` | 1592 tests; 47-table set byte-identical, no migration |
| REQ-P-04 delegation filter + escalation ladder read the registry | `f899d16` | 6 unit tests, falsified against the old `CASE` |
| REQ-O-01…O-04 module registry, Administration shell, sidebar 22 → 10 | `39373e4` | Driven in a browser; 400 web tests |
| REQ-P-02 (5 of 8 files) → `platform/export` | `fe01a02` | 1598 tests |
| REQ-P-03 union + widest scope asserted | `c375d97` | 4 tests, falsified by a first-role-only resolver |
| OQ P2-3 role assignment endpoint and UI | `31f855f` | Pre-dated this branch — see below. 15 live checks + 29 API tests, 16 Aug |
| REQ-O-05 Go To as a record index | `f8e23d2` | 17 API + 10 web tests; 8-check live drive: Alt+G, typed code, Enter, landed on the employee |
| REQ-P-02 remainder → `platform/export` complete | `156af26` | `ReportSourceRegistry` inversion; boundary lint is the assertion; 1616 tests; shell driven live |
| REQ-P-04 remainder: declared key catalogue | (this commit) | `approval-keys.ts` in shared; guards derive; registry refuses drift; 1618 tests |

`platform/search/` holds the `GoToSourceRegistry` — the same self-registration
shape as `ApprovalSubjectRegistry` and `JobRegistry`, so parties and vouchers
join in 6b+ by registering a source, with no edit to the index or the palette.
The employee source delegates to `EmployeeService.list`, so Go To finds exactly
what the register shows the same caller (scope proven by test: a team-breadth
manager searching a name shared by two people receives only their own report).
Found on the way: when REQ-O-02 moved eight destinations to Administration, the
palette — which read only `NAV_GROUPS` — silently stopped listing them, so
Settings, Roles, Audit log and the rest were unreachable by Alt+G. Fixed here;
a palette test now pins them.

## Next, in order

1. **Exit gate, second half: `/ultrareview`.** User-triggered and billed, so it
   cannot be run by a session. The regression half ran 16 Aug, all green:
   typecheck and lint clean across all three packages, shared 41, web 410,
   API 1617 + 1 (`auth.timing.test.ts` failed under suite load and passed
   alone in 2.5s — the documented flake, not a regression), production build
   clean. Browser gate: `verify-ui.mjs` needs `VERIFY_PASSWORD`, unavailable
   to the session; in its place every surface this phase changed was driven
   over CDP with zero page exceptions — the palette (8-check acceptance
   drive), the report shell (catalogue, rows, tray, schedules, views), the
   approvals inbox and delegations, and the employee access section (15
   checks). Run `/code-review ultra`, and re-run `verify-ui.mjs` if the
   credential is at hand.

## Every 10 §2 acceptance line, checked

- No approval subject resolves to an attendance key: registry tests, plus the
  catalogue enforcement in `18cd474` — a wrong-keyed declared handler now
  refuses at boot.
- Two roles union, wider scope wins, Sales+Employee-shaped fixture: `c375d97`.
- Attendance sidebar ≤ 11, asserted over the registry in CI: `39373e4` (10).
- `Ctrl+G` switches module, `Alt+F2` period survives: `39373e4`, browser-driven.
- Typing an employee code in Go To opens that employee: `f8e23d2`, live drive.
- All existing tests still pass: 2,069 imperative tests across the workspace
  (1618 API + 410 web + 41 shared), against the 2,033 the plan quoted.

## Three places the documents are wrong

Found while building, not by reading.

- **This file's own item 1 described work that already existed.** The role
  assignment endpoint (`/employees/:id/access`, `employee-access.controller.ts`)
  and the screen (`employee-access-section.tsx` on the employee record) landed
  14 Aug in `31f855f` — hours *after* the OPEN-QUESTIONS P2-3 entry said they
  were missing, and inside `v1.0.0-attendance`. The entry here copied P2-3
  instead of checking the code. Verified live 16 Aug against the running stack:
  grant, union with existing roles (D-15), idempotent regrant, unknown-role
  404, revoke restoring the original set, audit rows for both writes, and the
  section rendering — 15 checks, zero page exceptions, plus the 29 tests in
  `employee-access.endpoints.test.ts`, `multi-role.test.ts` and
  `rbac-admin.service.test.ts`. The *set*-endpoint preference written here is
  withdrawn with the entry: what exists is add/remove, one role per request,
  each with its own reason and audit row — a deliberate choice recorded in the
  component — and the swap-leaves-neither worry it was guarding against is
  answered by granting before revoking, which the UI's shape naturally does.

- **D-15 says multi-role is "a small change to `user_roles`".** It needs no
  change. The table has always been many-to-many keyed `(user_id, role_id)`,
  `loadGrants` has always unioned into a Set, and `ScopeService.breadth` has
  always returned the widest held. No migration. The reasoning in D-15 still
  stands — nothing *asserted* any of it until `c375d97`.

- **REQ-O-02 and REQ-O-04 cannot both hold.** The eight destinations REQ-O-02
  names, plus Approvals under REQ-O-03, leave 13 against a cap of 11 that calls
  itself hard. D-16's arithmetic started from nineteen items; the sidebar had
  twenty-two. Recorded as **P6a-1** in `OPEN-QUESTIONS.md` with a default in
  force. Still needs a decision.

## Two environment notes

- **The API suite fails roughly one run in three**, a different file each time,
  always a timeout and never an assertion. Not caused by any 6a change — one
  failure was `login-rate-limit.test.ts`, which shares nothing with approvals.
  It is load on the development machine. Re-run before believing a red result.

- **Do not run the API suite twice at once.** An advisory lock refuses the
  second run; `DEPLOYMENT.md` says why.

## Not started, and owed by somebody else

`10` §8 step 4: **capture real TallyPrime XML fixtures from the company data**
during 6a. Phase 6b cannot start properly without them and the Definition of
Done forbids hand-written ones, because hand-written Tally XML is always tidier
than the real thing. This is a gathering task, not a development one.
