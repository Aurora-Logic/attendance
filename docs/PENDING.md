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
| A-01 | Remove Corrections | The `/regularizations` screen and feature, its nav item, tour step, the day-sheet "Correct this day" link, the two settings keys, and every `/regularizations` and `/on-duty` route are gone; `regularization.raise` / `regularization.approve` are deleted from the catalogue (the seed reconciler removes them from every role; the dev DB is already clean). Nothing needed migrating: open corrections were approval requests all along, so they remain in Approvals and are decided by `attendance.edit` holders through the ordinary Approve/Reject, with the server-side handlers kept so an approval still writes its adjustment and recomputes the day (new endpoint test) | On-duty requests go with it. Open correction requests stay decidable in Approvals until cleared (read-only server handler) | Done |
| A-02 | Admin-recorded attendance | `POST /punches/admin` (`attendance.edit`) records an IN or OUT for any employee, the admin included, with source `ADMIN_ENTRY`, `recorded_by_user_id`, the named instant and a required reason; no photo (the photo columns are nullable for this source only), no location, no window verdict — the admin's reason is the verdict, so the engine never flags it late or out of window. It sits beside the employee's own punches, obeys ordering and period locks, counts in the day, and is audited as `punch.admin_recorded`. The day record shows "Recorded by admin (name)"; Approvals carries the Record attendance action and dialog (employee picker, IN/OUT, date, time, reason) | Counts in the day computation. Gated on `attendance.edit`. Admin may record for anyone including themselves | Done |
| A-03 | Late / out-of-window flags | A late IN or an out-of-window punch is always recorded, flagged, and raised as a `FLAGGED_PUNCH` approval (one per punch). From Approvals an admin with `attendance.edit` can Accept (the day engine stops raising the flag, through a `punch_flag_reviews` row since punches are append-only), Keep flagged, Mark half day (the existing day override) or Add note; plain Approve/Reject still map to accept/keep; every action is audited as `punch.flag_reviewed`. Flags render as a pennant icon with a tooltip product-wide; the punch row says who accepted or kept it. The punch-window behaviour setting is retired from the catalogue, Settings and the punch screen (the reason field is now an optional note to the reviewer) | Always accept and flag; the punch-window behaviour setting (block / allow with reason) is retired | Done |
| A-04 | Early arrival | The day engine records `early_arrival_minutes`, the `early_arrival` verdict (first IN ahead of shift start by the threshold, on a worked day) and a running `early_streak` on every day row — a worked day that is not early resets it, days off carry it forward. Settings → Attendance policy gains the on/off toggle and the threshold (a duration picker, 5-minute steps, default 15). The punch screen fires a hand-rolled canvas confetti (theme colours, off under reduced motion) on an accepted early IN and says so on the receipt; the profile and Team attendance wear an early-streak badge. Four engine unit tests cover the verdict, the reset, the carry-forward and the off switch | Hand-rolled confetti, no dependency. Default threshold 15 minutes | Done |
| A-05 | Geofence | The punch endpoint now refuses: outside the radius (`PUNCH_OUTSIDE_GEOFENCE`), no position (`PUNCH_LOCATION_REQUIRED`), and an office with no coordinates (`PUNCH_GEOFENCE_NOT_CONFIGURED`, also announced in the punch context so the screen shows the blocked state). The field-staff exemption is gone. Only a fix outside by less than its own accuracy is accepted, flagged `low_gps_accuracy`. Web punch page waits for a position instead of offering a reason. Consequence to know: every employee must belong to a location with coordinates, or they cannot punch. Tests: outside-radius, no-position, tolerated fix, unconfigured office | Only the GPS-accuracy tolerance survives. Field-staff exemption, "no fix → allow with reason" and "centre not set → allow and flag" are removed. Radius stays per office, editable, default 100 m | Done |
| A-06 | Time pickers | Clock fields already use the shadcn TimeField; the typed duration fields (break, grace, logout window, half/full-day thresholds) now use `DurationField` — hours + minutes Selects in the same sheet/popover surface; nothing in a policy is typed | Hours + minutes in 5-minute steps, same picker surface | Done |
| A-07 | Sidebar header | The line under the organisation name is the active module's label, read from the route, so it changes with the module switcher | — | Done |
| A-08 | REQ IDs in copy | No screen is named Products; REQ-E-03 / REQ-C-02 rendered in the Shift editor help text. Every REQ ID is stripped from rendered copy across 45 files (help, notes, descriptions, JSX text); code comments keep them | Confirmed: the Shift editor | Done |
| A-09 | Credential endpoint privilege escalation | `POST /employees/:id/access/credentials` (found by the P-18 security review) let `employee.manage` reset any same-org account, including an Admin's, and attach any role | Fixed: gated on `roles.manage`, role validated to the org, a target holding permissions the caller lacks is refused; four endpoint tests | Done |

---

# Pending — Glyphs, reports, audit (22 Aug 2026)

Owner, 22 Aug 2026: after the flag glyph, "what else like this" — and more reports, dashboards and charts through the data-analyst lens, and every screen audited with emil-design-eng and thumb-reach.

| ID | Item | Description | Status |
|----|------|-------------|--------|
| B-01 | Approval-type glyphs | One glyph per request type (`APPROVAL_TYPE_ICONS`), worn in inbox rows, the type filter and every bell row | Done |
| B-02 | Attendance status glyphs | One glyph per status (`ATTENDANCE_STATUS_ICONS`) on the pill and the calendar legend, hence the muster and every day list | Done |
| B-03 | Punch source glyphs | Phone, browser, offline sync, admin entry (`PUNCH_SOURCE_ICONS`) on day-sheet punch rows and the profile punch list; the source chart keeps its colours | Done |
| B-04 | Document-type glyphs | Estimate, order, invoice, dispatch, PO, GRN (`DOCUMENT_ICONS`) on the six list pages; Go To reads the same table | Done |
| B-05 | Flag review log | Who accepted / kept / half-dayed what, per admin per week | Not started |
| B-06 | Approvals turnaround | Median and p90 time-to-decision by request type; oldest pending | Not started |
| B-07 | Early-arrival leaderboard | Current streaks and early minutes by employee and department | Not started |
| B-08 | On-time rate by department | Radial grid | Not started |
| B-09 | AOV trend | Average order value by month, FY comparison | Not started |
| B-10 | Partial shipments by customer | Orders needing two dispatches or a short-close ÷ orders dispatched | Not started |
| B-11 | Vendor lead time | PO confirm to GRN, median and p90, against promised days | Not started |
| B-12 | Stock-out frequency | Requirements raised from shortage per item per month | Not started |
| B-13 | Gross margin proxy | Realised rate minus held cost, by item and customer, behind `reports.margin.view` | Not started |
| B-14 | Sales heatmap | Customer × month grid, the matrix's dense-grid form | Not started |
| B-15 | Attendance block on the Reports dashboard | On-time radial, open flags, oldest pending approval, top streaks | Not started |
| B-16 | Screen audit | Every route through emil-design-eng and thumb-reach; findings fixed | Not started |

