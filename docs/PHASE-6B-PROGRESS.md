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

| Review hardening batch (two `/code-review` rounds, ~40 findings triaged) | — | Sync suites 51/51 twice; full API 1669/1669; web 414/414; CDP drives below |

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

- `SyncWriterRegistry` entity-type dispatch — one writer, one entity type
  today; the registry lands with stock items (item 3 below).
- Report `filterLabels` → `ReportSource`-owned captions; org-profile "home"
  moving into `platform/org`; a credential-resolver registry — each is an
  inversion whose second consumer does not exist yet.
- Set-based party ingest and a `pg_trgm` index on `parties.name` — the
  row-at-a-time loop is correct and the projection is thousands of rows, not
  millions; revisit when a real backfill says otherwise.
- Go To sources skipping `count(*)` — measured cost is negligible at this
  size.

## Next, in order

1. **`/sync/agent/errors`** (09 §5): the agent's failure report — journal the
   error with Tally's verbatim text, mark the job FAILED, raise a
   `sync_exceptions` row. The exceptions screen (REQ-T-01) follows from it.
2. **Heartbeat staleness alert** (REQ-Q-04): a sweep that notifies
   `tally.sync.run` holders (interim: Admin) when `last_heartbeat_at` ages
   past 5 minutes, and again on recovery. The threshold constant already
   exists and is shared with the lease.
3. **Stock items and price lists** (REQ-R-02, R-03): repeat the party pattern
   — row schema in shared, projection table, writer case, `PULL_ENTITY_TYPES`
   entry, masters screen tab. The pattern is proven; these are mechanical.
4. **Journal body sweep** (D-20): a nightly job nulling bodies older than 30
   days — the one UPDATE the journal's guard permits, and a test that proves
   the sweep's exact statement passes while everything else still refuses.
5. **REQ-R-06 absent marking**: a full pull (explicit re-pull) marks rows
   whose GUIDs did not arrive as `absent_in_tally`. Needs the full-pull job
   payload to say it is one; incremental pulls must never mark.
6. **The connector agent binary** (REQ-Q-01, Q-07): TypeScript single binary.
   The poll/heartbeat/claim/post loop is buildable against the shared
   contract now; the Tally XML transport inside it is **fixture-gated** — the
   Definition of Done forbids hand-written Tally XML.
7. **6b exit gate**: `/security-review` on `/sync/agent/*` and the credential
   path. An agent token must not read an employee, a photo, or another
   connection's data (the cross-connection test already covers the queue).

## Blocked, and on whom

- **Real Tally XML fixtures from the company data** — gathering task, not
  development; blocks the agent's transport and every parser test (10 §8).
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
