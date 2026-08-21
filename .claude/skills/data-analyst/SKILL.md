---
name: data-analyst
description: The business-development analytics lens for Vyuha. Use before designing, changing or reviewing any report, chart, KPI tile or comparison feature - it decides what reports exist, what each metric means, which chart tells that story, and where every aggregate drills to. Also use when someone asks "what should this report show", "which chart", "how do we compare periods", or proposes a new analytics surface.
---

# Data analyst — the BD lens

A report exists to change a decision someone makes this week: who to call,
what to buy, what to chase, what to stop stocking. Before designing one,
name the decision. If no decision survives, the report is a vanity surface
and does not ship.

Ground rules inherited from the product (they override taste):
- Vyuha never reproduces Tally's statutory or statement reports (doc 14 §1).
  Mirror or analyse; never re-file.
- A report that needs data the system does not hold is **absent, not zero**
  (REQ-AD-07). Bill-wise allocations, ledger groups and item cost gate real
  metrics below — say so in the spec rather than approximating.
- Requirement IDs and doc references never appear in user-facing copy.

## 1. Metric dictionary

Definitions are exact because two people disagreeing about "revenue" by one
voucher type will reconcile forever. `Needs` names the data the metric is
honest with; a metric whose Needs are unmet is not computed another way.

| Metric | Definition | Needs |
|---|---|---|
| Revenue | Sum of non-cancelled `Sales` voucher amounts in the period, from the projection. Credit Notes subtract. | vouchers |
| Order value / count | Confirmed Vyuha sales orders in the period: grand total sum, and count. Drafts and cancelled excluded. | sales_documents |
| AOV | Revenue ÷ count of distinct Sales vouchers in the period. | vouchers |
| Gross margin proxy | (Realised rate − item cost held in the projection) × qty, weighted-average cost (D-46). A proxy — say "proxy" in the UI. | voucher_lines + cost |
| Fulfilment rate | Dispatched qty ÷ ordered qty on confirmed orders, period by order date. | order lines |
| Partial-shipment rate | Orders with ≥2 dispatches or a short-close ÷ orders dispatched at all. | dispatches |
| Dispatch lead time | Confirm→first dispatch, median and p90 days. Averages hide the tail; the tail is the complaint. | orders + dispatches |
| Receivables ageing | Open bill amounts bucketed 0–30/31–60/61–90/90+ by due date. | **bill-wise (absent, P6b-5)** |
| Credit cycle days (DSO) | Period receivables ÷ period credit sales × days. Bill-wise makes it per-party honest; without it, org-level only, labelled approximate. | vouchers (org), bills (party) |
| Payment delay | Receipt date − due date per settled bill, median. | **bill-wise (absent)** |
| Repeat-purchase rate | Parties with ≥2 Sales vouchers in period ÷ parties with ≥1. | vouchers |
| Customer concentration | Top 5/10/20 parties' share of period revenue. | vouchers |
| Dormancy / churn | Party whose gap since last Sale exceeds its own median gap ×2 (D-46 fixed thresholds); N-day flat cutoffs lie across buyer rhythms. | vouchers |
| Vendor lead time | PO confirm→GRN received, median and p90, vs promised `lead_time_days`. | POs + GRNs |
| Vendor price variance | Same item, last rate per vendor, spread % best→worst. | purchase lines |
| Stock-out frequency | Requirements raised from shortage per period, and the items that repeat. | requirements |

## 2. Chart selection matrix

The question picks the form. A report may need three charts; it gets three.
A question no chart answers better than rows gets a table and no chart.

| Question shape | Chart | Notes |
|---|---|---|
| Trend over time | Line | One measure, one hue |
| Trend with volume | Area | Volume under the line, never stacked >3 |
| Trend vs target | Combo bar + line | Bars actual, line target |
| Composition of a whole (static) | Donut | ≤5 slices + Other; label slices |
| Composition changing over time | Stacked bar | One hue family when segments are ordered (age), fixed categorical order otherwise |
| Progress toward target / rate of one measure | **Radial** | Fulfilment %, collection vs target, capacity used |
| Several rates side by side | **Radial stacked / grid of radials** | ≤5 rings, fixed ramp order, never cycled |
| Ranking (top/bottom N) | Horizontal bar | N ≤ 10; the table has the rest |
| Period-over-period | Grouped bar, or bar + delta line | Current solid, comparison muted/dashed |
| Distribution / ageing buckets | Bar with bucket bands | Sequential one-hue ramp |
| Two-variable relationship | Scatter | e.g. discount % vs volume; annotate outliers |
| Dense grid (party × month) | Heatmap matrix | Sequential ramp; cell click drills |
| In-row trend inside a table | Sparkline | No axes; the row is the label |

Colour: theme tokens only. Categorical = the five-step ramp in fixed order,
folding into "Other" past five. Status colours (destructive/warning/success)
are reserved for states and never mean "series 4". Sequential = one hue.

## 3. Comparison framework

- **Financial year is April–March.** "This year" in July 2026 = 1 Apr 2026 →
  today. "Same period last year" maps by day-of-FY, not calendar copy-paste.
- Granularity: Year · Quarter (FY quarters: AMJ, JAS, OND, JFM) · Month.
- **Partial periods compare like-for-like to date**: 1–21 Aug vs 1–21 Aug
  last year, never 21 days vs 31. The UI says "to date" when it does this.
- Deltas show absolute + %, with a direction indicator; when the base is
  zero the % is not "∞" or "100%": show "new" (0→x) or "—" (0→0).
- The comparison series renders muted/dashed beside the solid current one;
  tables gain previous / Δ / Δ% columns; KPI tiles show the delta under the
  headline. Comparison state lives in the URL and flows into exports.

## 4. Report spec template

Every report is specified before it is built:

```
Purpose:      the decision it changes
Audience:     who acts on it (role)
Grain:        one row = ?
Filters:      period always; then the report's own
Default chart(s): from the matrix, with the question each answers
Alternate charts: only if a second question genuinely lives here
Comparison:   which of Y/Q/M + vs-previous / vs-last-FY apply
Drill-down:   where a row/segment goes (see §5)
Exports:      XLSX always; PDF when printable layout exists; deltas carried
Needs:        data it depends on; absent when unmet
```

## 5. Drill-down rules

Every aggregate leads somewhere; a number with no path to its rows is an
ornament (REQ-AI-03).

- Chart segment → the same report filtered to that segment, in table view.
- Party row/segment → the party (masters), or its statement where money.
- Item row → the item; vendor row → vendor×item history.
- Voucher-level cells → the voucher in Books.
- Order/PO rows → the document page.
- A drill carries the period, filters and comparison state with it.

## 6. Insights

An insight is a sentence the series proves, computed with named, tested
thresholds — never composed in JSX, never vibes. Insufficient data states
its insufficiency. Never surface an insight a viewer's permissions would
not let them see raw (margin behind `reports.margin.view`, D-46).
