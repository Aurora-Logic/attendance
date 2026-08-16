# 11 — Decision Log: Phase 6–8

Confirmed by the client. **This file overrides any assumed default in documents 08–10.** If a requirement there contradicts something here, this wins. Same relationship `05-decisions.md` has to `01`–`03`.

Last updated: 16 August 2026

---

## Confirmed

### D-01 — Tally is the system of record

| | |
|---|---|
| **Decision** | Everything lives in Tally, including all historical data. Vyuha holds a projection. |
| **Confirmed** | 16 August 2026 |
| **Consequence** | No accounting figure is authoritative in Vyuha. Every derived screen recomputes from projected data and stores nothing that cannot be rebuilt. If Vyuha's database were dropped and restored from a backfill, nothing financial would be lost — and that property is a design constraint, not a happy accident. |

### D-02 — Documents created in Vyuha are written through to Tally

| | |
|---|---|
| **Decision** | A document raised in Vyuha becomes a real Tally voucher. There is no second entry by a person. |
| **Confirmed** | 16 August 2026 |
| **Consequence** | Write-through, not two-way sync. Every entity has exactly one owner; the flow is bidirectional overall because different entities are owned by different sides. A record both systems can write will diverge, and no resolution rule survives contact with an accountant and a salesperson who each know they were right. |

### D-04 — Estimates stay in Vyuha and are not pushed

| | |
|---|---|
| **Decision** | Estimates are Vyuha-only. They reach Tally when they become a sales order, and not before. |
| **Confirmed** | 16 August 2026, on the reasoning below. Reverse it by saying so — it is a voucher-type mapping, not an architectural choice. |
| **Reasoning** | TallyPrime has no native quotation voucher. The alternatives are an Optional Sales voucher or a custom type via TDL. Either fills the Day Book with vouchers the accountant must mentally filter past forever, for documents that mostly never convert. Nothing is lost by holding an estimate back: the moment it is accepted it becomes a sales order, and that is the point at which it goes. |

### D-13 — PO means outward, to vendors

| | |
|---|---|
| **Decision** | "Purchase order" throughout these documents is the order Vyuha raises on a supplier. |
| **Confirmed** | 16 August 2026 |
| **Consequence** | A purchase order the customer sends *to* G C Communication is a reference field and an attachment on the sales order, not a document type. These are different tables and conflating them is a common early mistake. |

### D-14 — Admin has full CRUD, with two classes of exception

| | |
|---|---|
| **Decision** | Unchanged from `05-decisions` — Admin holds full CRUD on every entity, plus the 90-day Recycle Bin. |
| **Existing exceptions** | `punches` and `audit_logs` are append-only. Admin voids with a reason; the original stays visible. |
| **New exceptions** | **Synced records.** Admin cannot delete a Tally voucher from Vyuha, because deleting it locally desyncs the books while changing nothing in Tally. Tally-owned records are read-only in Vyuha. Vyuha-owned records that have been pushed are alterable only through the Alter action, which re-pushes against the stored GUID. `sync_journal` joins the append-only set. |
| **In the UI** | Where delete is unavailable, the control says why rather than being absent or failing. A greyed control with no explanation produces a support conversation every time. |

### D-15 — A user may hold multiple roles

| | |
|---|---|
| **Decision** | Roles become a set per user. Permissions are the union; scope is the widest granted. |
| **Confirmed** | 16 August 2026 |
| **Reasoning** | A salesperson is also an employee who punches and applies for leave. Under one role per user the only options are a composite "Sales + Employee" role, which multiplies with every module, or duplicating attendance permissions into Sales, which means a permission change gets made in two places and eventually in one. |
| **Timing** | Phase 6a, before CRM. It is a small change to `user_roles` now and an expensive one after two modules assume the old shape. |

### D-16 — Navigation restructures before any module is added

| | |
|---|---|
| **Decision** | Module switcher on `Ctrl+G`; Administration and Approvals leave the module sidebar; no sidebar exceeds eleven destinations; Go To searches records rather than screens. |
| **Confirmed** | 16 August 2026 |
| **Reasoning** | Nineteen items already scroll. Seven of them — Settings, Roles, Integrations, Audit log, Recycle bin, Period lock, Downloads — are not attendance at all; they are workspace administration sitting inside a module sidebar, and CRM will not get its own copies of them. Pulling them out drops the current sidebar to eleven before anything is added. |
| **The real fix** | Go To searching party names and voucher numbers. Once typing an invoice number opens that invoice, the sidebar stops being how anyone navigates and its length stops mattering. |

### D-17 — Tasks live in the platform, not in CRM

| | |
|---|---|
| **Decision** | `tasks` is a platform table with a polymorphic `(subject_type, subject_id)`, mirroring the approvals table. |
| **Confirmed** | 16 August 2026 |
| **Reasoning** | A task hangs off an invoice, an employee, a sales order or nothing. Putting it in the CRM module would require the sales module to import CRM to attach a task to an invoice, which the boundary lint rule refuses — correctly. |

### D-18 — Conflicts are never resolved automatically

| | |
|---|---|
| **Decision** | Where a record has changed on both sides, Tally wins on read and the case is quarantined for a person to look at. No merge rule is written. |
| **Confirmed** | 16 August 2026 |
| **Reasoning** | A resolution rule for the common case is what produces a system nobody can audit six months later. The exception queue is a screen somebody checks daily, not a log somebody greps after a customer complains. |

---

## Still open

Nothing in Phase 6a is blocked by any of these. Start there.

| # | Question | Blocks | Recommended default in use |
|---|---|---|---|
| D-03 | **Does Vyuha raise invoices, or does Tally?** | Phase 8b — and decides whether 8b exists | **Tally raises them.** Vyuha stops at sales order and delivery challan and pulls invoices back. This keeps GST computation, IRN generation and e-way bills where they already work and are already certified, avoids a numbering authority conflict, and leaves the accountant's workflow untouched. The cost is that nobody invoices from the field and invoice data lags the sync interval. Note that `01` set the boundary as "if a field would need a currency symbol, it does not belong in this product" — Vyuha raising invoices crosses that line deliberately, and should only be crossed for a demonstrated business need rather than an assumed one. |
| D-05 | **Is Tally on one machine or a server?** | Phase 6b | Assuming **one machine**, so the connector is a Windows service on that desktop. If it is somebody's desktop that gets switched off, that is a reliability problem the heartbeat will surface daily and a server is the better answer. Carried over unanswered from `03` §7. |
| D-06 | **Attendance push shape — vouchers, or a clean file handoff?** | Phase 6e | Assuming **attendance vouchers**, since the push machinery exists by then anyway. A file handoff is less work and less coupling if payroll is happy with it. Carried over unanswered from `03` §7. |
| D-07 | **Does anyone create sales vouchers directly in Tally?** | Phase 8a | Assuming **no**, so those voucher types are set to Manual numbering in Tally and Vyuha allocates. The number is then known at create time, which is much better on screen. If the accountant will keep entering sales vouchers directly, Tally must allocate and Vyuha shows a provisional reference until the push returns — two allocators on one series will collide, and it will happen in the first busy week. |
| D-08 | **How many financial years, and how many Tally companies?** | Phase 6c | Unknown. Tally installations commonly split financial years across separate company files, and each is a separate connection with its own cursor. This changes the shape of the backfill, not just its size. |
| D-09 | **Roughly how many vouchers in total?** | Phase 6c | Unknown. Sizes the backfill — an afternoon or a week — and determines whether `vouchers` needs partitioning by financial year. |
| D-10 | **What is "Analysis", as distinct from "Payment analysis"?** | Phase 6d | Assuming **sales analysis** — value and margin by party, item, group, month and salesperson (REQ-Y-05). If it meant something else, that requirement is wrong rather than incomplete. |
| D-11 | **Credit limits and credit days — held in Tally per party, or set in Vyuha?** | Phase 6d | Assuming **held in Tally**, pulled with the party master, consistent with D-01. If they are to be managed in Vyuha they become the one piece of party data Vyuha owns, which is a deliberate exception and should be recorded as one rather than drifting into existence. |
| D-12 | **Who holds `sales.credit.override`?** | Phase 8a | Assuming **Sales manager and Accounts**. This is the key that lets an order through for a customer who is over their limit, so it is a business decision about who carries that risk, not a configuration detail. |
| D-19 | **Photo, geofence and consent have precedent — does CRM activity logging need the same treatment?** | Phase 7 | Assuming **no**, because a call note is not biometric data. Raised because `01` was careful about consent and it would be inconsistent to be careless here without having thought about it. |
| D-20 | **Retention for `sync_journal` bodies.** | Phase 6b | **30 days for request and response bodies, hashes retained indefinitely.** Bodies are large and mostly uninteresting after the fact; the hash is what proves what was sent. Say the word if a dispute window longer than 30 days is expected. |

---

## Carried forward, still open from `05-decisions.md`

These predate this phase and remain unanswered. Listed so they are not lost when attention moves to Phase 6.

| # | Question | Blocks |
|---|---|---|
| `05`-6 | Who runs payroll, in what format, and the exact columns | Interacts with D-06 |
| `05`-7 | Attendance cycle — calendar month or a cutoff | Interacts with D-06 |
| `05`-14 | Consequence rules — does 3 lates equal a half day | Attendance, unchanged |
| `05`-15 | Regularization limits — days back, count per month | Attendance, unchanged |
| OQ P0-6 | Icon library: phosphor in the code, lucide in the constitution | Every future screen, including all 22 new ones |
| OQ P2-3 | Role assignment has no endpoint or UI | **Now blocking.** D-15 cannot ship without it; folded into Phase 6a |
| OQ P2-2 | Four settings recorded but read by nothing | Attendance, unchanged |
| REQ-G-10 | Who may cancel leave once it has started | Attendance, unchanged |
| OQ WS-A-1 | Error tracking deferred pending a Sentry decision | Becomes more pressing with an agent running outside the VPS |

**On P0-6 in particular:** twenty-two new screens are about to be built. Deciding the icon library before them costs a two-line documentation change; deciding it after costs a second sweep across a codebase twice the size.
