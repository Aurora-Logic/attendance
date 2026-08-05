# ECOSYSTEM

The complete ERP this system grows into, planned as modules on the
architecture in [DECISIONS.md §10](DECISIONS.md): a TypeScript modular
monolith where every module is three thin layers (domain in
`packages/shared`, routes in `apps/api`, screens in `apps/web`) riding one
platform core. Nothing here requires a redesign — each wave is assembly on
what the previous wave proved.

**Status legend:** ✅ built · 🔨 underway · ⬜ planned

## The module map

```
                    ┌─────────────────────── PLATFORM CORE ───────────────────────┐
                    │ Auth · RBAC matrix · Approval engine · Document series      │
                    │ Doc sheet (A4) · Excel/print exports · Audit · Settings     │
                    │ Money-in-paise · Masters · Notifications · Files (MinIO)    │
                    └──────────────────────────────────────────────────────────────┘
   PEOPLE                    SELL                      BUY                    MAKE & STOCK
   Attendance ✅             Customers ✅              Procurement ✅          Inventory ⬜
   Leave ✅                  Estimates ✅              Indents ⬜              Production ⬜
   Payroll 🔨                Sales Orders ⬜           Vendor Bills ⬜         Stock Reports ⬜
   Expense Claims ⬜         Dispatch/Challan ⬜       Payables ⬜
   HR-lite ⬜                Invoicing ⬜
                             Receivables ⬜
                    ┌──────────────────────────────────────────────────────────────┐
                    │ FINANCE SPINE: GST reports · TDS · Tally voucher export ⬜   │
                    └──────────────────────────────────────────────────────────────┘
```

## Modules in detail

### People (the current attendance track)
| Module | Contents | Rides on |
|---|---|---|
| Attendance ✅ | Punches, day computation, regularisation, roster, geofence, selfies | The founding module |
| Leave ✅ | Ledger, balances, sandwich rule, comp-off | Approval engine |
| Payroll 🔨 | Earned pay, OT; then Phase 7b: PF/ESI/PT/TDS, payslip PDF, bank file | `payable_units` (A3), locked months (A8) |
| Expense Claims ⬜ | Employee spends → approve → reimburse in payroll | Approval engine, money-in-paise, payroll |
| HR-lite ⬜ | Onboarding/exit checklists, documents, company asset issue | Files, audit |

### Sell (the estimate creator's family)
| Module | Contents | Rides on |
|---|---|---|
| Customers ✅ | **Customers master** (mirror of vendors), win-rate and quoted value per customer | Masters pattern from vendors |
| Estimates ✅ | The OCC type-on-template sheet; `salePricePaise` on items; validity with derived EXPIRED; send → accept/reject with reasons | PO document sheet (D6), GST maths + CGST/SGST split, doc series `EST-` |
| Sales Orders ⬜ | Won estimate → SO; the customer-side mirror of a PO with delivery schedule | PO lifecycle shape (draft→approve→fulfil) |
| Dispatch ⬜ | Delivery challans against SO tranches — the mirror of GRNs, append-only | GRN pattern (D1/D2), stock issue |
| Invoicing ⬜ | GST invoice from SO/challan, credit notes; e-invoice IRN + e-way bill when turnover requires | Doc sheet, tax breakup, doc series `INV-` |
| Receivables ⬜ | Payments received, outstanding by customer, ageing, payment terms from customer master | Ledger-projection pattern from leave |

### Buy (procurement grown up)
| Module | Contents | Rides on |
|---|---|---|
| Procurement ✅ | Vendors, items (brand/category), POs, delivery schedules, GRNs, vendor analytics | — |
| Indents ⬜ | Department requisitions → approved → grouped into POs | Approval engine |
| Vendor Bills ⬜ | Purchase invoices with **3-way match**: PO ↔ GRN ↔ bill, mismatches flagged not blocked | receiptProgress (D2), §3 flag-don't-block |
| Payables ⬜ | Debit notes, vendor payments, ageing by payment terms | Ledger-projection pattern |

### Make & stock
| Module | Contents | Rides on |
|---|---|---|
| Inventory ⬜ | **Append-only stock ledger** — every movement is a row (GRN in, challan out, adjustment, transfer); balances are projections; weighted-average valuation; reorder levels → suggested indents | A1/D1 append-only doctrine, reduceLedger pattern |
| Production ⬜ | BOM per finished item, work orders, material issue/consumption, output entries | Inventory movements, approval engine |

### Finance spine (deliberately thin)
Full double-entry accounting is **not** built — the accountant lives in
Tally. Instead: GSTR-1/3B data straight from invoices and bills, TDS
registers, and a **Tally voucher export** (XML) for sales, purchases,
payments and payroll journals. Years of accounting-engine work avoided; the
OCC project's Tally sync groundwork carries over.

### Platform additions as they're earned
Notifications (in-app → email → WhatsApp for approvals/overdues) · dashboards
per module (F15 rule) · report builder on the shared DataTable + export layer
· PWA polish for punch/approvals on phones · integrations (Tally first).

## Sequencing — each wave unlocks the next

| Wave | Ships | Why this order |
|---|---|---|
| 1 (now) | Postgres/Prisma + web↔API wiring; attendance hardening | Everything downstream needs the one transactional store |
| 2 | Customers, Estimates, Sales Orders | Highest business value; almost pure assembly of existing parts |
| 3 | Inventory ledger + Dispatch | GRNs (in) exist; challans (out) complete the stock story |
| 4 | Invoicing, Receivables; Vendor Bills, Payables, 3-way match | Money documents need the goods documents of waves 2–3 |
| 5 | Payroll statutory (7b), Expense Claims | Per the 4 Aug 2026 deferral; claims feed payroll |
| 6 | Production, Indents, Tally export, GST reports | Needs stable inventory; Tally export needs invoices/bills |

## The rules that keep this an ecosystem, not a pile

1. Every document family repeats the proven shape: **master → document with
   lines → lifecycle (draft→approve→fulfil) → append-only fulfilment records
   → derived status → analytics as projections.** PO/GRN proved it; SO/challan
   and estimate/invoice repeat it with new nouns.
2. Every ledger (leave, stock, receivables, payables) is append-only rows +
   `reduceLedger`-style projections. Balances are never stored.
3. Every new module = matrix rows + shared domain file + routes file + nav
   group. If a module needs new middleware, the platform core is missing a
   primitive — build it there.
4. Cross-module touch points go through ids and the core, never through
   another module's internals (E4).
