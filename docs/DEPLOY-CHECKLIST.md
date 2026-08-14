# First deployment — a checklist for the person doing it

`RUNBOOK.md` is for running the system once it exists. This is the one-time
path from an empty VPS to employees punching. Follow it in order; each step
tells you how to know it worked, because "the command exited 0" and "it works"
are different claims.

Do not start until the launch verdict is clear — ask, or check the Progress
section of `07-launch-plan.md`.

---

## 1. Before you begin

You need, in hand:

- A VPS with Docker and Docker Compose, and a domain whose DNS **already
  points at it**. Do the DNS first — TLS cannot be issued until it resolves,
  and propagation is the slowest thing in this list.
- Object storage: Cloudflare R2 credentials (recommended), or the decision to
  run MinIO on the box. R2 means an API token scoped to two buckets.
- SMTP credentials that can actually send. Without working mail nobody but the
  seeded administrator can ever sign in, because provisioning is invite-only.
- The data in §4. Gather it before you deploy, not after.

## 2. Deploy

```bash
git clone <repo> /opt/vyuha && cd /opt/vyuha
cp .env.production.example .env.production
```

Fill **every** value in `.env.production`. Generate the two JWT secrets with
`openssl rand -base64 48` — never reuse them from anywhere. The API validates
all of it at boot and refuses to start on a missing or malformed value,
naming the offender, so a typo costs you one restart rather than a mystery.

```bash
alias vy='docker compose --env-file .env.production -f docker/docker-compose.prod.yml'
vy build
vy run --rm api node dist/platform/db/migrate.js
vy up -d
```

Add `--profile minio` to every `vy` call if you chose MinIO.

**Know it worked:** `curl -fsS https://<DOMAIN>/api/v1/ready` returns 200 with
each dependency listed. A 503 names the one that is down. If TLS fails, check
DNS resolves to this box — Caddy needs that before it can issue.

## 3. Create the first administrator

```bash
vy run --rm api node dist/../seed/run-seed.js   # or: pnpm --filter @vyuha/api db:seed
```

The seed prints a random administrator password **once**. Copy it now; it is
not recoverable. Sign in at `https://<DOMAIN>` immediately and change it.

**Know it worked:** you can sign in, and the seed reported an `employee link`
line. That link is what lets the administrator punch and hold leave — without
it the Punch and My Leave screens correctly refuse.

## 4. Load your data

All of this is done in the app, as the administrator. Nothing here should be
done with SQL.

- **Location and geofence** — Settings → Locations → Head Office. Set latitude,
  longitude and radius from your office's coordinates. This is the control
  that keeps punching on the premises for phones. 100m suits a single
  building; widen it if your site includes a yard or parking.
- **IP allowlist** — leave empty unless you have a static office IP. Empty
  means desktop web punches are allowed and flagged rather than blocked.
  Phones are governed by the geofence, not by IP.
- **Shift timings** — replace the placeholder General Shift with real in, out
  and break times. The placeholder must not survive into day one; every punch
  is judged against this window.
- **Weekly off pattern**, and a roster covering every employee. A person with
  no roster has no shift to be measured against.
- **Holiday calendar** for the year. Without it every holiday computes as a
  working day and shows as absence.
- **Leave types** with entitlement, carry-forward cap, negative limit and
  notice days — then **opening balances** per employee. The accrual job runs
  monthly on the 1st and cannot reconstruct the year behind you, so balances
  that start wrong stay wrong.
- **Employees** — bulk import from the Employees screen.

## 5. Invite people

Send invitations from the app. **Before inviting everyone, invite one person
and have them complete it end to end** — accept, install the PWA, grant camera
and location, punch. One failed invitation is a fix; forty is an incident.

Tell people what to expect before the link arrives: that a photo and location
are captured at each punch, how long they are kept, and that the app should be
installed to the home screen. The delivery plan names this as the mitigation
for adoption resistance, and it costs one message.

## 6. Verify before you tell anyone it is live

- [ ] Sign in over HTTPS on a phone; install to the home screen.
- [ ] Punch in at the office. The photo carries a burned-in stamp, the day
      appears in My Attendance, and the flags read correctly.
- [ ] Punch from outside the geofence and confirm it is refused.
- [ ] Turn on airplane mode, punch, and confirm it queues; restore signal and
      confirm it syncs exactly once with the day still correct.
- [ ] Apply for leave, approve it, and confirm the day changes on the muster.
- [ ] `GET /jobs` as an administrator shows queues draining, not piling up.
- [ ] Run one backup and one **restore into a scratch database** before you
      rely on either. A backup that has never been restored is a hope.
- [ ] Set up the nightly backup cron **and copy the dumps off the box** — a
      backup on the disk it protects dies with that disk.

## 7. What day one does not include

Say this in writing to whoever is depending on it, so nobody discovers it at
month-end: eleven of the thirteen reports, Payroll Input, Excel formatting
(exports are CSV), the notification bell and emails beyond invitations and
resets, desktop punching, TOTP, and the calculator. Attendance Register and
Punch Audit are the two live reports.

Error tracking is deferred — until a Sentry decision lands, production errors
live in `vy logs api` and nowhere else. Watch them for the first few days.
