# Pending — Reporting & Analytics Overhaul + Mobile Navigation

Working table for the 21 Aug 2026 brief. Statuses reflect the code as it
stands on `phase-6a`, which is ahead of the brief in several places (the
brief predates the Reports module, the module switcher and CRM/Sales/
Purchase going live). Updated as work lands.

| ID | Item | Description | Area | Decision needed? | Status |
|----|------|-------------|------|------------------|--------|
| P-01 | Data analyst skill | `.claude/skills/data-analyst/SKILL.md`: metric dictionary, chart matrix, FY comparison rules, report spec template, drill rules | Skills | No | Done |
| P-02 | Report catalogue from the skill | Approved set built: customer concentration, order pipeline, dispatch performance, order fill rate, new-vs-repeat, requirement ageing — all live with matrix-picked charts (hbar rankings, two-series line for new/repeat); bill-wise-blocked ones stay absent | Reports | Approved | Done |
| P-03 | platform/charts layer | Bar, grouped, stacked, horizontal bar, line, donut, radial, radial-share all live with theme tokens, tooltips, legends, skeletons and the table as fallback; the generic engine picks the form by the matrix (time → line, ranking → horizontal, composition → donut) with per-report overrides. Remaining: area/combo/scatter/sparkline when a report's question calls for one | Platform | No | In progress — eight forms live |
| P-04 | Comparison control | Year·Quarter·Month + off/vs-previous/vs-last-FY, Indian FY, like-for-like partial periods, URL state; deltas in tables (Previous/Change columns) and the generic chart (muted overlay). Remaining: deltas on KPI tiles, bespoke-chart overlays, deltas in exports, party scope | Reports | No | In progress — core + table + generic chart live |
| P-05 | Reports dashboard | Seven KPI tiles (Revenue-this-FY leads with a vs-last-FY-to-date delta), fulfilment RateRadial from the fill-rate report, open-pipeline ranking, sales-by-month, movement, lapse, composition donut, top-5 share radial, top customers, stock-ageing — all on bordered panels, all drill-throughs. As-of tiles (exposure, dead stock) carry no period delta because they are states, not flows | Reports | Decided | Done |
| P-06 | Dual view on report pages | Table·Chart·Both toggle per report per device; chart reads the full filtered set to a 200-row cap (says so past it, sorted by the report's meaning); chart drill pending | Reports | No | In progress — full-set chart fetch live; chart-drill pending |
| P-07 | PDF export | Print / save as PDF action in every report's export menu; @media print strips the shell (sidebar, header, nav) so the report and dashboard print clean. Excel delta columns still pending | Exports | Decided: browser print | Done (Excel deltas pending) |
| P-08 | Attendance nav regroup | Me / Team / People, Administration separate — owner confirmed 21 Aug | Nav | Confirmed | Done |
| P-09 | Module switcher | Desktop switcher + per-module sidebars, namespaced routes, permission-gated | Nav | No | Done (predates brief: Attendance/Masters/CRM/Sales/Purchase/Reports all live) |
| P-10 | Approvals/export framework out of attendance keys | Approvals inbox + report/export framework live in `platform/` and are not gated on attendance permission keys | Platform | No | Done (approvals: platform/approvals; reports/export: platform/export; per-module sources) |
| P-11 | Mobile bottom nav per module | Bottom bar shows the active module's top destinations; More sheet holds the full grouped nav; module switching reachable on mobile; safe-area insets | Nav | No | Not started |
| P-12 | Mobile creation screens | Estimate/SO/PO editors usable one-handed: compact toolbar + overflow (owner chose paper-stays, no second entry model), sticky total/action, numeric keypads, no zoom-on-focus, sheet-based pickers kept | Documents | No (decided 21 Aug) | Not started |
| P-13 | Report sort control | Desktop sorts by clicking column headers (with direction indicators); the compact Select remains for phones, where stacked rows have no headers | Reports | No | Done |
| P-14 | REQ IDs in report copy | Doc references stripped from every report description | Reports | No | Done |
| P-15 | Daily exception notifications | Non-empty exception reports notify Admin+Accounts daily via the dispatcher (owner decided 21 Aug) | Platform | No | Not started |
| P-16 | Report usage recording | REQ-AD-09: opens recorded, 12-month retention | Platform | No | Not started |
| P-17 | FY period presets | §10 presets (Today…This financial year, Apr–Mar) on the period control, Alt+F2 everywhere | Reports | No | Not started |
| P-18 | /ultrareview + /security-review | Close-out reviews | QA | No | Not started (ultrareview is owner-triggered: run `/code-review ultra` when ready) |

Notes:
- "2,033 existing tests" in the brief: the suite is now 461 web + 1830 api + 41 shared ≈ 2,332; all green as of the last push.
- The brief's "only attendance exists; others are placeholders" predates
  phase 6–8: CRM, Sales, Purchase, Masters and Reports are live modules.
