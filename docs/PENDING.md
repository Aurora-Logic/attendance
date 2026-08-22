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
| P-23 | Code splitting | Owner's review 22 Aug: the web build is one ~3 MB chunk (805 kB gzip) over 63 routes, `React.lazy` unused. Split per module route at least; measure first-load on a phone | Web | No | Not started |
| P-24 | Org scoping as enforcement | Owner's review 22 Aug: 14 of 30 repositories do not extend `ScopedRepository`; 131 hand-written `sql` blocks carry no literal `org_id` (mostly fragments that receive it). No leak found; the invariant is convention. Owner decided 22 Aug: an ESLint rule that fails any repository class not extending `ScopedRepository` and any raw `sql` block in a repository without an `org_id` parameter; migrate the 14 repositories over. The build fails, not the reviewer | Platform | Decided: lint rule + migration | Not started |
| P-25 | Cross-org isolation coverage | Owner's review 22 Aug: 12 test files cover isolation for 283 routes. Add a per-module isolation test that walks every route as a second org | QA | No | Not started |

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
| B-05 | Flag review log | Who accepted / kept / half-dayed what, per admin per week | Done |
| B-06 | Approvals turnaround | Median and p90 time-to-decision by request type; oldest pending | Done |
| B-07 | Early-arrival leaderboard | Current streaks and early minutes by employee and department | Done |
| B-08 | On-time rate by department | Radial grid | Done |
| B-09 | AOV trend | Average order value by month, FY comparison | Done |
| B-10 | Partial shipments by customer | Orders needing two dispatches or a short-close ÷ orders dispatched | Done |
| B-11 | Vendor lead time | PO confirm to GRN, median and p90, against promised days | Done |
| B-12 | Stock-out frequency | Requirements raised from shortage per item per month | Done |
| B-13 | Gross margin proxy | Realised rate minus held cost, by item and customer, behind `reports.margin.view` | Done |
| B-14 | Sales heatmap | Customer × month grid, the matrix's dense-grid form | Done |
| B-15 | Attendance block on the Reports dashboard | On-time radial, open flags, oldest pending approval, top streaks | Done — shown to dashboard viewers who also hold attendance.view.all (the dashboard itself stays a receivables surface) |
| B-16 | Screen audit | Source-level pass over every route (Chrome stays off by owner instruction), both skills' violation classes probed in bulk; see the findings table below | Done |
| B-17 | Motion audit (emil-design-eng) | Every animated primitive and every pressable surface read against the decision framework; see the B-17 table below | Done |
| B-18 | Raise the bar, round one | Sliding tab pill, tooltip delay with instant follow-on from one root provider, theme cross-fade through a view transition | Done |
| B-19 | One button height on a phone | Buttons and toggles join the 44px coarse-pointer floor; the invisible-target scheme and 17 per-screen overrides removed; a source-scan test keeps them out | Done |
| B-20 | Documents on a phone | Estimate, sales order, purchase order and invoice draw as a stacked form below the tablet breakpoint; the paper is one tap away under Preview; the toolbar is one row | Done |
| B-21 | Bulk on a phone | Pressables drawn at desktop size again with invisible 44px targets (B-19 overshot); 190 per-screen coarse-pointer heights stripped from fields, selects and toggles; the scan test covers every control; form and preview fixes from the owner's screenshots | Done |
| B-22 | Second look at the phone | Paper centred in Preview (zoom on the container), the form draws its own date controls, More and Customise tiles a size smaller, every tall class on every screen read and judged | Done |

### B-16 findings (emil-design-eng / thumb-reach), 22 Aug 2026

| Before | After | Why |
| --- | --- | --- |
| Seven dialog footers stacked their two actions full-width below `sm`, primary on top | `flex-row justify-end gap-2` on each (guide overlay, patterns, four integration dialogs, saved views, schedule) | Two short actions fit one row at 360px; stacking puts the primary furthest from the thumb (thumb-reach) |
| `Input` and `SelectTrigger` had no coarse-pointer floor; screens added `pointer-coarse:h-11` one field at a time | `pointer-coarse:min-h-11` in the two primitives | Touch floors key on pointer, not width, and belong to the primitive so no screen can forget them (thumb-reach) |
| Profile page had loading and empty states but no error state | An Empty with the message and Try again | Every screen carries all three states (CLAUDE.md §4) |
| Flag, request-type, status, source and document glyphs were picked per screen | Registries (`ACTION_ICONS`, `entity-icons.ts`) read everywhere | Unseen consistency compounds (emil); one table cannot drift |

Checked and clean: no `ease-in`, no hover-only affordances, no animation over 300ms, every sheet pins its edges with a `min-h-0` scroll region (the calculator keypad has no scrolling body by design), every list page has loading/empty/error states, every dropdown with more than three rows on a phone arrives as a bottom sheet (the Views menu sits mid-toolbar and stays a dropdown), icon buttons all carry labels (the one-line probe's hits were multi-line props). Accepted: editor and paper pages carry no PageHeader because the paper is the page; the patterns showcase lists sample rows and needs no empty state.

### B-17 findings (emil-design-eng motion pass), 22 Aug 2026

The B-16 line claimed "no `transition-all`"; that grep had skipped `components/ui`, where six primitives carried it. Corrected here.

| Before | After | Why |
| --- | --- | --- |
| Button press was `translate-y-px`, and `translate` was not in the transition list, so the press snapped | `scale-[0.97]` on `:active`, `scale` added to the transition list (150ms) | A pressable element answers the press with a scale; the release eases back instead of jumping |
| Go To palette arrived through the dialog's 200ms fade-and-zoom | `instant` on `DialogContent` / `CommandDialog`, set by the palette: overlay and popup at `duration-0` | Never animate a keyboard-initiated surface used dozens of times a day; the motion reads as lag, not polish |
| Tooltips animated on every hover, even when one was already open | `data-instant:duration-0` on the popup | Once a tooltip is open, its neighbours open instantly; the toolbar feels faster without losing the first-hover delay |
| `transition-all` on tabs, badge, toggle, switch, progress | The properties that change: `[color,background-color,border-color,box-shadow]`; `transition-transform` on the progress bar | `all` transitions layout properties the browser has to measure, and hides what was meant to move |
| Spinner at Tailwind's 1s per turn | `--animate-spin: spin 0.6s` in the theme | A faster spin makes the same wait feel shorter; perception is the spinner's only lever |
| Activatable table rows, mobile record cards, notification rows and administration tiles had hover but no press state | `active:bg-muted` / `active:bg-accent` alongside the hover | Touch devices have no hover; the press is the only feedback a thumb gets |

Accepted as they stand: dialogs at 200ms in / 150ms out on the strong ease-out with a centred origin (modals are not anchored); sheets at 380ms in / 250ms out on the drawer curve, as CSS transitions so a second tap mid-motion retargets; dropdown, select and popover at 100ms from `--transform-origin`; toasts enter and leave along the same edge on transitions; charts draw once in 300ms and never again; the sidebar animates `width` because the content beside it has to reflow either way, and it is 200ms linear as shadcn ships it; tooltip delay stays 0 (a house decision; raising it is listed under the proposals).

### B-18 (owner picked the small set first), 22 Aug 2026

| Before | After | Why |
| --- | --- | --- |
| Each tab trigger painted its own active background, so a switch was one box vanishing and another appearing | One Base UI `Tabs.Indicator` pill per list, translated to `--active-tab-left/top` and sized to `--active-tab-width/height`, 200ms on the strong ease-out; hidden until measured; the line variant keeps its underline | The selection is one thing that moves; emil's sliding-tab principle without a second DOM copy |
| Tooltips without a provider waited Base UI's 600ms; the one provider in the tree had `delay=0`; no instant follow-on anywhere | One `TooltipProvider` at the root with a 300ms first-hover delay; `data-instant` zeroes the animation for neighbours | A pointer crossing a toolbar should not fire every label, and the second tooltip should not make the person wait again |
| Theme change cut from light to dark in one frame (transitions deliberately disabled for the swap) | The swap runs inside `document.startViewTransition` after first paint, 200ms crossfade; reduced motion, the first application and browsers without the API take the cut | No abrupt brightness jump (Apple); the per-element transition lock stays so nothing animates twice |

Still on the table from the same proposal: bottom-sheet drag-to-dismiss with momentum, morphing Save/Saving/Saved buttons, and removing the two committed `dist-probe-*` build directories.

---

# Pending — Support answers (22 Aug 2026)

Owner, 22 Aug 2026: "add a chatbot in header for support ... it's complex
software". Built as an answer panel rather than a chatbot, and on `Ctrl+F1`
rather than in the header. The reasoning is recorded in `OPEN-QUESTIONS.md`
P-HELP-1; the short version is that a corpus written as finished answers needs
nothing to summarise it at read time, which removes the model and with it the
first outbound call this API would ever make, the injection surface through
Tally-authored `last_error`, and a class of employee free text with none of
the consent machinery `0012`/`0013` exist to provide.

| ID | Item | Description | Status |
|----|------|-------------|--------|
| H-01 | Card contract | `packages/shared/src/help.ts` — shape only, no content, because anything the web app imports is world-readable from the unauthenticated static bundle | Done |
| H-02 | Corpus | `apps/api/src/platform/help/help.cards.ts` — 47 answer cards across punch, attendance, leave, approvals, reports, people, documents, Tally and account. Written against the running app, not the PRD, which several shipped behaviours now contradict | Done |
| H-03 | Endpoint | `GET /help/cards`, `@Authenticated()` with per-card permission filtering in the service — the `GoToController` precedent, since no key means "may ask a question". Whole set in one response; the client ranks locally | Done |
| H-04 | Ranking | `apps/web/src/features/help/rank.ts` — aliases, stopwords, phrase and term tiers, route as a tiebreaker only. Anything under the confidence floor is returned as a near miss, never printed as the answer | Done |
| H-05 | Panel | The `Ctrl+F1` dialog gains a question box above the shortcut reference; typing replaces the reference, and an answer that has a tour step ends in **Show me**, which arms the guide exactly as an Updates row does | Done |
| H-06 | Anti-rot test | `help.cards.test.ts` reads the web app's guide registry and `nav.ts` and fails when a card points at a step or route that no longer exists — the A-01 failure mode, and the one `changelog.test.ts` cannot see | Done |
| H-07 | Unanswered questions | On a miss the panel says so and offers near misses. Recording the miss would give the usage signal `07-launch-plan.md` §0a says is absent, but it stores employee free text, so it needs an explicit "send to your administrator" action plus a table and a notification | Not started — see P-HELP-1 |
| H-08 | Error-code hook | Cards carry the error codes they explain, so a failed punch or blocked leave can offer the answer at the point of failure. The data is in place; nothing consumes it yet | Not started |

Verified: shared 41, api 1811 (107 files), web 505 (39 files) — all green;
typecheck and lint clean in all three; production build of both apps clean.
The corpus is absent from the built web bundle (`grep` over `apps/web/dist`
finds no card id and no answer text, while the panel's own copy is present).

### B-19 (owner: "button size on all the screens is different" on mobile), 22 Aug 2026

Three mechanisms were deciding a button's height on a phone, and they disagreed. The primitive drew every size at its desktop height (32 / 28 / 24px) and grew an invisible pseudo-element to 44px, while the global floor in index.css raised every field, select, menu row and link to a visible 44px. Seventeen call sites - the sales dialogs, the org logo dialog, the document editor, attendance pickers, the bottom nav and more - then added `pointer-coarse:min-h-11` or `size-11` to their own buttons, so those screens showed 44px buttons and the rest showed 28 or 32 beside 44px fields.

| Before | After | Why |
| --- | --- | --- |
| Button and Toggle excluded from the coarse-pointer floor, each growing a `::after` target instead | Both join the floor (`button:not([role=tab])`); the pseudo scheme is deleted; icon sizes keep `pointer-coarse:min-w-11` so they stay square | One floor, one height: a toolbar on a phone reads as one row instead of a 44px search box beside 28px buttons (thumb-reach: the floor keys on pointer and belongs to the primitive) |
| 17 screens set `pointer-coarse:min-h-11` / `size-11` / `h-11` on their own buttons; one set `h-7` on a `sm` button | All removed; the primitive owns the height | No screen can be taller than its neighbour by accident (emil: unseen consistency compounds) |
| Nothing stopped the next screen from doing it again | `button-height.test.ts` scans every screen's `<Button>` for height, size or coarse-pointer growth classes; five deliberate exceptions are named with their reasons (punch photo tile, calculator keys, profile fold rows, the 56px punch hero, the upload tile) | The class of bug, not the instance |

Tab triggers stay out of the floor by design (the 32px strip carries its own tap target). `InputGroup` still carries its own addon growth; it is inside a 44px field either way. Desktop is untouched: the floor is a `pointer: coarse` query. Browser gate not run (owner instruction); verified through the emitted CSS selector, the scan test and 507 web tests.

### B-20 (owner's screenshot of EST-0019 on a phone), 22 Aug 2026

The paper is the editor on a desk (REQ-W-01). On a phone the shell zoomed the A4 sheet to the screen's width — 0.4× — which is eight-point type, line inputs a few pixels tall and a buyer picker nobody can hit. The toolbar wrapped its actions onto a second row beside a blank band.

| Before | After | Why |
| --- | --- | --- |
| The A4 paper zoomed to 40% on every phone, editable in theory | `DocumentForm`: the same `PaperModel` and `PaperEditing` the paper consumes, drawn as sections — party, dates, consignee, one block per line, totals, the small boxes folded under More details, notes and terms. The four editor pages are untouched; `DocumentEditor` picks the surface | A dense grid is hidden below the breakpoint, not crushed (thumb-reach); the page that owns the document does not know which surface drew it |
| No way to see the paper on a phone except the crushed editor | Preview shows the paper (fit by width, read-only); Edit / Details comes back. The toggle exists on a phone even for an invoice nobody edits | The paper is still the deliverable; it is one tap away instead of the only view |
| Toolbar wrapped: back link with its label, title, then Preview and the overflow on a second row with a blank band | One row: the arrow alone (label for screen readers), the title truncating, Preview and the overflow at the thumb's edge | The bar is where you are and what you can do; a blank band is neither |
| Fit effect ignored the preview toggle, so the paper would have mounted at 100% after a flip | `preview` in the effect's dependencies | The paper re-measures when it appears |

Three jsdom tests prove the form: a read-only document renders without a single input and shows party, line facts, totals, the filled detail box and the notes; every editing section reaches the hook the page wired (place of supply, line quantity and rate, remove, add, notes, a detail box behind More details); the consignee section follows the design flag. Browser gate not run (owner instruction).

### B-21 (owner's screenshots: "all the buttons are bulky in mobile ... dropdowns and all"), 22 Aug 2026

B-19 made every pressable control one height on a phone by drawing it at 44px. Consistent, and bulky: a 12px label in a 44px box is the slab the original scheme was written to avoid. The owner said so, and the screenshots agree. Visual size and target size are separate (thumb-reach); the correction keeps the consistency and drops the bulk.

| Before | After | Why |
| --- | --- | --- |
| Button, Toggle and Select trigger raised to a visible 44px by the floor | Drawn at their desktop height (32 / 28 / 24px; select 32 / 28) with an invisible `::after` target to 44px; excluded from the floor again, Select for the first time | The thing you press is 44px; the thing you see keeps its proportions |
| 190 per-screen `pointer-coarse:h-11` / `min-h-11` on Inputs, SelectTriggers, ToggleGroupItems, menu rows, tab triggers and a tile's `py-4` | Stripped from 73 files; the floor or the primitive owns it | The same class of bug as the 17 button overrides, five times the size; the scan test now reads every control for any coarse-pointer growth class |
| Date on the phone form: the DateField's own box inside a second bordered box | The slot draws its own box; the wrapper only aligns | Box in box (CLAUDE.md §3.3) |
| Lines 1 and 2 separated by a hairline, reading as one long column | Each line is a tinted block (`bg-muted/40`) with a Line n badge, gap between blocks | Two things should look like two things |
| Consignee: five fields always open under the buyer | A Same as buyer (Bill to) switch, on by default; switching it off opens the fields, switching it back clears them | The consignee is the buyer until someone says otherwise |
| Preview on a phone: the paper sat against the left edge with a fifth of the screen empty beside it | Centred by a flex parent (auto margins on a zoomed box resolve in its own scaled space); fit steps every 2-5% at the small end | Fit to screen and in the centre, as asked |

Inputs and textareas stay at the 44px floor: a field you type into is drawn at its target. Tests: the scan test rewritten for every control (two tests), the form's consignee tests rewritten around the switch (five tests in the file). Browser gate not run (owner instruction).

### B-22 (owner's second screenshots), 22 Aug 2026

| Before | After | Why |
| --- | --- | --- |
| Preview paper still against the left edge with the zoom on the sheet's wrapper inside a centring flex parent | The zoom is on the flex container; the sheet is a plain flex item inside the scaled space | Engines disagree on whether a zoomed box's layout size is the scaled one; inside a zoomed container, centring is ordinary flexbox in every engine |
| The form showed the paper's date slots: monospace chips styled to sit on the sheet (`paper-field h-auto min-h-0 px-0`), two sizes, reading as broken inputs | `PaperEditing` gains optional `setDate` / `setValidUntil`; the three editable pages pass them; the form draws its own `DateField` (full width, bottom sheet on a phone) and falls back to the slot only when a page cannot change the date (the purchase order's optional expected date) | The page owns the data, the surface owns the control |
| More and Customise sheet tiles at `min-h-20 py-3 gap-1.5` (80px) | `min-h-16 py-2 gap-1` in all three grids | A tile is the size of its icon and two lines, not a slab |

Read and left alone, each for a reason: the 56px bottom bar and its two-line mobile list rows (`min-h-14`, `md:min-h-9`); the 56px punch hero; the 64px photo tiles; `text-base` KPI figures and `text-xl` headline numbers; `py-6` empty-state paragraphs; the calculator's display. Browser gate not run (owner instruction); six form tests prove the date path and the slot fallback.
