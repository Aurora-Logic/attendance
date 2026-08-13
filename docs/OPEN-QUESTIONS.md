# Open questions

Per `CLAUDE.md` §7. Nothing here is guessed at in code — where a default is
stated, the code implements the default and this file records that it was a
default, not an answer.

Format: question, the REQ it blocks, the phase it blocks, and the recommended
default being used until answered.

---

## Raised during Phase 0 setup

| # | Question | Blocks | Recommended default in use |
|---|---|---|---|
| P0-1 | **Product name.** `CLAUDE.md` and the specs say **Setu**; the repository directory is **Vyuha**. Which is the product name? | Nothing yet — cosmetic | Using **Vyuha**, matching the directory. One find-replace changes it. Package names, the DB name, and bucket names all use `vyuha`. |
| P0-2 | **shadcn MCP server was not configured.** `CLAUDE.md` §3 requires every component be installed through it. A `.mcp.json` has now been written pointing at `npx shadcn@latest mcp`, but it only takes effect after the CLI is reloaded. | All UI work | No UI has been built yet, so nothing has been sourced any other way. UI work waits for the MCP to be live. |
| P0-3 | **MailHog replaced with Mailpit** in the dev stack. MailHog has had no release since 2020 and publishes no arm64 image, so on Apple Silicon it runs under emulation. | Nothing — dev infrastructure only | Mailpit v1.22, same SMTP port 1025, web UI on 8025. |
| P0-4 | **Where do punch photos live in production?** Hostinger sells no S3-compatible object storage. Either MinIO on the same VPS, or Cloudflare R2. | Phase 1 | **Cloudflare R2.** At under 50 employees the estimate is roughly 4 GB a year, inside R2's 10 GB free tier, and egress is free. It keeps photos off the app disk, gives object versioning and lifecycle rules for the 12-month purge (REQ-L-03), and means a VPS rebuild cannot lose the evidence that makes a punch defensible. MinIO on the same box is the fallback if you would rather nothing left the VPS. Nothing in the code is R2-specific — the file service targets the S3 API. |
| P0-5 | **Third-party identity provider (Clerk) instead of own auth?** | Phase 0 | **Answered 12 Aug 2026: own auth.** See [ADR 0002](adr/0002-own-auth-not-clerk.md). |
| P0-6 | **The icon library now contradicts the constitution.** Preset `b50dFpu8w` was applied in full, which swapped `iconLibrary` from `lucide` to `phosphor`. Every icon import in `apps/web/src` is now `@phosphor-icons/react`; zero files import `lucide-react`. CLAUDE.md §3 rule 2 and `05-decisions.md` both state "Icons only (`lucide-react`)". | Any future UI work | **Nothing reverted.** The preset was applied deliberately after the conflict was flagged, and reverting it would undo an intentional choice and churn every screen a second time. But the two cannot both stand: the next `shadcn add` will emit phosphor imports while the constitution says lucide, and a later contributor reading CLAUDE.md will "fix" it back. **Decide one:** (a) amend CLAUDE.md §3 rule 2 and `05-decisions.md` to say phosphor, or (b) revert to lucide with `shadcn add --overwrite` plus an import sweep. Option (a) is a two-line documentation change; (b) touches every screen. The style also moved `base-nova` to `base-lyra`, which is what set `--radius: 0` and made the app square. |

| P0-7 | **The organisation logo is stored in the browser, not on the server.** REQ-L-01 asks for an org logo; the control is built and works, but it persists to localStorage because there is no settings endpoint and no file upload API yet. | Phase 4, or sooner | Per-browser today: a second person signing in sees the monogram until the server owns it. The permanent home already exists in the schema — `organizations.logo_key` pointing at a row in `files`. Moving it is one endpoint plus swapping the store; the client already normalises the image to a 128px PNG, which is what the server would store anyway. **Answered 12 Aug 2026: approved. sharp and the S3 client are installed and the platform file service is being built now** (it is a Phase 0 deliverable in its own right, and the same two dependencies carry the Phase 1 punch photo pipeline). The logo moves off localStorage once that service has an upload endpoint. |
| P0-8 | **The phone gets a bottom navigation bar, which the PRD does not describe.** PRD §6.1 specifies a left sidebar and §6.5 only says it collapses. | Nothing — already built | A hamburger is a desktop pattern on a phone: every destination is two taps away and none is under a thumb. The bar shows four destinations plus More, and which four is chosen per person and per device, because a shop-floor employee opens Punch and nothing else while HR lives in Approvals. Confirm this is wanted, and I will fold it into PRD §6.1 rather than leaving it as an undocumented addition. The desktop sidebar is unchanged. |

| P0-9 | **JWT signing is hand-rolled.** `platform/auth/jwt.ts` implements HS256 with `node:crypto` because no JWT library is a declared dependency and this phase was told not to add one. | Before Phase 1 ships | **Resolved 12 Aug 2026.** `jose` replaced the hand-rolled file. The swap cost both exports becoming async - `jose` has no synchronous API because it is built on WebCrypto - so the guard, `AuthService.accessResponse` and two tests now await. All ten attack cases are unchanged in substance and still pass, and the tokens in them are still forged by hand with `createHmac`, so the verifier is attacked by something that does not share its code. Verified live: real token 200, forged `alg:none` 401. What follows is the original note. It is careful code — `alg` is compared to a constant and never dispatched on, signatures use `timingSafeEqual`, `exp` is required, there is no decode-without-verify export, and a forged `alg:none` token is rejected (verified live). It also has 11 attack-shaped tests. None of that changes the rule: a hand-written security primitive is a liability, and the seam is deliberately two functions wide so the swap is small. `jose@6.2.8` is already in the pnpm store as a transitive dependency. **Needs your approval to add.** |
| P0-10 | **Invitations cannot be delivered.** `nodemailer` is not installed, so there is a `Mailer` port with a `LogMailer` that writes the link to the log in development and logs an error in production. | Before anyone but the seeded admin can sign in | REQ-B-03 provisioning is invite-only, so without mail there is exactly one account. **Resolved 12 Aug 2026.** SMTP mailer on nodemailer, selected by `MAIL_TRANSPORT`. Verified by sending a real invitation, reading the link out of the captured message in Mailpit, and using it to accept and sign in. Mailpit is already running on SMTP 51025 to receive it. |
| P0-11 | **The per-IP login limit is in-memory.** REQ-B-10's per-account limit (5 per 15 minutes, then lockout) is in Postgres and is unaffected. The per-IP limit (20 per 15 minutes) resets on restart and is per-instance, because no Redis client is installed. | Before a second instance runs | **Resolved 12 Aug 2026.** Sliding window on a Redis sorted set. Verified across a restart, which the in-memory version could not survive. It fails open when Redis is down - the Postgres per-account lockout is unaffected either way, and failing closed would stop the whole company signing in over a cache outage. Say the word if you want that inverted. Fine on one VPS today, but it costs nothing to make it correct now. Related: `trust proxy` is deliberately **not** set, so `req.ip` is the socket address — correct with no proxy in front, but it must be set to a specific hop count when Caddy lands, or any client can spoof `X-Forwarded-For` and walk past the limit. |
| P0-12 | **`GET /me` is mounted at `/api/v1/auth/me`.** Technical design §6 specifies `/me`. | Before the web client wires to it | Cosmetic, and a one-line change. Flagging so the contract and the code do not quietly disagree. |

## Raised during Phase 1 master data

| # | Question | Blocks | Recommended default in use |
|---|---|---|---|
| P1-1 | **No permission key covers departments, designations or locations.** PRD §2.1 names `employee.view` / `employee.manage` for people and `settings.manage` for org settings, but the three masters an employee points at are in neither list, and §5 gives them no screen of their own. | REQ-A-01, REQ-A-02 | **Read: `employee.view`.** Anyone who can see the employee list needs these names to render its filters and its form, so a narrower key would leave Operations looking at a list it cannot filter. **Write, departments and designations: `employee.manage`** — they are people master data and HR owns them. **Write, locations: `settings.manage`** — a location row carries the geofence centre and the IP allowlist (REQ-D-08, REQ-D-09), so whoever can edit one can decide from where a punch is accepted. That is an Admin control, not an HR one. Say the word if locations should sit with HR instead; it is a one-line change per route. |
| P1-2 | **No delete route exists for any master.** Technical design §6 lists `GET/POST/PATCH` for all four resources and no `DELETE`, and REQ-M-04 forbids a hard delete. | Nothing yet | None built. An employee is retired through REQ-A-05 (status INACTIVE with a last working date), which keeps the history past reports need. A department or designation created by mistake currently cannot be removed from the picker. If that needs fixing, the shape is a soft-delete route guarded by the write key above, refusing while any live employee still points at the row. |

## Raised during Phase 1 punch screen wiring

| # | Question | Blocks | Recommended default in use |
|---|---|---|---|
| P1-3 | **Is the half-day choice always available on an IN punch, or is it a policy?** REQ-D-07 says the choice is made at the moment of punching and only on the IN, but nothing in `PunchContext` says whether an organisation may switch it off, and there is no settings column for it. | REQ-D-07 | Offered on every IN punch. The client derives it from `nextPunchType === 'IN'` rather than inventing a setting the server does not have. If half days should be restricted — by leave policy, by employment type, or off entirely — that is a settings column and a line in the punch context. |
| P1-4 | **REQ-M-03 says consent acceptance is recorded. Nothing records it, and the retention period it is supposed to state is not enforced.** The consent checkbox is component state that disappears on reload, so the notice reappears every visit. Separately, item 12 above agrees 12 months for photo retention (REQ-L-03), but punch photos are written with no `expires_at` at all, so the purge job never selects them and the period is not kept. | REQ-M-03, REQ-L-03 | The screen no longer states a retention period. It previously told the employee their photo was kept for a number of months, and that number came from a field the server never sent while the photo was in fact stored indefinitely — a promise with nothing behind it, which is worse than saying nothing. The notice still appears and still gates the punch. Fixing this properly is two small pieces: set `expires_at` on punch photos from a configurable retention setting, and record acceptance against the user so the notice stops reappearing. |
| P1-6 | **Opening two tabs logs the user out of every session.** REQ-B-05's reuse detection is working exactly as specified, and that is the problem: the access token is deliberately held in memory only, so every cold document load must call `/auth/refresh`. Two documents booting at once — two tabs, a restored window, a quick double reload — send the same refresh cookie twice. Verified against the running API: of two concurrent refreshes one returns 200 and the other `REFRESH_TOKEN_REUSED`, and the family is then revoked, so the tab that *succeeded* is also dead at its next refresh. | REQ-B-05 | **Nothing changed.** Reuse detection is a security control and quietly softening it to stop a symptom is not a call to make without you. The standard fix is a short rotation tolerance: for a few seconds after a token is rotated, accept the previous one and return the same replacement instead of treating it as theft — genuine theft replays are separated from the legitimate races by minutes, not seconds, so the detection still does its job. The alternative, serialising refresh across tabs with a Web Lock, is client-side only and does nothing for a browser restart. Recommend the tolerance window, with the length as your call; 10 seconds is typical. |
| P1-5 | **`facingMode: { exact: 'user' }` may make the punch screen unusable on a desktop.** Technical design §7 specifies `exact` deliberately, and the reason is sound: without it the browser treats the constraint as a preference and can return the rear camera, which is the one somebody points at a photograph of a colleague. But many desktop and laptop webcams report no `facingMode` at all, and `exact` rejects them outright — the screen then says "This device has no front camera" and blocks the punch. | REQ-D-02 | Left exactly as it is. This is an anti-spoofing control and loosening it to widen device support is not a change to make quietly. It also means the camera path cannot be exercised in a headless browser, because Chrome's synthetic capture device reports no facing mode either — so the capture flow is still unverified end to end. If desktop punching is required, the shape is to keep `exact` on touch devices, where a rear camera actually exists, and fall back to any camera on a device that has only one. |

## Raised during the Phase 2 parallel build

| # | Question | Blocks | Recommended default in use |
|---|---|---|---|
| P2-1 | **REQ-E-09 says unlocking a period requires Admin, but there is no Admin-only permission key and nothing may branch on a role name.** `attendance.lock` is held by whoever can lock, so gating unlock on it makes unlock exactly as available as lock. | REQ-E-09 | The screen gates on `attendance.lock` and the dialog states that unlocking is an Admin action. That is a label, not a control. The fix is a separate `attendance.unlock` key granted only to Admin — one seed row and one decorator — but adding a permission key changes the RBAC matrix, so it waits for you. |
| P2-2 | **Four settings are recorded and audited but nothing reads them.** REQ-L-02 lists geofence behaviour, regularization limits and escalation days; REQ-L-03 lists photo retention. The punch path hard-blocks on the geofence directly instead of consulting the setting, and `files.expires_at` is never stamped for punch photos, so retention is unenforced (this is the same gap as P1-4). | REQ-L-02, REQ-L-03 | The settings screen prints, under each field, whether anything reads it — "In force now. Read by: Day engine" or "Saved and audited, but nothing reads it yet". Four switches that silently do nothing would be worse than none at all. Making them live is a change to the punch path and belongs with the P1-4 retention work. |
| P2-3 | **Roles are read-only.** REQ-B-07 makes them editable; `PATCH /roles` does not exist. | REQ-B-07 | The screen reads the real role and permission data and says why it cannot be edited. Writing the endpoint is straightforward; it was left out because `platform/rbac/` was owned by no slice in this build. |
| P2-4 | **Excel export needs a spreadsheet library and CLAUDE.md forbids adding a dependency without asking.** | REQ-J-03 | CSV, written behind an interface so XLSX drops in without touching call sites. REQ-J-03 asks for a formatted workbook — frozen header, column widths, a filter header block — and CSV carries none of that. Say the word and `exceljs` goes in. |
| P2-6 | **REQ-C-03 names four levels for a weekly-off pattern and only two are modelled.** Employee level (`employees.weekly_off_pattern_id`) and organisation level (a settings key) exist. Location and department levels have no storage anywhere — not on the writing side, and the day engine's repository reached the same conclusion from the reading side. | REQ-C-03 | Two levels, and no storage invented for the other two. `/weekly-off-patterns` is master CRUD; a pattern is attached per employee or per organisation. If a location or a department needs its own pattern — a plant that works alternate Saturdays while head office does not — that is a nullable column on each of those two tables plus a resolution order in the day engine. Straightforward, but it changes how the engine decides, so it waits for you. |
| P2-5 | **`PATCH /settings` where technical design 6 says `PUT`.** Absent groups mean unchanged, which is PATCH semantics, and every other update endpoint in this API is PATCH. | REQ-L-01 | PATCH. Flagged rather than silently diverging from the design document. |

## The leave / approvals join, still unwired

Not a question for you — a note for whoever does it next, written after an
attempt that was reverted.

Leave and the approval framework both landed, and they are not connected.
`leave_requests.approval_request_id` has existed since migration 0004 and is
always null: nothing calls `ApprovalService.raise`, so a leave application never
reaches the approvals inbox and the escalation job never sees it. Leave decides
on its own endpoint, where the append-only ledger write lives.

**The shape it has to take.** The framework must not import leave — leave
already imports the framework, and the arrow cannot point both ways. So a
subject-handler registry, exactly like `JobRegistry`: the framework holds a map
from subject type to a handler, each slice registers itself on init, and the
framework calls the handler when a request reaches a terminal status. Leave's
handler applies the decision without re-checking the approver, because the
framework has already done that.

**Raise and handle must land in the same change.** This was tried the other way
round — the seam plus a guard refusing to decide any subject with no registered
handler — and it broke ten approvals tests, correctly. No subject type has a
handler, so the guard made the whole framework inert. The lesson is that the
guard is only safe once at least one handler exists, and that raising a leave
approval before the handler exists would be worse still: the inbox would mark a
request approved while the ledger and the balance recorded nothing, with no
error anywhere.

**Why it was not finished unattended.** It moves who writes an append-only
ledger. A wrong row cannot be taken back, and CLAUDE.md 7 puts leave rules on
the list not to guess at. It wants doing with someone watching.

There is a second join: cancelling on or after the start date currently needs an
approver key rather than raising an approval request, which is what REQ-G-10
asks for.

## Carried from `05-decisions.md` — still open

| # | Question | Needed by | Recommended default in use |
|---|---|---|---|
| 1 | Office Maps link / coordinates for the 100 m geofence centre | Phase 1 | None. Geofence centre is a `locations` column and stays null; punch geofencing cannot be enabled until supplied. |
| 2 | General shift timings — in, out, break | Phase 1 | None. Seeded as a placeholder General shift, clearly marked, not to reach production. |
| 3 | Office IP address(es) for the web punch allowlist | Phase 1 | None. `locations.ip_allowlist` stays empty; web punch is blocked until populated. |
| 4 | Leave types: entitlement, carry-forward cap, negative limit, notice days, half-day allowed, document required after N days | Phase 2 | The five seed types from REQ-G-02 with placeholder values. |
| 5 | This year's holiday list | Phase 2 | Empty calendar. REQ-H-01 says no dates ship assumed. |
| 6 | Who runs payroll, in what format, and the exact columns they need | Phase 3 | REQ-J-04's column set as v1, to be signed off before the contract locks. |
| 7 | Attendance cycle — calendar month, or a cutoff like 26th–25th | Phase 3 | Calendar month. |
| 8 | Do all employees have a work email address? | Phase 0 | Assuming yes. REQ-B-02 already allows an employee record without a login, so a no answer does not require a schema change — only another invite route. |
| 9 | NestJS or Fastify | Phase 0 | **Answered 12 Aug 2026: NestJS on the Express adapter.** Fastify is dropped at your instruction. It is also the lower-risk choice for REQ-D-02: punch photos arrive as multipart, and `@nestjs/platform-express` uses multer, which is far better trodden than `@fastify/multipart`. Throughput is irrelevant at 2,000 punches a day. |
| 10 | Hosting and file storage | Phase 0 | **Answered 12 Aug 2026: Hostinger VPS.** Docker Compose behind Caddy, as in technical design §17. Object storage is still open — see P0-4 below, since Hostinger has no S3-compatible service. |
| 11 | Brand colour, logo, typeface | Phase 0 | shadcn default theme tokens until supplied. |
| 12 | Photo retention period | Phase 1 | 12 months (REQ-L-03). |
| 13 | Consequence rules — does 3 lates equal a half day? | Phase 1 | No such rule. Lates are counted and reported; no automatic deduction. Inventing one would be a policy decision, not a technical one. |
| 14 | Regularization limits — days back, count per month | Phase 2 | 7 days back, 3 per month (REQ-F-02). |
