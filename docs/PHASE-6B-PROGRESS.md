# Phase 6b — where it stands

Working notes, not a specification. `10-scope-and-delivery-plan-phase-6-8.md`
§2 is the deliverable list; this says which of it is done and what the next
session should pick up. Delete this file when 6b closes. Started while 6a's
`/ultrareview` verdict was still in flight — its finder batches were applied
to this work before each commit.

Branch: **`phase-6a`** (6b work continues on it until 6a's gate closes).

---

## Done

| Deliverable | Commit | Proof |
|---|---|---|
| Sync tables: cursors, jobs, journal (append-only, D-20 body-sweep exception), `external_refs` as sync anchor | `c0eeceb` | Trigger falsified: 4 rewrite tests fail without it |
| Agent auth (opaque-token HMAC, rate-limited), lease, heartbeat, claim — REQ-Q-02…Q-05 | `cf6f856` | 16 endpoint tests; both credential crossings 401; hardened by 8 ultra finder batches |
| Integrations UI: create connection, once-only token, rotate | `cf6f856` | CDP drive, zero exceptions |
| Parties ingestion: upsert on GUID, journal hashes, GREATEST cursor, one tx — REQ-R-01, REQ-T-03, REQ-Q-06 | `0b456af` | Money to the paisa round-trip; re-post idempotent |
| Pull scheduling: 15-min sweep + manual pull, one-open-job invariant in schema — REQ-R-07 | `ebca3d0` | Second sweep adds nothing; second press answers same job id |
| Masters read API: `/masters/parties`, 405s that teach — REQ-R-04 | `8e7d378` | 6b acceptance line asserted verbatim |
| Masters UI + module switcher entry + party Go To source — REQ-O-05 proven extensible | `395ee91` | CDP 8/8: Ctrl+G offers Masters, Alt+G opens filtered register |

| Review hardening batch (two `/code-review` rounds, ~40 findings triaged) | `871de1a` | Sync suites 51/51 twice; full API 1669/1669; web 414/414; CDP drives below |
| `/sync/agent/errors` + `sync_exceptions` + exceptions screen — REQ-T-01, 09 §5 | `19ece41` | 11 endpoint tests; sync 52/52 twice; full API 1680/1680; CDP: verbatim error shown, note-gated resolve, row leaves list |
| Heartbeat staleness alert, edge-triggered with recovery — REQ-Q-04 | `53e3449` | 3 transition tests (once per silence, re-arms); full API 1683/1683; CDP: both events in the preferences grid |
| Stock items + price lists: rows, writers, sweep order, read APIs, two screens — REQ-R-02, REQ-R-03 | `406b453` | Sync+masters 71/71 twice; full API 1689/1689; live drive: UI-issued token, agent protocol over HTTP, both screens render the paisa-exact figures |
| Journal body sweep, nightly 02:45 — D-20 | `29a862e` | Ages real rows: 40-day bodies cleared, hash kept, fresh kept, repeat finds nothing; trigger side already held by `sync-journal.test.ts` |
| Full re-pull + absent marking — REQ-R-05, REQ-R-06 | `ac6707f` | Watermark = job created_at (claimed_at moves per chunk); mark/unmark/incremental-never 32/32; CDP: confirm dialog queues 3 full jobs, cursors deleted. Vanishing price rates → OPEN-QUESTIONS P6b-1 |
| Connector agent, loop half — REQ-Q-01, Q-02, Q-07 (`apps/agent`) | `a935690` | 5 loop tests vs a scripted server; **live run against the dev API**: UI-issued token, lease, 3 full jobs claimed in dependency order, chunks posted, absent marking landed from the real binary. Claim now carries `fromAlterId` (the server's cursor). Transport = seam + FixtureTransport; `TallyHttpTransport` and SEA packaging land with real fixtures (10 §8, D-05) |
| **OpsTally webhook door** — the transport, answered by the API document (`0d94baa`, `3940868`) | `0d94baa` | Webhook suite 19/19 twice; secret box 3/3; live: UI handshake, signed ping/stock/ledger over HTTP, replay deduped, rival install 409, screens render the rows |

New permission: `masters.tally.view` (08 §2.2), granted to Admin; other
holders arrive with their roles. OPEN-QUESTIONS I-1 closed: staleness = lease
takeover = 5 minutes, one constant.

### What the review batch changed

- **Cross-connection GUID absorption closed, with adoption semantics.** The
  writer's mapping lookup reads the mapping's *owner*: a GUID held by a living
  other connection is a 409 (one company, one connection); a mapping whose
  owning connection was soft-deleted is adopted — repointed to the caller —
  because a replaced connection for the same books must be able to re-pull its
  own parties. The GUID, not the connection row, is the record's identity.
- **`claimed_at` is a liveness mark.** The writer refreshes it per ingested
  chunk, so the unstick sweep's "older than takeover" means the whole exchange
  went silent — a healthy agent mid-way through a slow first backfill keeps
  its claim instead of cycling claim→requeue→409 to FAILED.
- **Agent limiter no longer resets per heartbeat.** A successful resolve
  releases only its own slot (`release`), never the address (`clear`): an
  agent authenticating every 60 s would otherwise wipe the NAT's brute-force
  budget each minute.
- **A claim over a non-empty queue that matches zero rows now names its
  refusal** (lease moved, company rebound, connection dead) instead of
  answering "queue empty" while a QUEUED job sits unclaimed.
- **The sidebar renders the current module, with a switcher** (REQ-O-01). The
  Masters module had existed only in the Alt+G palette; nothing rendered it.
  `findModuleForPath` owns route→module; the switcher appears only when the
  account can see more than one module. Pinned by `app-sidebar.test.tsx`.
- **Manual pull is reachable** (REQ-R-07's second half): a Pull now control
  per connection on Integrations — disabled with its reason until a token is
  issued, distinct toasts for queued vs already-queued. The Parties empty
  state's instruction is now true.
- **Go To trims to the server's 80-char cap** (shared constant) instead of
  rendering the validation 400 as "records unreachable".
- Mechanical: two web build breakers from the parseOrThrow move, a nullable
  Select value, sync fixtures now clean `parties`/`external_refs` so re-runs
  cannot collide with their own history.

### Deferred by design (review findings judged not worth their weight yet)

- `SyncWriterRegistry` entity-type dispatch — resolved without the registry:
  the discriminated results union narrows per entity type inside one writer,
  and the ownership rules live in one `resolveMapping`. A registry earns its
  keep when a *module* outside platform/sync needs to add a writer; none does.
- Report `filterLabels` → `ReportSource`-owned captions; org-profile "home"
  moving into `platform/org`; a credential-resolver registry — each is an
  inversion whose second consumer does not exist yet.
- Set-based party ingest and a `pg_trgm` index on `parties.name` — the
  row-at-a-time loop is correct and the projection is thousands of rows, not
  millions; revisit when a real backfill says otherwise.
- Go To sources skipping `count(*)` — measured cost is negligible at this
  size.

### The transport question, answered

The user supplied the **OpsTally Webhooks v1** reference: OpsTally Agent runs
beside TallyPrime and *pushes* signed JSON events (stock, ledgers, vouchers)
to an HTTPS endpoint we give out. That is the transport — Vyuha never
parses Tally XML on this path, and the Tally-fixture blocker for the pull
agent's `TallyHttpTransport` no longer gates masters sync. Built to the
reference field for field (`packages/shared/src/opstally.ts`):

- `POST /sync/webhooks/opstally/:connectionId` — `@Public()` at the guard,
  HMAC-SHA256 over the **raw body** (`rawBody: true` on the app), 401 with
  nothing touched on any failure, wrong signatures throttled as credential
  guesses (limiter scope `webhook`).
- The `whsec_` secret is the one credential stored *reversibly* — AES-GCM
  under an HKDF key derived from `JWT_REFRESH_SECRET`
  (`platform/auth/secret-box.ts`), never selected by a read path.
  `PUT /integrations/:id/webhook-secret` stores it and answers the URL to
  paste into the Agent. Transports are exclusive per connection.
- First verified delivery **binds** install id and Tally's exact company
  name (overwriting what the admin typed); later mismatches are 409 and set
  `WRONG_COMPANY_OPEN`.
- **`sync_inbox`** dedupes by event id in the same transaction as the
  writes; a retry is a 200 no-op. Vouchers are acknowledged, journalled and
  **retained** in the inbox (`payload`) for Phase 6c to replay.
- Projection goes through `SyncWriterService.applyRows` (`WriterScope`
  generalises `AgentPrincipal`): debtor/creditor ledgers → parties, stock
  items → `stock_items` with OpsTally's held figures (`closing_qty`,
  `sale_price`, `cost_price`; the reference's "zero is not free" rule in
  SQL). Non-party ledgers acknowledged and skipped. Malformed-but-verified
  events acknowledged and raised as `REJECTION` exceptions.
- Webhook connections excluded from the heartbeat staleness alert; the
  Integrations screen reads them as a push source.

**Not done by design, recorded in OPEN-QUESTIONS P6b-2..P6b-5:** absent
marking from `stock.snapshot` (chunks arrive out of order under failure);
price lists (OpsTally has no per-level event); GST rate (not in the stock
payload); voucher projection (6c); how 6c backfills history when the source
is push-only with a 90-day lookback.

## Phase 6c under this transport (started on this branch)

| Deliverable | Commit | Proof |
|---|---|---|
| Voucher projection + writer + inbox replay; OpsTally voucher.* project on arrival | `26160e0` | webhook 21/21 (lines, party/item resolved by name, wholesale line replace, cancel flag, replay drains and is idempotent) |
| `GET /masters/vouchers`, `/:id` under `receivables.view`; Go To by voucher number (09 §6) | `26160e0` | masters 16/16 |
| REQ-S-05 reconciliation as a report-shell source (Tally report group; attendance narrows to its own) | `26160e0` | export+reports 89/89; live: catalogue lists it, page renders rows |
| Vouchers screen (list, sheet with lines, URL-addressable detail) + nav Books group | — | live drive: rows, sheet Dr/Cr + inventory line, Go To opens the sheet, zero console errors |

**Not buildable under a push-only source (needs the P6b-5 decision):** the
historical backfill orchestrator and progress screen (REQ-S-01…S-04, S-06),
bill-wise allocations (not in the OpsTally voucher payload — ageing waits),
the daily drift check (REQ-T-08 needs to ask Tally). Recorded, not
forgotten.

## Phase 7 (CRM) on this branch

| Deliverable | Commit | Proof |
|---|---|---|
| Ten `crm.*` keys from 08 §2.2 in the catalogue (Admin holds them until the Sales roles are seeded) | `097d64c` | seed reconciles; dev Admin holds 10/10 |
| `crm_companies`, `crm_contacts` (migration 0028): owner is an employee so `ScopeService` resolves `view.self` with the existing chain walk; `party_id` waits for conversion (REQ-U-03) | `097d64c` | — |
| `GET/POST/PATCH/DELETE /crm/contacts`, `/crm/companies`, `GET /crm/contacts/duplicates` (REQ-U-01, U-02, U-08); self/all scoping, owner reassignment only for `view.all`, company delete refused while contacts remain | `097d64c` | crm endpoints 16/16 |
| Contacts and companies in Go To (REQ-O-05), scoped through the same service | `097d64c` | search suite green |
| CRM module in the sidebar (People: Contacts, Companies), Contacts and Companies screens — URL-addressable sheet, Alt+C create, duplicate warning that names and links the match and never blocks, owner picker for `view.all` holders, 360px cards + bottom sheet | — | live drive: create company, create contact against it, duplicate warning on `09811122333` vs `+91 98111 22333` and on the email, Go To opens contact and company, zero console errors |

| Tasks in the platform (D-17): `tasks`, `task_board_columns` (migration 0029), `TaskSubjectRegistry` (employee described by the platform, contact/company by CRM), one `filterPredicate` behind `GET /tasks` and `GET /tasks/board` (REQ-V-04), column config under `settings.manage` (REQ-V-03), moves audited as `task.moved` / `task.closed` / `task.reopened` (REQ-V-06), self/team scoping over assignee and owner, three notification events through the dispatcher + a daily reminder sweep (REQ-V-08), tasks in Go To | `37fd376` | tasks 15/15, jobs+notifications 49/49 |
| My tasks screen (REQ-V-07 landing; CRM module home): list and board as two renderings of one filter set with a persisted default view (REQ-V-05), Alt+C create, Ctrl+A save, Alt+D done, keyboard Select for status and Command picker for assignee, native drag on the board → PATCH `columnId`, board columns sheet, `/tasks/:id` opens the sheet (notification links land there) | — | live drive: created by keyboard, assigned, closed with Alt+D, shown struck through under "Show closed", dragged Done → In progress ("Moved to In progress"), Go To opens it, columns added and removed, 360px cards without overflow, zero console errors. Web 416/416 |

| Pipelines and deals (REQ-U-04, U-05; link half of REQ-U-03): `crm_pipelines`, `crm_pipeline_stages`, `crm_deals` (migration 0030); default pipeline on first read; stage move is one audited write, won/lost stages close (`crm.deal.won` / `.lost`); board = list by stage with a value total per lane; `PUT /crm/companies/:id/party` links a company to the Tally party by hand; deals in Go To | `0819766` | deals 10/10 |
| Deals screen: list and board (shared `KanbanBoard`, also now behind the task board), Alt+C create with company → contact pickers, drag to Won opens the sheet with the party-link picker over the parties projection, stages sheet under `crm.pipeline.manage`, `/crm/deals/:id` | — | live drive: created with company and contact, value shown 1,25,000.50, dragged to Won ("Deal won"), party linked from the prompt ("Party linked", note shown), stage added and removed, Go To opens it, 360px cards, no failing requests |

| Activities (REQ-U-07) as the audit trail: `POST /crm/activities` is one `AuditContext.record()` on the record, `GET /crm/activities` pages that record's audit rows through `AuditLogRepository`, so logged calls and system events (created, stage changed, won, party linked) are one ordered list with actor; timeline + composer embedded in the contact, company and deal sheets (Ctrl+Enter logs) | `a075c8d`, — | activities 4/4; live: deal timeline shows Won, Lead → Won, Linked to a Tally party, Created; call logged and listed with actor; contact timeline shows Created |

| Sales and Sales manager system roles (08 §2, §2.2 columns for the keys that exist), held beside Employee per D-15; the seed creates them, the role picker and preview list them | — | shared+web 420/420; rbac/people/auth 194/194; seed: Sales +7, Sales manager +12 |

Two decisions made without asking, both cheap to reverse: the company →
party link is a `party_id` column on `crm_companies` rather than a hop
through `external_refs` (that table already pins `parties.id` to the GUID,
so a second GUID-keyed row would only restate it — see the schema comment);
and the link is a company property offered when a deal is won, not a
deal-only action, because the party is who invoices go to whichever deal
opened the door.

Not in this slice: REQ-U-06 (a won deal shows its estimate, sales order and
invoice) — those documents are Phase 8's; the deal sheet gains a documents
section when they exist.

Open on this slice: P7-1 (an Admin with no employee record has no `.all`
for tasks and so sees none) and P7-2 (which roles hold the task keys).

Next in Phase 7: pipelines and deals with the won → party link (REQ-U-04…
U-06), then activities through the audit interceptor (REQ-U-07).

## Phase 6d on this branch — receivables and analysis (the part bill-wise allocations do not gate)

| Deliverable | Commit | Proof |
|---|---|---|
| Customer statement (REQ-Y-01): every voucher for one party in the period with a running balance opening from what came before; debit/credit by voucher type, unclassified types shown and not summed; the shell asks for the party before it fetches (`requiredFilters`) | — | masters 19/19; live: Opening 0.00 → Sales 4150.50 → Receipt 0.00 for Live Drive Traders |
| Credit cycle (REQ-Y-03): limit and days against exposure, headroom, over-limit flag, last invoice/receipt; overdue-by-bill deliberately absent until bill-wise (P6b) | — | live: Asha 250000.00 / 30 / 0.00 / 250000.00 within limit |
| Sales analysis (REQ-Y-05): value by party / item / item group / month from invoiced inventory lines, share of total, quantity only when the unit agrees; salesperson absent (Tally's voucher carries none), margin absent (held cost is not a figure to compute on) | — | live: By item — Live Drive Cable 1 · 1 NOS · 4150.50 · 100.0; By month — 2026-08 |
| All under the report shell (REQ-Y-06): party picker and group-by in the filter bar, saved views/export/Excel unchanged; every row stamped As of (REQ-Y-07) | — | web 420/420, no failing requests, 360px cards |

Not buildable yet: ageing (REQ-Y-02) and payment analysis (REQ-Y-04) —
both need bill-wise allocations, which the push-only source does not
carry (P6b). A statement can be honest without them; an ageing cannot.

## Phase 8a on this branch (the part that needs no push transport)

| Deliverable | Commit | Proof |
|---|---|---|
| Estimates (REQ-W-01): `sales_documents` + lines + per-org sequence (migration 0031), arithmetic once in SQL as exact text, tax for information from the item's GST rate, draft editable / later read-only, transition table, five `sales.*` keys held by the Sales roles; item history (REQ-W-02) from the party's vouchers and earlier estimates; estimates in Go To | `198e30d` | sales 7/7 |
| Estimates screen: Sales module in the sidebar, register with status filter, wide sheet with the line editor (party or CRM company or a name; item picker prefills description, unit, rate and tax; Enter on the last box appends a line — Alt+N is the calculator's), item-history affordance as a popover / bottom sheet, preview totals replaced by the server's on save, status Select, 360px bottom sheet | — | live drive: raised EST-0003 for Live Drive Traders with an item line and a free line — server totals 14,952.00 / 622.57 / 2,579.30 / 16,908.73 — history popover shows Sales INV-2026-0042 and the current price, marked Sent and read-only, Go To opens it, no failing requests |

| REQ-U-06, the estimate half: the deal sheet lists the estimates raised against it and raises one carrying the deal, company and party into the sheet | — | live drive: "Estimate" from the deal opens the sheet with Asha Traders preset, saved, and the deal lists Estimate EST-000n Draft 999.00 |

Not buildable yet: everything that pushes (REQ-W-03…W-07, X-01…X-03) —
same blocker as Phase 6d, the write transport OpsTally does not offer;
REQ-W-08 discount approval and REQ-W-09 credit block wait for the sales
order they gate; REQ-U-06's other documents join the deal's list as they
land.

## Next, in order

Every phase now has its transport-free part built: 6b/6c (masters,
vouchers, reconciliation), 6d (statement, credit cycle, sales analysis),
7 (CRM complete), 8a (estimates). What remains is gated, all of it on
inputs outside this branch:

1. **A write transport into Tally** — 6e (attendance voucher push, D-06),
   8a's orders/challans/POs/GRNs and their sync state (REQ-W-03…W-07,
   X-01…X-03), 8b if D-03 says Vyuha raises invoices. OpsTally is push-only.
2. **Bill-wise allocations / backfill decision (P6b-5)** — ageing (REQ-Y-02),
   payment analysis (REQ-Y-04), overdue-by-bill on the credit cycle.
3. **Tally XML fixtures + D-05** — the pull agent's transport and packaging.

Until one of those lands, the useful next steps are the code review the
user asked to hold for the end (`/code-review`), the Phase 7 exit gate (one
salesperson for a fortnight), and merging `phase-6a` back to `main`.

### 6b exit gate — run, passed

`/security-review` over the agent credential path and `/sync/agent/*`
(2026-08-16): **zero findings above the confidence bar.** The reviewer
verified structurally that the two credential worlds cannot meet (prefix +
keyed HMAC vs jose JWT, four `@AgentRoute()` handlers, deny-by-default
guard, `request.agent` never `request.principal`), that every cross-org and
cross-connection predicate binds inside its own statement, that the
adoption rule is unreachable while no API can soft-delete a connection, and
that no new SQL concatenates input. Verified **live** as well: eleven user
routes probed with a real issued agent token — employees, masters,
integrations, reports, Go To, jobs, audit, notifications, and the punch
photo route — every one answers 401 while the same token heartbeats 200 on
its own surface. The gate's sentence holds: an agent credential cannot
read an employee, a punch photo, or another connection's data.

## Blocked, and on whom

- **Real Tally XML fixtures from the company data** — now only blocks the
  *pull agent's* `TallyHttpTransport` and single-binary packaging; masters
  sync itself flows through the OpsTally webhook door.
- **D-05** (Tally on one machine or a server?) — decides where the agent
  installs; blocks nothing in the API.
- **6a's `/ultrareview` verdict** — the finder batches landed and were
  applied; the verification phase had not reported when this file was written.
- **`main` is red** — Moksh's lint errors, fixed on this branch in `4dd5b77`;
  main heals when phase-6a merges back or the fix is cherry-picked.

## One decision made without asking, flagged

Manual pull and the masters screens are gated on `integration.manage` /
`masters.tally.view` with Admin as the only holder today. 08 §2.2 assigns
`tally.sync.run` and wider `masters.tally.view` grants to roles that do not
exist yet (Accounts, Sales, Purchase); the guards widen when those roles land.
Say the word if Accounts should exist earlier.
