# Pending — Reporting & Analytics Overhaul + Mobile Navigation

Working table for the 21 Aug 2026 brief. Statuses reflect the code as it
stands on `phase-6a`, which is ahead of the brief in several places (the
brief predates the Reports module, the module switcher and CRM/Sales/
Purchase going live). Updated as work lands.

| ID | Item | Description | Area | Decision needed? | Status |
|----|------|-------------|------|------------------|--------|
| P-01 | Data analyst skill | `.claude/skills/data-analyst/SKILL.md`: metric dictionary, chart matrix, FY comparison rules, report spec template, drill rules | Skills | No | Done |
| P-02 | Report catalogue from the skill | Approved set built: customer concentration, order pipeline, dispatch performance, order fill rate, new-vs-repeat, requirement ageing — all live with matrix-picked charts (hbar rankings, two-series line for new/repeat); bill-wise-blocked ones stay absent | Reports | Approved | Done |
| P-03 | platform/charts layer | Bar, grouped, stacked, horizontal bar, line, donut, radial, radial-share and scatter live with theme tokens, tooltips, legends, skeletons and the table as fallback; the generic engine picks the form by the matrix with per-report overrides (scatter: customer × product, invoices against value, dots drill to the item). Area, combo and sparkline stay unbuilt honestly: no report carries a target series (combo), a volume-under-trend question (area) or in-row series data (sparkline) yet — the matrix names them for when one does | Platform | No | Done |
| P-04 | Comparison control | Year·Quarter·Month + off/vs-previous/vs-last-FY, Indian FY, like-for-like partial periods, URL state; deltas in tables, in the generic chart, in the bespoke sales-analysis chart (grouped, comparison muted) and in CSV/XLSX exports (previous + change columns joined by the screen's own row key); the party filter scopes both periods and the compare caption says so. KPI deltas: the one flow tile (Revenue this FY) carries its delta; as-of tiles are states and correctly carry none. Overlays are only on charts whose form takes one — movement/velocity already carry two series, radials and as-of stacks are single-period by meaning | Reports | No | Done |
| P-05 | Reports dashboard | Seven KPI tiles (Revenue-this-FY leads with a vs-last-FY-to-date delta), fulfilment RateRadial from the fill-rate report, open-pipeline ranking, sales-by-month, movement, lapse, composition donut, top-5 share radial, top customers, stock-ageing — all on bordered panels, all drill-throughs. As-of tiles (exposure, dead stock) carry no period delta because they are states, not flows | Reports | Decided | Done |
| P-06 | Dual view on report pages | Table·Chart·Both toggle per report per device; chart reads the full filtered set to a 200-row cap (says so past it, sorted by the report's meaning); clicking a bar or donut slice applies that value as the matching filter (party by id, item/voucher-type/ledger by value) and lands on the table; segments whose report has no filter for their category are not pretend-clickable, and 'Other' never drills | Reports | No | Done |
| P-07 | PDF export | Print / save as PDF action in every report's export menu; @media print strips the shell (sidebar, header, nav) so the report and dashboard print clean; Excel/CSV carry the comparison columns when compare is on | Exports | Decided: browser print | Done |
| P-08 | Attendance nav regroup | Me / Team / People, Administration separate — owner confirmed 21 Aug | Nav | Confirmed | Done |
| P-09 | Module switcher | Desktop switcher + per-module sidebars, namespaced routes, permission-gated | Nav | No | Done (predates brief: Attendance/Masters/CRM/Sales/Purchase/Reports all live) |
| P-10 | Approvals/export framework out of attendance keys | Approvals inbox + report/export framework live in `platform/` and are not gated on attendance permission keys | Platform | No | Done (approvals: platform/approvals; reports/export: platform/export; per-module sources) |
| P-11 | Mobile bottom nav per module | The bar follows the active module (per-module remembered customisation, v1 preference migrated to Attendance); More opens with a module switcher row, the module's destinations, then Administration and inbox; safe-area kept | Nav | No | Done |
| P-12 | Mobile creation screens | One-row phone bar (back·title·Preview·overflow sheet with PDF/Excel/Design), the page's verbs in a sticky footer above the safe area, decimal keypads on qty/rate/disc/tax cells, sheet pickers kept, and a sessionStorage draft backup that restores a new document after a dropped connection and clears on save | Documents | Decided | Done |
| P-13 | Report sort control | Desktop sorts by clicking column headers (with direction indicators); the compact Select remains for phones, where stacked rows have no headers | Reports | No | Done |
| P-14 | REQ IDs in report copy | Doc references stripped from every report description | Reports | No | Done |
| P-15 | Daily exception notifications | A 01:45 daily job counts the four exception reports per org from the same SQL the reports serve, and notifies holders of the new `reports.exceptions.notify` permission (seeded: Admin, Accounts) only when something is non-empty; the same pass prunes `report_usage` past 12 months | Platform | No | Done |
| P-16 | Report usage recording | Every first page of a report writes an open (deduped within a minute, fire-and-forget); table `report_usage`, migration 0043; pruned by the P-15 sweep | Platform | No | Done |
| P-17 | FY period presets | The §10 preset row on the period picker — Today, Yesterday, Last 7 days, This/Last month, Last 30 days, This/Last quarter, This/Last FY (Apr–Mar, FY-aware maths) — one tap sets and closes; Alt+F2 already opens the picker on every report | Reports | No | Done |
| P-18 | /ultrareview + /security-review | Close-out reviews | QA | No | Not started (ultrareview is owner-triggered: run `/code-review ultra` when ready) |
| P-19 | Mobile report toolbar | Filters, compare and sort move into a bottom sheet behind one Filters button on phones (REQ-AD-15); Views and Columns stay reachable; view toggle compact icons | Reports | No | Done |
| P-20 | Raw `__all__` in a select | The parties page's ledger-side select rendered its sentinel; every bare SelectValue audited, the others show real values | UI | No | Done |
| P-21 | Tab-strip scrollbar | Scrolling tab lists (Settings) hide the bar itself via a no-scrollbar utility; data tables keep theirs | UI | No | Done |
| P-22 | thumb-reach / emil audit of every screen | Systematic pass over all screens and buttons with both skills; reports toolbar done as the first | UI | No | In progress |

Notes:
- "2,033 existing tests" in the brief: the suite is now 461 web + 1830 api + 41 shared ≈ 2,332; all green as of the last push.
- The brief's "only attendance exists; others are placeholders" predates
  phase 6–8: CRM, Sales, Purchase, Masters and Reports are live modules.
