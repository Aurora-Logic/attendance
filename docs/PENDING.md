# Pending — Reporting & Analytics Overhaul + Mobile Navigation

Working table for the 21 Aug 2026 brief. Statuses reflect the code as it
stands on `phase-6a`, which is ahead of the brief in several places (the
brief predates the Reports module, the module switcher and CRM/Sales/
Purchase going live). Updated as work lands.

| ID | Item | Description | Area | Decision needed? | Status |
|----|------|-------------|------|------------------|--------|
| P-01 | Data analyst skill | `.claude/skills/data-analyst/SKILL.md`: metric dictionary, chart matrix, FY comparison rules, report spec template, drill rules | Skills | No | Done |
| P-02 | Report catalogue from the skill | Full BD report set specified per the template; owner approved 21 Aug: five new reports (concentration, order pipeline, dispatch performance, fill & new-vs-repeat, requirement ageing); bill-wise-blocked ones listed absent | Reports | Approved | In progress |
| P-03 | platform/charts layer | Shared chart components over shadcn/Recharts: bar, grouped, stacked, horizontal, line, multi-line, area, stacked area, combo, donut, radial, radial-stacked, scatter, sparkline; tokens, tooltips, legends, en-IN axes, skeleton/empty, table fallback | Platform | No | In progress — bar/grouped/stacked/radial exist in `features/reports/report-charts.tsx`; to lift to `platform`-style shared home and add line/area/combo/donut/scatter/sparkline as reports need them |
| P-04 | Comparison control | Year·Quarter·Month + off/vs-previous/vs-last-FY, Indian FY, like-for-like partial periods, URL state; deltas in tables (Previous/Change columns) and the generic chart (muted overlay). Remaining: deltas on KPI tiles, bespoke-chart overlays, deltas in exports, party scope | Reports | No | In progress — core + table + generic chart live |
| P-05 | Reports dashboard | KPI tiles with deltas, trend + granularity, composition, radial rates, top/bottom parties, ageing snapshot, drill-through with state carried. Owner 21 Aug: ship without collection/overdue until bill-wise | Reports | Decided | In progress — tiles+3 charts live; deltas, granularity, composition and radial-rate block pending |
| P-06 | Dual view on report pages | Table·Chart·Both toggle per report per device; chart reads the full filtered set to a 200-row cap (says so past it, sorted by the report's meaning); chart drill pending | Reports | No | In progress — full-set chart fetch live; chart-drill pending |
| P-07 | PDF export | Owner re-confirmed browser print (21 Aug, twice): a clean print layout per report and dashboard, Save-as-PDF in the dialog; Excel gains delta columns when comparisons land | Exports | Decided: browser print | Not started |
| P-08 | Attendance nav regroup | Me / Team / People, Administration separate — owner confirmed 21 Aug | Nav | Confirmed | Done |
| P-09 | Module switcher | Desktop switcher + per-module sidebars, namespaced routes, permission-gated | Nav | No | Done (predates brief: Attendance/Masters/CRM/Sales/Purchase/Reports all live) |
| P-10 | Approvals/export framework out of attendance keys | Approvals inbox + report/export framework live in `platform/` and are not gated on attendance permission keys | Platform | No | Done (approvals: platform/approvals; reports/export: platform/export; per-module sources) |
| P-11 | Mobile bottom nav per module | Bottom bar shows the active module's top destinations; More sheet holds the full grouped nav; module switching reachable on mobile; safe-area insets | Nav | No | Not started |
| P-12 | Mobile creation screens | Estimate/SO/PO editors usable one-handed: compact toolbar + overflow (owner chose paper-stays, no second entry model), sticky total/action, numeric keypads, no zoom-on-focus, sheet-based pickers kept | Documents | No (decided 21 Aug) | Not started |
| P-13 | Report sort control | The loose text-button sort strip becomes one Select + direction button | Reports | No | Done |
| P-14 | REQ IDs in report copy | Doc references stripped from every report description | Reports | No | Done |
| P-15 | Daily exception notifications | Non-empty exception reports notify Admin+Accounts daily via the dispatcher (owner decided 21 Aug) | Platform | No | Not started |
| P-16 | Report usage recording | REQ-AD-09: opens recorded, 12-month retention | Platform | No | Not started |
| P-17 | FY period presets | §10 presets (Today…This financial year, Apr–Mar) on the period control, Alt+F2 everywhere | Reports | No | Not started |
| P-18 | /ultrareview + /security-review | Close-out reviews | QA | No | Not started (ultrareview is owner-triggered: run `/code-review ultra` when ready) |

Notes:
- "2,033 existing tests" in the brief: the suite is now 461 web + 1830 api + 41 shared ≈ 2,332; all green as of the last push.
- The brief's "only attendance exists; others are placeholders" predates
  phase 6–8: CRM, Sales, Purchase, Masters and Reports are live modules.
