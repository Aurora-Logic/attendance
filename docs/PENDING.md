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
| P-22 | thumb-reach / emil audit of every screen | Source-level pass over every violation class both skills name (Chrome verification is off by owner instruction). Floors are systemic: every Button size carries a pointer-coarse 44px overlay; every Popover picker sheet-switches via useIsMobile; boards force list view on phones; tables card-collapse; tab strips hide their bar; no transition-all, no hover-gated controls, sheets pin edges with min-h-0 scroll. Fixed this pass: the report export menu was a four-row dropdown pinned to the top-right corner on phones — now a bottom sheet. Accepted with reasons: the Views menu (trigger sits mid-toolbar, not the corner) and centred-dialog footer stacking (mid-screen reach, guards long labels) | UI | No | Done |

Notes:
- "2,033 existing tests" in the brief: the suite is now 461 web + 1830 api + 41 shared ≈ 2,332; all green as of the last push.
- The brief's "only attendance exists; others are placeholders" predates
  phase 6–8: CRM, Sales, Purchase, Masters and Reports are live modules.

---

# Pending — Attendance changes (21 Aug 2026, second brief)

| ID | Item | Description | Decision (owner, 21 Aug) | Status |
|----|------|-------------|--------------------------|--------|
| A-01 | Remove Corrections | Delete the `/regularizations` screen, routes, nav item, permission keys `regularization.raise`/`.approve`, the two settings keys, tour steps and the day-sheet link; retire the raise endpoints | On-duty requests go with it. Open correction requests stay decidable in Approvals until cleared (read-only server handler) | Not started |
| A-02 | Admin-recorded attendance | `ADMIN_ENTRY` punch source with actor, target, required reason, timestamp; recorded from Approvals; labelled "Recorded by admin" on the day record; audited; never replaces the employee's own punch | Counts in the day computation. Gated on `attendance.edit`. Admin may record for anyone including themselves | Not started |
| A-03 | Late / out-of-window flags | Auto-flag, land in Approvals; admin actions Accept / Keep flagged / Mark half day / Add note, each audited; flag icon with tooltip; distinct icon | Always accept and flag; the punch-window behaviour setting (block / allow with reason) is retired | Not started |
| A-04 | Early arrival | Confetti on the punch screen when IN is earlier than shift start by the threshold; streak per employee on profile and Team attendance; resets on a non-early working day; threshold + toggle in Settings | Hand-rolled confetti, no dependency. Default threshold 15 minutes | Not started |
| A-05 | Geofence | Server-side check already exists; tighten | Only the GPS-accuracy tolerance survives. Field-staff exemption, "no fix → allow with reason" and "centre not set → allow and flag" are removed: an office with no coordinates cannot punch until they are set. Radius stays per office, editable, default 100 m | Not started |
| A-06 | Time pickers | Clock fields already use the shadcn TimeField; the typed duration fields (break, grace, logout window, half/full-day thresholds) now use `DurationField` — hours + minutes Selects in the same sheet/popover surface; nothing in a policy is typed | Hours + minutes in 5-minute steps, same picker surface | Done |
| A-07 | Sidebar header | The line under the organisation name is the active module's label, read from the route, so it changes with the module switcher | — | Done |
| A-08 | REQ IDs in copy | No screen is named Products; REQ-E-03 / REQ-C-02 rendered in the Shift editor help text. Every REQ ID is stripped from rendered copy across 45 files (help, notes, descriptions, JSX text); code comments keep them | Confirmed: the Shift editor | Done |
| A-09 | Credential endpoint privilege escalation | `POST /employees/:id/access/credentials` (found by the P-18 security review) let `employee.manage` reset any same-org account, including an Admin's, and attach any role | Fixed: gated on `roles.manage`, role validated to the org, a target holding permissions the caller lacks is refused; four endpoint tests | Done |

