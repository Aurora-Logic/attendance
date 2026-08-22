# 14 — Analytics and Reports

Companion to `08-product-requirements-phase-6-8.md`. Requirement IDs add areas **AD**–**AI**.
Phases 6d and 8a. `11-decisions-phase-6-8.md` remains the authority on anything it covers.

---

## 1. The line that governs this whole document

**Vyuha does not reproduce Tally's statutory or statement reports.** Not the Balance Sheet, not the Profit & Loss, not the Trial Balance, and above all not GSTR-1, GSTR-2B, GSTR-3B, TDS, TCS or 26AS.

`09` §8 already states this and it is worth restating here because a report list is exactly where it erodes. A second implementation of a Balance Sheet that disagrees with Tally's by one rupee is worse than having none — someone has to reconcile two numbers that were never meant to be two numbers, and the CA will use Tally's anyway. GST returns are a compliance surface where Tally is already certified and Vyuha is not; being wrong there is not a bug, it is a notice.

So the report set splits three ways, and every requirement below sits in exactly one:

| Class | Rule | Examples |
|---|---|---|
| **Never in Vyuha** | Open Tally. Vyuha deep-links and does not display a figure. | Balance Sheet, P&L, Trial Balance, GSTR-1, GSTR-2B/3B, TDS, TCS, 26AS |
| **Mirror** | A read-only view of projected Tally data. Vyuha computes nothing; it filters, sorts and exports what Tally already said. | Day book, ledger extract, cash/bank book, stock summary, outstandings |
| **Analysis** | Vyuha's own work. Cross-cuts, trends, behaviour and exceptions that Tally does not produce and that need the backfill to mean anything. | Everything in Area AG and AH |

**The analysis class is the reason to build any of this.** A mirror saves someone opening Tally. An analysis tells them something they did not know.

---

## 2. Area AD — The report platform

Thirteen reports exist under the shell built in Phase 3. Sixty-odd are catalogued below. If each one becomes a bespoke screen this project ends with an unmaintainable surface and an unnavigable menu.

| ID | Requirement |
|---|---|
| REQ-AD-01 | **Every report in this document uses the existing report shell.** Filter bar, column chooser, sort, pagination, saved views, `F12` configure, `Alt+F2` period, Excel and CSV export, scheduling, Downloads tray. A report is a definition — columns, query, filters, drill targets — not a screen. |
| REQ-AD-02 | A report is registered in a **report registry**: id, name, category, permission, required data (does it need the backfill? does it need cost?), default columns, available filters, drill-down targets. Adding a report is a registry entry and a query, never a new route component. |
| REQ-AD-03 | **Reports are discoverable by search, not by menu.** A single Reports destination with a searchable, categorised list. Go To (REQ-O-05) finds a report by name. Sixty reports cannot live in a sidebar and REQ-O-04 caps it at eleven items anyway. |
| REQ-AD-04 | **Every row drills through.** A customer row opens that customer; an item row opens that item; a value opens the vouchers behind it. A report that cannot be interrogated produces a follow-up question nobody can answer. `Enter` drills, per the existing Tally-parity key. |
| REQ-AD-05 | **Period-over-period is a shell feature, not a per-report feature.** Any report with a period filter gets a comparison toggle: previous period, same period last year. Built once. |
| REQ-AD-06 | Every report states **as-of which sync** (REQ-Y-07) and, where relevant, **how much history it has**. A trend over four months should say so rather than drawing a confident line. |
| REQ-AD-07 | A report that needs data the system does not yet have — cost, batches, multiple godowns — **declares that and does not appear**, rather than rendering empty or zero. |
| REQ-AD-08 | Every report meets NFR-02 against the **full backfilled dataset**, not a recent slice (NFR-10). Where a query cannot, it becomes a nightly-materialised report with its computation time shown. |
| REQ-AD-09 | **Report usage is recorded** — who opened what, when. See §8. |

---

## 3. Area AE — Financial mirrors

Read-only projections. Vyuha computes nothing in this area.

| ID | Report | Notes |
|---|---|---|
| REQ-AE-01 | **Day book** | Every voucher for a period, filterable by type, party, user. The workhorse. |
| REQ-AE-02 | **Ledger extract** | All transactions for one ledger with running balance. Drill target for every party row in every other report. |
| REQ-AE-03 | **Cash and bank book** | Receipts and payments per cash/bank ledger over a period. |
| REQ-AE-04 | **Outstanding receivables** | Bill-wise, per party. Source for ageing. |
| REQ-AE-05 | **Outstanding payables** | Bill-wise, per vendor. |
| REQ-AE-06 | **Sales register / Purchase register** | Already REQ-W and REQ-X. Listed here so the catalogue is complete. |
| REQ-AE-07 | **Balance Sheet, P&L, Trial Balance** | **Deep-link to Tally. No figure is rendered in Vyuha.** A dashboard tile may show a pulled headline number with an explicit as-of stamp and a link; it must never be presentable as a statement. |
| REQ-AE-08 | **GSTR-1, GSTR-2B, GSTR-3B, TDS, TCS, 26AS** | **Not built. Ever.** Tally is the filing system and is certified for it. |

---

## 4. Area AF — Inventory mirrors

| ID | Report | Notes |
|---|---|---|
| REQ-AF-01 | **Stock summary** | Closing quantity, rate, value per item. Extended with Vyuha's committed and available columns (REQ-AC-03, AC-04). |
| REQ-AF-02 | **Godown summary** | Per-location stock. Conditional on D-29 — if there is one godown this report does not appear. |
| REQ-AF-03 | **Stock ageing** | Inventory bucketed by how long it has been held, with value locked up per bucket. |
| REQ-AF-04 | **Batch and expiry report** | Batch number, manufacture and expiry date, quantity. Conditional on whether the company maintains batches — D-34. |
| REQ-AF-05 | **Reorder status** | Items at or below reorder level, with open PO cover and shortfall. Already REQ-AC-06. |
| REQ-AF-06 | **Order status** | Open sales orders and open purchase orders with balance quantities. Sourced from Vyuha's own order data, not Tally's. |
| REQ-AF-07 | **Negative stock** | Items showing negative quantity in Tally. An exception report, not an inventory one — it means something was billed that was never received. |

---

## 5. Area AG — Commercial analysis

This is the part that does not exist in Tally, and the part the backfill was paid for.

### 5.1 Customer

| ID | Report | What it tells you |
|---|---|---|
| REQ-AG-01 | **Customer × product matrix** | What each customer buys, quantity, value, last purchase date. One grid, customers down, items across. The single most-used screen in this set, once it exists. |
| REQ-AG-02 | **Customer lapse report** | Customers who bought regularly and then stopped — expected next purchase date passed, no order. Ranked by the revenue at risk. **Nothing in Tally comes close to this**, and a lapsed customer is invisible until someone happens to notice. |
| REQ-AG-03 | **Purchase frequency and recency** | Orders per month, average gap between orders, days since last order, trend. The input to AG-02 and to knowing who to call. |
| REQ-AG-04 | **Customer price variance** | The same item sold to different customers at different rates, ranked by the spread. Answers "why is this customer paying 12% more" before the customer asks. |
| REQ-AG-05 | **Customer margin** | Realised rate against item cost, by customer. Requires cost — see D-35. |
| REQ-AG-06 | **Order fill rate** | Ordered against dispatched, per customer, from Vyuha's own quantities (`12` REQ-AA-01). Which customers are being short-supplied, and how often. |
| REQ-AG-07 | **Customer basket** | Item categories bought against categories not bought. Where the range is not being sold. |
| REQ-AG-08 | **New vs repeat revenue** | Revenue split by first-time and returning customers, by month. |
| REQ-AG-09 | **Customer concentration** | Revenue share of the top 5, 10, 20 customers. A dependency figure, not a sales one. |
| REQ-AG-10 | **Payment behaviour** | Already REQ-Y-04. Days-to-pay, trend, agreed against observed. |
| REQ-AG-11 | **Credit utilisation** | Exposure against limit, per customer, with headroom and breach history. Extends REQ-Y-03. |

### 5.2 Product

| ID | Report | What it tells you |
|---|---|---|
| REQ-AG-12 | **Product × customer** | The AG-01 matrix rotated. Who buys this item, and who used to. |
| REQ-AG-13 | **Item velocity** | Units per month with a moving average and trend. The basis of stock cover and of dead-stock detection. |
| REQ-AG-14 | **Stock cover in days** | Available quantity divided by velocity. "We have 40 days of this" is actionable; "we have 380 units" is not. |
| REQ-AG-15 | **Dead and slow stock** | No movement in N days, with the value locked up and the age of the oldest unit. Ranked by money, not by quantity. |
| REQ-AG-16 | **Movement analysis** | Inward by vendor, outward by customer, per item, per period. |
| REQ-AG-17 | **Rate erosion** | Realised sale rate for an item over time, against its cost over time. Where the margin is quietly going. |
| REQ-AG-18 | **Price band** | Minimum, maximum, average and median realised rate per item, with who got which. |
| REQ-AG-19 | **Items sold together** | Pairs and triples appearing on the same order more often than chance. Feeds quoting and the AG-07 basket gap. |
| REQ-AG-20 | **Item margin by period** | Requires cost — D-35. |
| REQ-AG-21 | **Rejection and return rate** | Per item, from GRN rejections (`13` REQ-X-21) and credit notes. Which items come back. |
| REQ-AG-22 | **ABC classification** | Items ranked by revenue contribution into A/B/C bands, refreshed monthly. Tells purchase where to spend attention. |

### 5.3 Vendor

| ID | Report | What it tells you |
|---|---|---|
| REQ-AG-23 | **Vendor × item history** | What was bought from whom, quantity, rate, date, with the rate trend. Feeds REQ-X-14 at the point of raising a PO. |
| REQ-AG-24 | **Vendor lead time — promised against actual** | PO date to GRN date, per vendor, per item, with variance. Uses `13` `item_vendors.lead_time_days` as the promise. |
| REQ-AG-25 | **Vendor fill rate** | Ordered against received, and how often a PO closes short. |
| REQ-AG-26 | **Vendor rejection rate** | Rejected quantity as a share of received, with reasons. |
| REQ-AG-27 | **Vendor price comparison** | The same item across vendors, current and historical, with the spread. The report that pays for itself on the first PO. |
| REQ-AG-28 | **Single-source exposure** | Items where one vendor supplies more than a threshold share. A risk report — the vendor who is 100% of an item is a business continuity question, not a purchasing one. |
| REQ-AG-29 | **Vendor spend concentration** | Spend share of the top vendors, by period. |
| REQ-AG-30 | **Payables ageing by vendor** | With payment-behaviour mirror of AG-10 — how promptly the business itself pays. |

### 5.4 Ageing, deeper than buckets

| ID | Report | What it tells you |
|---|---|---|
| REQ-AG-31 | **Receivables ageing** | 0–30, 31–60, 61–90, 90+, configurable. Already REQ-Y-02. |
| REQ-AG-32 | **Ageing roll-forward** | What moved between buckets this month — what aged, what was collected, what is newly overdue. **A bucket snapshot tells you where you are; the roll-forward tells you whether it is getting worse.** Tally shows the first and not the second. |
| REQ-AG-33 | **Ageing by salesperson** | Whose customers are slow. Requires the deal or order owner from CRM. |
| REQ-AG-34 | **Ageing by item category** | Whether particular product lines correlate with slow payment. |
| REQ-AG-35 | **Order stage ageing** | How long orders sit at each stage — awaiting invoice, awaiting stock, packed but not dispatched. Pure Vyuha data from `12`. This is where the working day leaks and no accounting system can see it. |
| REQ-AG-36 | **Requirement ageing** | How long shortages wait for a PO (`13` REQ-X-06). |
| REQ-AG-37 | **Stock ageing by value** | AF-03 ranked by money locked up rather than by age. |

---

## 6. Area AH — Exception reports

An exception report is one whose ideal state is empty. Each one below should be checkable in under a minute, and each should notify rather than wait to be opened.

| ID | Report |
|---|---|
| REQ-AH-01 | **Negative stock** — something billed that was never received |
| REQ-AH-02 | **Negative cash or bank balance** — an entry error, almost always |
| REQ-AH-03 | **Overdue receivables** and **overdue payables**, past due date |
| REQ-AH-04 | **Credit limit breaches**, current and historical, with who overrode and why |
| REQ-AH-05 | **Invoice with no dispatch** — billed, never sent |
| REQ-AH-06 | **Dispatch with no invoice** — sent, never billed. The expensive direction. |
| REQ-AH-07 | **Unlinked invoices** — an invoice in Tally with no resolvable sales order (`12` REQ-AA-13) |
| REQ-AH-08 | **Sold below cost** — realised rate under last purchase rate. Requires cost, D-35. |
| REQ-AH-09 | **Orders with no movement** in N days at any stage |
| REQ-AH-10 | **Sync exceptions** — already REQ-T-01 |
| REQ-AH-11 | **Stale projections** — a company whose last successful pull is older than a threshold |
| REQ-AH-12 | **Duplicate party and item candidates** — near-matching names in the Tally masters. Vyuha flags; the accountant merges in Tally. |
| REQ-AH-13 | **Approvals pending beyond SLA**, across every module |

---

## 7. Area AI — Dashboards

| ID | Requirement |
|---|---|
| REQ-AI-01 | Dashboards are **role-aware**, extending the four that exist. Sales, Sales manager, Purchase and Accounts get their own. |
| REQ-AI-02 | A dashboard tile is a **report with a visualisation and a drill target**, drawn from the same registry. It is never a separate query written twice. |
| REQ-AI-03 | Every tile is **clickable through to the report behind it**. A number with no path to its rows is an ornament. |
| REQ-AI-04 | Charts use **Recharts**, already in the stack. No second charting library. |
| REQ-AI-05 | A tile whose data is unavailable — no backfill, no cost — **is absent, not zero**. |

---

## 8. Sixty reports is too many to build, and that is the point of the catalogue

This document lists more than the business will use. Building all of it in one pass produces a menu nobody can navigate and a maintenance surface nobody wants. Three tiers:

**Tier 1 — Phase 6d.** Buildable from the backfill alone, no order data, no cost. AE-01…AE-06, AF-01, AF-03, AF-05, AG-01, AG-02, AG-03, AG-04, AG-10, AG-11, AG-12, AG-13, AG-15, AG-16, AG-23, AG-27, AG-31, AG-32, AH-01…AH-04, AH-11, AH-12. Around twenty-five, and AG-02 alone is likely worth the phase.

**Tier 2 — Phase 8a.** Needs Vyuha's own order, dispatch and GRN data. AF-06, AG-06, AG-24, AG-25, AG-26, AG-35, AG-36, AH-05, AH-06, AH-07, AH-09.

**Tier 3 — on evidence.** Everything else, built when someone asks for it by name. Margin reports wait on D-35 regardless.

**REQ-AD-09 makes this measurable.** Report opens are recorded. Review the list quarterly: anything not opened in ninety days and not on anyone's schedule is a candidate for retirement, and a Tier 3 report asked about twice is a candidate for promotion. A report catalogue that only grows is a catalogue nobody trusts to be relevant.

---

## 9. UI standards

`05-decisions` governs. Restated because a report surface is where these break first, and because sixty screens' worth of grids is exactly where somebody reaches for a data-grid library.

| ID | Requirement |
|---|---|
| REQ-AD-10 | **Every component comes from shadcn, installed via the shadcn MCP.** No other library, no hand-rolled components, no pasted source. This explicitly includes tables — no AG Grid, no TanStack Table UI, no MUI DataGrid. TanStack Table's headless core for sorting and pagination logic is acceptable; its markup is not. |
| REQ-AD-11 | **No native elements.** No `<select>`, no `<input type="date">`, no native checkbox. Named again because a filter bar is made almost entirely of the controls people reach for natively. |
| REQ-AD-12 | **The preset theme tokens only.** No hex value in a component, no arbitrary Tailwind colour, no per-report palette. Chart colours come from the theme's chart tokens. A report that invents its own colour is a report that will not match after the next theme change. |
| REQ-AD-13 | **One hierarchy, no card-inside-a-card.** A report is a page header, a filter bar, and a table. Not a card containing a card containing a table. |
| REQ-AD-14 | **No emojis.** `lucide-react` icons only, pending the P0-6 resolution — and P0-6 should be resolved before this area is built, because it is sixty screens' worth of icons. |
| REQ-AD-15 | **Fully responsive at 360px** using the existing mobile table pattern. Filters open as a bottom Sheet. Touch targets ≥44px. No hover-only interaction — a tooltip that carries the only explanation of a column does not exist on a phone. |
| REQ-AD-16 | **Keyboard-complete.** `Alt+F2` period, `F12` configure, `Enter` drill, `Alt+E` export, `Alt+P` print, `Esc` clear. Every shortcut carries its hint chip. A report a Tally user has to reach for the mouse to filter has failed the product's central promise. |

---

## 10. The date range control

Called out as its own section because every report in this document uses it, it is the control people touch most, and it is exactly the kind of thing that gets built three times.

| ID | Requirement |
|---|---|
| REQ-AD-17 | **One shared `PeriodPicker` component.** Every report uses it. It is not re-implemented per screen and it is not configurable into inconsistency. |
| REQ-AD-18 | Composed from **shadcn Popover + Calendar in range mode + Command for the presets + Button trigger**. Nothing else. Never a third-party date picker, never a native input. |
| REQ-AD-19 | Presets, in this order: **Today · Yesterday · This week · Last 7 days · This month · Last month · Last 30 days · This quarter · Last quarter · This financial year · Last financial year · Custom range**. |
| REQ-AD-20 | **The financial year is April to March**, consistent with the leave year in `05-decisions` and with how the books are actually kept. A picker offering a January-to-December "year" to a business filing on an Indian FY is wrong in a way that produces wrong numbers rather than a complaint. |
| REQ-AD-21 | Custom range opens a **two-month calendar** with from and to selected by clicking two dates, plus typed entry in the organisation's configured date format. The typed field accepts what a Tally user types, including `1-4-26`. |
| REQ-AD-22 | **Bound to `Alt+F2`** — Change Period in TallyPrime. This is not decoration; it is the key a Tally user will press without thinking, and it should open this control from anywhere. |
| REQ-AD-23 | The selected period **persists across module switches** (REQ-O-06) and is stored per user, so it survives a reload. |
| REQ-AD-24 | Where a report has data only for part of the selected range, it **says so** rather than showing a short period as a decline. |
| REQ-AD-25 | On mobile the picker opens as a **bottom Sheet**, presets as a full-width list, calendar single-month. |
| REQ-AD-26 | The trigger shows the **resolved dates, not the preset name** — "1 Apr 2026 – 31 Mar 2027", not "This financial year". A label that hides what it resolved to causes an exported file whose contents nobody can reconstruct. |

---

## 11. Acceptance

- Adding a report requires a registry entry and a query. No new route file. Asserted by a test that counts route components against registry entries.
- Every report row drills to something, verified for one row of every registered report.
- No component in the reports area imports from any package other than the project's shadcn components. Asserted by lint.
- No hex colour appears in any report or chart component. Asserted by lint.
- The `PeriodPicker` appears exactly once in the codebase. `Alt+F2` opens it from every report screen and from the dashboard.
- Selecting "This financial year" in April resolves to 1 April of that year, not 1 January.
- Every report renders and is usable at 360px, and every filter is reachable without hovering.
- A report needing cost does not appear at all while D-35 is unanswered — it does not render zeros.
- Every report meets NFR-02 against the full backfill, or is nightly-materialised and says when it was computed.

---

## 12. Open decisions

| # | Question | Blocks | Recommended default in use |
|---|---|---|---|
| D-34 | **Does the company maintain batches and expiry in Tally?** | REQ-AF-04 | Assuming **no**. Switchgear is unlikely to need it. If yes, the batch report and batch-wise ageing follow, and stock ageing becomes batch-based rather than FIFO-assumed. |
| D-35 | **Is item cost available, and on what valuation method?** | Every margin report — AG-05, AG-17, AG-20, AH-08 | Unknown, and it gates roughly eight reports. Tally holds a valuation (FIFO, weighted average, standard rate) per item. Which method is set changes what "margin" means, so the answer has to come before the reports rather than being assumed. Until it is answered those reports are absent, not empty. |
| D-36 | **Lapse thresholds for AG-02** — after how many missed expected orders is a customer lapsed? | REQ-AG-02 | Default: expected gap × 2, where expected gap is the customer's own median. Configurable. Deliberately per-customer rather than a flat "90 days", because a monthly buyer and an annual buyer lapse at different speeds. |
| D-37 | **Who sees margin?** | AG-05, AG-17, AG-20 | A new permission `reports.margin.view`, held by Sales manager, Accounts and Admin. Not by Sales. Cost visibility is a commercial decision, not a reporting one. |
| D-38 | **Are dashboards and exception reports pushed, or pulled?** | REQ-AH-* | Exception reports **notify** through the existing dispatcher when non-empty, on a daily sweep. An exception report that waits to be opened is not doing its job. |
| D-39 | **Retention on report-usage records (REQ-AD-09)?** | §8 | 12 months, aggregated monthly thereafter. Enough to run the quarterly review. |
