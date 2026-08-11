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
| 9 | NestJS or Fastify | Phase 0 | **NestJS with the Fastify adapter**, the stated default. Its module system maps onto the platform/modules boundary and its DI is what makes the RBAC and audit interceptors clean. |
| 10 | Hosting and file storage | Phase 0 | VPS + Cloudflare R2. Nothing in the code is R2-specific — the file service targets the S3 API, MinIO locally. |
| 11 | Brand colour, logo, typeface | Phase 0 | shadcn default theme tokens until supplied. |
| 12 | Photo retention period | Phase 1 | 12 months (REQ-L-03). |
| 13 | Consequence rules — does 3 lates equal a half day? | Phase 1 | No such rule. Lates are counted and reported; no automatic deduction. Inventing one would be a policy decision, not a technical one. |
| 14 | Regularization limits — days back, count per month | Phase 2 | 7 days back, 3 per month (REQ-F-02). |
