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

## Next, in order

Nothing buildable remains for 6b; see "Blocked, and on whom". The 6c
voucher projection now has a retained inbox to replay from.

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
