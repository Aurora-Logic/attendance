# 10 — Scope and Delivery Plan: Phase 6–8

Companion to `08-product-requirements-phase-6-8.md` and `09-technical-design-phase-6-8.md`.
Continues `03-scope-and-delivery-plan.md`, whose Phase 0–5 boundary is now closed.

---

## 1. Scope boundary

### In scope now

| Area | Included |
|---|---|
| Platform | Approvals and export extraction, multi-role assignment, module registry, Go To record search |
| Navigation | Module switcher, Administration shell, Approvals to top bar, eleven-item cap |
| Connector | Agent, heartbeat, job claim, XML transport, per-company connections |
| Masters | Parties, stock items, price lists — pull only, read-only in Vyuha |
| Backfill | Full historical voucher import, resumable, with a reconciliation report |
| Sync ops | Exceptions screen, journal, cursors, drift check, job monitor integration |
| Receivables | Customer statement, ageing, credit cycle, payment analysis, sales analysis |
| CRM | Contacts, companies, pipelines, deals, activities, tasks, board |
| Sales | Estimate, sales order, delivery challan, register |
| Purchase | Purchase order, GRN, register |

### Explicitly out of scope now

| Out | Why / when |
|---|---|
| Any salary, wage, tax, PF/ESI or payslip calculation | Unchanged from `03`. Permanent. |
| A Vyuha-side ledger, trial balance or P&L | Tally has one |
| GST computation, IRN, e-way bill | Tally does this |
| Invoice creation in Vyuha | Blocked on decision D-03. May land in 8c, may never |
| Master creation or editing in Vyuha | REQ-R-04, permanent |
| Automatic conflict resolution | REQ-T-02, permanent |
| WhatsApp, email, telephony, IVR | REQ-Z-01. After CRM core is in daily use |
| CRM workflow builder | REQ-Z-03. Not specified, not estimated |
| Multi-tenancy | `08` N9. Revisit only if the CRM is ever sold |
| Offline document creation | `09` §8 |
| Native mobile apps | Unchanged from `03` |

---

## 2. Phases

Effort in **Claude Code sessions**, as in `03`. Each phase ends with `/ultrareview`.

The ordering below differs from the `03` §2 roadmap in one respect, and it is deliberate: **reading comes before writing, and CRM comes after the read path rather than before it.** The reasoning is in §3.

---

### Phase 6a — Platform extraction and navigation (~4–6 sessions)

Nothing about Tally. Nothing user-visible except a reorganised menu. Everything after this depends on it.

**Deliverables**
- Approvals framework moved to `platform/approvals`, handler registry per subject type (REQ-P-01, REQ-P-04)
- Export framework moved to `platform/export` (REQ-P-02)
- Multi-role assignment: schema, union resolution, last-holder invariant against the union (REQ-P-03)
- Role assignment UI — closes OPEN-QUESTIONS P2-3, which is still open and is now blocking
- Module registry, module switcher on `Ctrl+G` (REQ-O-01)
- Administration shell; eight destinations move out of the attendance sidebar (REQ-O-02, REQ-O-03)
- Go To rebuilt as a record index over employees, and extensible (REQ-O-05)
- Boundary lint extended to the three new module paths (REQ-P-05)

**Acceptance**
- A test asserts no approval subject type resolves to an attendance permission key. It fails if the registry is bypassed.
- A user holding two roles gets the union of both, and the wider of two scopes. Asserted by a test with a Sales+Employee fixture.
- The attendance sidebar has eleven or fewer items, asserted over the module registry in CI.
- `Ctrl+G` switches module; `Alt+F2` period survives the switch.
- Typing an employee code in Go To opens that employee.
- All 2,033 existing tests still pass. The extraction moves code; it does not change behaviour.

**Exit gate:** `/ultrareview` plus a full regression run. If the approvals move broke a leave approval, that is discovered here and not in production. Do not start 6b until the boundary lint rule covers the new module paths — retrofitting it is what `03` warned about and it was right.

---

### Phase 6b — Connector and masters (~5–7 sessions)

Read-only. Nothing in this phase can alter a figure in Tally.

**Deliverables**
- Connector agent: single binary, Windows service, heartbeat, job claim under lease (REQ-Q-01…Q-07)
- Tally XML transport with a tolerant parser, and a request/response fixture suite captured from the real company data
- `sync_cursors`, `sync_jobs`, `sync_journal` (append-only trigger), extended `external_refs` and `integration_connections`
- Masters pull: parties, stock items, price lists, AlterID-incremental (REQ-R-01…R-07)
- Masters screens, read-only, no create path anywhere in the UI or the API
- Tally connections screen; heartbeat alerting
- Sync exceptions screen and resolution flow (REQ-T-01, REQ-T-02)
- Sync queues in the existing job monitor (REQ-T-07)

**Acceptance**
- A party renamed in Tally shows its new name in Vyuha within one sync interval.
- A party created in Tally appears. There is no way to create one in Vyuha — verified by asserting the API returns 405 on `POST /masters/parties`.
- Killing Tally mid-pull and restarting it re-reads the interrupted chunk and skips nothing. Verified by row count.
- Closing Tally raises a heartbeat alert within 5 minutes, and recovery clears it.
- Opening the wrong company causes jobs to be refused with that specific reason, not a generic failure.
- Two agents against one company: the second is refused by the lease.
- `sync_journal` cannot be updated or deleted. Verified by an attempted `UPDATE` in a test.

**Exit gate:** run `/security-review` on the agent authentication path and the `/sync/agent/*` endpoints. An agent credential must not be able to read an employee, a punch photo, or another connection's data. Do not proceed with an open finding.

---

### Phase 6c — Historical backfill (~3–5 sessions)

Still read-only. This is the phase that makes Phase 6d worth having.

**Deliverables**
- Voucher projection tables and the sync writer (`09` §4.3)
- Backfill orchestrator: chunked by period, resumable, idempotent on GUID (REQ-S-01…S-03)
- Progress screen (REQ-S-06)
- Reconciliation report — count and value per voucher type per month, Vyuha against Tally (REQ-S-05)
- Bill-wise allocation import, which is what makes ageing possible at all
- Daily drift check (REQ-T-08)

**Acceptance**
- Running the backfill twice produces one row per voucher. Asserted on GUID uniqueness across a full re-run.
- An interrupted backfill resumes and reaches the same final state as an uninterrupted one, byte for byte on the reconciliation report.
- The reconciliation report matches Tally's own Day Book totals for three sampled months, checked by a person, and the sign-off is recorded.
- Killing the agent mid-chunk loses nothing and duplicates nothing.

**Exit gate:** the backfill runs against a **copy** of the company data and its reconciliation report is reviewed before it is ever pointed at live books (REQ-S-04). This is not negotiable and it is not a formality — the first run is the one most likely to be wrong, and the mistake is discovered by comparing numbers, not by watching it finish.

---

### Phase 6d — Receivables and analysis (~4–5 sessions)

Everything here is derived from Phase 6c. There is still no write path to Tally in the entire system.

**Deliverables**
- Customer statement, exportable and shareable as PDF (REQ-Y-01)
- Ageing with configurable buckets (REQ-Y-02)
- Credit cycle: limit and days against exposure and actual overdue (REQ-Y-03)
- Payment analysis: days-to-pay, trend, collection efficiency, agreed-versus-observed (REQ-Y-04)
- Sales analysis by party, item, group, month, salesperson (REQ-Y-05)
- All five under the existing report shell — saved views, `F12`, `Alt+F2`, Excel export, scheduling (REQ-Y-06)
- As-of-sync stamp on every screen (REQ-Y-07)

**Acceptance**
- A customer statement reconciles to Tally's own outstandings report for five sampled parties, to the rupee.
- Every report meets NFR-02 against the full backfilled dataset, not a recent slice (NFR-10).
- Payment analysis declares insufficient history rather than presenting a confident number, when the backfill covers less than two years.
- Every figure carries its as-of timestamp.

**This is where the phase pays for itself.** Four of the nine screens originally asked for are now live, and the system still cannot alter a figure in Tally. If the project stopped here it would already be worth having built.

---

### Phase 6e — Attendance voucher push (~2–3 sessions)

The first write path. Chosen deliberately for its low blast radius.

**Deliverables**
- Push pipeline: queue, agent generation, idempotency key, response handling (`09` §3.3)
- Attendance data pushed to Tally in the agreed shape (blocked on decision D-06)
- Push failure exceptions with Tally's verbatim error (REQ-W-06 mechanics, applied here first)
- Tally period lock consulted before push (REQ-T-05)

**Acceptance**
- A push whose response is lost does not create a duplicate on retry. Verified by killing the agent between Tally's import and its acknowledgement, then retrying.
- A push into a Tally-locked period is refused before it is attempted, naming the lock date.
- A rejected push shows Tally's own error text, not a paraphrase of it.

**Exit gate:** the idempotency test above must be falsifiable — disable the key check and watch it produce two vouchers. If it cannot be made to fail, it is not testing anything. Do not build Phase 8 on an unproven push path.

---

### Phase 7 — CRM (~7–9 sessions)

**Deliverables**
- Contacts, companies, duplicate warning (REQ-U-01, U-02, U-08)
- Party linking on conversion via `external_refs`; no lead ever reaches Tally (REQ-U-03)
- Configurable pipelines and stages (REQ-U-04)
- Deals, with links to their sales documents once Phase 8 lands (REQ-U-05, U-06)
- Activity log through the platform audit interceptor (REQ-U-07)
- Tasks in `platform/`, polymorphic subject (REQ-V-01, V-02)
- Kanban board and keyboard-complete list view (REQ-V-03…V-06)
- My tasks as the CRM landing screen (REQ-V-07)
- Task notifications through the existing dispatcher (REQ-V-08)

**Acceptance**
- A task can be created, assigned, moved through every status, and closed **without a mouse**. This is the acceptance criterion that matters; a board that only works by dragging fails this phase.
- A drag and a keyboard status change produce identical audit entries.
- A deal marked won links to its party only at that point, and never before.
- CRM does not import Sales, and Sales does not import CRM. Enforced by lint.

**Exit gate:** one salesperson uses it for a fortnight before anyone else is invited. `DEPLOY-CHECKLIST` §5 makes this point about invitations and it applies here: one person struggling is a fix, six is an abandonment.

---

### Phase 8a — Sales and purchase documents (~8–10 sessions)

**Deliverables**
- Estimate, Vyuha-only, with item history on selection (REQ-W-01, W-02)
- Sales order, converted or fresh, pushed as a Sales Order voucher (REQ-W-03)
- Delivery challan with partial dispatch (REQ-W-04)
- Purchase order, standalone or against a sales order (REQ-X-01, X-02)
- GRN with partial receipt (REQ-X-03)
- Sync state visible on every document (REQ-W-06)
- Alter path against the stored GUID; no second voucher, ever (REQ-W-07)
- Discount approval and credit-limit block, both through `platform/approvals` (REQ-W-08, W-09, X-04)
- Sales and purchase registers

**Acceptance**
- A sales order created in Vyuha appears in Tally's Day Book with the same lines, quantities and rates. Checked by a person against Tally, for ten orders.
- Altering a pushed order updates the same voucher. Tally shows one, not two.
- A party over its credit limit is blocked, and released only with a recorded reason by a holder of the override key.
- A discount above threshold routes to approval and cannot be bypassed by the API.
- Creating a document with the agent offline queues it visibly and pushes on recovery.

**Exit gate:** `/security-review` on the push path. A user who can create a sales order must not be able to push arbitrary XML to Tally.

---

### Phase 8b — Invoice, if decided (~4–6 sessions)

Blocked on decision D-03. Not scheduled. Not estimated beyond this line, because if D-03 answers "Tally raises invoices" this phase does not exist and Vyuha's invoice screens are pull-only views built in 6d.

---

## 3. Build order rationale

`03` §3 argued foundation before features. The same argument holds and extends.

**Platform extraction first, because the alternative is a rewrite.** `03` §6 listed "platform concerns leak into the attendance module" as a risk whose consequence was "Phase 7/8 become a rewrite", and `DEPLOYMENT` recorded that approvals and export did leak. The debt is small now and compounds with every module that builds on top of it. It is also the cheapest phase to get wrong quietly and the most expensive to discover late.

**Read before write, and read a long way before write.** Phases 6b through 6d contain no path that can change a figure in Tally. That is four phases of real, daily-use value — masters, history, statements, ageing, credit exposure, payment behaviour — delivered against a system whose worst possible bug is a wrong number on a screen rather than a wrong voucher in the books. By the time the first push is written in 6e, the team has been living with the connector for weeks and knows how it fails.

**CRM after the read path, not before it.** The `03` roadmap put CRM at Phase 7 and ERP at Phase 8, and that ordering was right when Phase 6 was one undifferentiated block. Splitting Phase 6 changes it: the receivables screens are cheap once the backfill exists, and they are what the business actually asked about first. CRM is a larger build with no dependency on Tally at all, which means it can also slip without blocking anything.

**Backfill before receivables, obviously — but also before CRM.** Payment analysis over one financial year is noise. The item-history affordance in REQ-W-02, which is the feature most likely to change how someone quotes, is worthless without years behind it. The backfill is what converts three of these screens from plausible to useful.

---

## 4. Definition of Ready

Unchanged from `03` §4, with one addition:

- For any requirement touching sync, the **owner of the entity is stated** and matches `09` §3.1. A requirement that does not name an owner is not ready.

## 5. Definition of Done

See `CLAUDE.md` §4. Unchanged. One addition for this phase:

- No test may assert against a Tally fixture that was written by hand. Fixtures are captured from the real company data and committed, because hand-written Tally XML is always tidier than the real thing and the real thing is what will arrive.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A push retry creates a duplicate voucher | Severe — a duplicate invoice in the books, discovered by a customer | Idempotency key queried in Tally before every retry; the test must be falsifiable |
| The projection drifts from Tally and reports become wrong | Fatal to trust, and silent | Daily drift check raising an exception; never auto-corrected, because auto-correction hides the cause |
| Vyuha quietly becomes a second set of books | Reconciliation burden forever | No write path to projection tables outside the sync writer; no Vyuha-side adjustment path exists |
| Backfill run against live books first, and wrong | Corrupted history, hard to unwind | REQ-S-04 — copy first, reconciliation reviewed, sign-off recorded |
| Tally unavailable during a busy period | Sales stops | Degrade to read-only, queue visibly, alert on heartbeat; NFR-12 |
| Approvals extraction breaks leave approval | Regression in a live system | Full regression as the 6a exit gate, before any Tally work starts |
| Nav restructure disorients existing users | Adoption dip in a working module | Ship 6a's nav change with the guided tour pattern from `06`, and keep every old route resolving |
| The board becomes the only usable task view | The keyboard promise breaks in the newest module | REQ-V-05 is a phase acceptance criterion, not a nice-to-have |
| Scope creeps into a Vyuha-side ledger | The whole design premise collapses | `09` §1.1 and §8. Any request for a balance Vyuha computes itself goes to a decision, not to a task |
| Agent machine is somebody's desktop that gets turned off | Silent sync stoppage | Heartbeat alerting; and D-05 asks whether it belongs on a server instead |

---

## 7. Decisions

Confirmed answers are in `11-decisions-phase-6-8.md`. That file is the authority — where it and anything in these documents disagree, it wins.

Still open, and needed before the phase shown:

| # | Question | Needed by |
|---|---|---|
| D-03 | Does Vyuha raise invoices, or does Tally? | 8b (and it decides whether 8b exists) |
| D-05 | Is Tally on one machine or a server? | 6b |
| D-06 | Attendance push shape — vouchers, or a file handoff? | 6e |
| D-07 | Does anyone create sales vouchers directly in Tally? Decides voucher numbering authority | 8a |
| D-08 | How many financial years, and how many Tally companies? | 6c |
| D-09 | Roughly how many vouchers in total? Sizes the backfill | 6c |
| D-10 | What is "Analysis", as distinct from "Payment analysis"? | 6d |
| D-11 | Credit limits and credit days — held in Tally per party, or set in Vyuha? | 6d |
| D-12 | Who holds `sales.credit.override`? | 8a |

---

## 8. How to start

```
1. Read CLAUDE.md, then docs/08, 09, 10 in full. 01-03 remain in force
   for attendance and are not superseded.
2. Answer §7 above, or confirm the defaults, and record the answers in
   docs/11-decisions-phase-6-8.md.
3. Begin Phase 6a. Nothing in it touches Tally, so none of the open
   decisions block it — start now rather than waiting on answers.
4. Capture real Tally XML fixtures from the company data during 6a,
   in parallel. They are the input to 6b and gathering them is not
   a development task.
5. Commit in vertical slices. Reference REQ IDs in commits, as before.
```
