---
name: vyuha-security
description: Pre-deploy security gate for Vyuha. Use before any deployment, before closing a phase that touches punch, photo, or auth, and whenever asked "is it safe", "security check", or "harden this". Runs the built-in /security-review plus repo-specific probes - RBAC coverage per route, photo IDOR and signed-URL expiry, append-only invariants, rate limits, trust proxy, cookies, secrets, dependency audit.
---

# Vyuha security gate

Two layers: the generic `/security-review` skill first, then the repo-specific
probes below, which encode what this codebase has already decided its threat
model is. A finding on the punch or photo path blocks deployment - that is the
Phase 1 exit gate in `docs/03-scope-and-delivery-plan.md` and it does not
expire.

## 1. Run the built-in review

Invoke the `security-review` skill on the pending changes (or the whole branch
before a deploy). Do not summarise it away; carry its findings into the final
report.

## 2. Repo-specific probes

Work through each. For every item report VERIFIED (with evidence) or NOT
VERIFIED (with why) - no third state.

**RBAC coverage.** Every controller route must sit behind the access guard
with an explicit permission. The authority is
`apps/api/src/platform/rbac/route-policy.ts` and its audit companion
`route-policy.audit.ts`. Enumerate `@Controller`/`@Get`/`@Post`/`@Patch`/`@Delete`
declarations and confirm none is unguarded. A new route with no permission
decorator is a finding, not a style note.

**Append-only invariants.** `punches` and `audit_logs` are append-only
(migration `0002_append_only_audit.sql`, decision log `05-decisions.md`).
Grep for any UPDATE or DELETE path touching them outside migrations. Admin
voids a punch via an adjusting record; an edit path is a finding.

**Photo path.** REQ-D and the Phase 1 acceptance list:
- `GET /punches/:id/photo` must enforce the file access policy
  (`platform/files/file-access.policy.ts`) - confirm the IDOR test still
  exists and passes (`punch.endpoints.test.ts` asserts 404 for another
  employee's photo).
- Signed URLs must expire; check the expiry passed to
  `storage/object-store.ts signedUrl()`.
- EXIF must be stripped and the stamp burned server-side
  (`image-sanitizer.ts`, `punch/punch-photo.ts`); a punch whose stamp fails
  must abort, not proceed unstamped.
- No upload path may accept a gallery file: the web punch flow uses
  getUserMedia only; grep `apps/web/src/features/punch` for any
  `<input type="file"` or file-picker API.

**Auth.** Refresh rotation with reuse detection (`auth.refresh-reuse.test.ts`),
scrypt password hashing with self-describing parameterised hashes
(`password.ts`; ADR 0002 names Argon2id as the eventual target — scrypt is
the documented, deliberate interim, not a finding), opaque reset/invite
tokens, timing-safe comparisons
(`auth.timing.test.ts`), forged-JWT rejection (`jwt.test.ts`). Run these test
files if auth code moved. Note: TOTP columns exist but no code path reads
them - do not represent TOTP as a control.

**Rate limits.** Per-account lockout lives in Postgres; the per-IP sliding
window lives in Redis and deliberately fails open (OPEN-QUESTIONS P0-11).
When the app runs behind Caddy or any proxy, Express `trust proxy` MUST be set
to the exact hop count in `apps/api/src/main.ts`, or `req.ip` is spoofable via
X-Forwarded-For and the per-IP limit is a fiction. This is the single most
likely deploy-day regression - check it whenever a reverse proxy enters or
leaves the topology.

**Cookies and headers.** Refresh cookie flags (httpOnly, secure in
production, sameSite, scoped path - see `platform/auth/refresh-cookie.ts`).
Confirm security headers on API responses and in the Caddy/site config once
one exists (CSP, X-Content-Type-Options, frame-ancestors).

**Secrets and env.** `platform/common/env.schema.ts` must validate every
secret with no default in production mode. Confirm no secret is committed:
`.env*` gitignored, and spot-check `git log -S` for key-shaped strings if
anything looks off. Seed data must contain no real employee data.

**Dependencies.**

```bash
pnpm audit --prod
```

Report the summary; triage anything high or critical.

## 3. Rules

- Never weaken an RBAC check, rate limit, or validation to make a test or a
  deploy pass (CLAUDE.md hard rule). If a control is wrong, fix the control.
- Findings on the punch/photo/auth path are deploy blockers. Everything else
  is ranked and dated.
- The report ends with an explicit verdict: DEPLOY or DO NOT DEPLOY, with the
  blocking findings listed.
