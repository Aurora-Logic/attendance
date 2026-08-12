# ADR 0002 — Own authentication, not a hosted identity provider

Status: accepted
Date: 12 August 2026
Relates to: technical design §2 (Auth row), §15; REQ-B-01…B-10

## Context

Clerk was proposed as an alternative to building authentication. The question
is a fair one: auth is the part of a product most often got wrong, and Clerk
does passwords, sessions, MFA, and invite emails competently.

The requirement it would serve is narrow and already clear: **only people the
owner grants access to may log in.** There is no self-serve signup, no social
login, and no public registration in this product at all.

## Decision

Build authentication in the application: Argon2id password hashing, a
short-lived JWT access token, and a rotating refresh token with reuse
detection. Invitation-only provisioning. Sessions listed and revocable.
Optional TOTP, required by default for Admin.

## Why not Clerk

1. **Punching is time-critical and premises-bound.** Fifty people clock in
   within the same few minutes each morning, from one office, inside a 100 m
   geofence. A dependency whose outage stops attendance being recorded is a
   bad dependency for exactly this workload. Own auth against Postgres on the
   same VPS fails only when the app itself is down.
2. **Roles cannot live outside the database.** REQ-B-07 makes roles
   user-defined bundles of permissions, edited in the UI, with the rule that
   the last holder of `roles.manage` cannot be stripped of it. That state has
   to be ours. Clerk would therefore own only credentials, leaving two user
   records to keep in sync — more work than it removes.
3. **Employee personal data would leave the country.** Names and work emails
   for an Indian company's HR system, held by a US processor, is a compliance
   discussion this product does not need to open.
4. **Not every employee is guaranteed a work email** (OPEN-QUESTIONS item 8).
   REQ-B-02 already allows an employee record with no login account, and
   REQ-A-06 bulk import creates records rather than users. Clerk's provisioning
   is email-first.

What Clerk would genuinely save is password hashing, reset email flows, TOTP,
and session storage. That is a well-specified, well-trodden slice of work, and
the least risky part of the auth surface to implement.

## Consequences

- No public signup endpoint exists. Account creation happens one way only:
  Admin or HR issues an invitation against an existing employee record, and the
  invitee sets a password with a single-use token valid for 72 hours
  (REQ-B-03). Absence of a route is the access control.
- Refresh tokens rotate on every use, and presenting a rotated token revokes
  the whole family and forces re-login (REQ-B-05). This is the control that
  makes a stolen refresh token detectable rather than silently useful.
- Rate limiting is ours to enforce: five failed logins per account per fifteen
  minutes with a lockout and an email notice, twenty per IP (REQ-B-10).
- Argon2id parameters are recorded in settings so they can be raised later
  without a code change, and password hashes carry their parameters so old
  hashes stay verifiable after a change.
- If this is ever revisited, the seam to target is the session service, not the
  controllers: everything above it already speaks in permission keys, and
  nothing in the codebase checks a role name.
