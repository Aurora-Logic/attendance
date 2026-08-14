---
name: vyuha-verify
description: Run Vyuha's full quality gates and report real numbers - shared build, typecheck, lint, unit and integration tests against the live docker stack, production build, and the CDP browser smoke. Use before closing any task, before any commit that claims something works, before any deploy, and whenever asked "is it green", "run the gates", or "verify".
---

# Vyuha quality gates

Run every gate below in order. Never report a gate green without running it in
this session. Report counts, not adjectives: "1175 api tests passed in 60s"
beats "tests pass".

## 1. Infrastructure

```bash
docker ps --format '{{.Names}} {{.Status}}'
```

The api tests need `vyuha-postgres`, `vyuha-redis`, `vyuha-minio`,
`vyuha-mailpit` all Up. If any is missing:

```bash
pnpm infra:up
```

## 2. Gates, in order

All commands run from the repo root. `@vyuha/shared` must be built first -
downstream typechecks compile against its dist output.

```bash
pnpm --filter @vyuha/shared build
pnpm typecheck          # all three packages, zero errors
pnpm lint               # zero warnings; web lint also runs check-guide-anchors
pnpm --filter @vyuha/shared test
pnpm --filter @vyuha/web test      # jsdom, no services needed
pnpm --filter @vyuha/api test      # real integration tests, needs the stack, ~60s
pnpm build              # production build of all packages
```

Notes that prevent false alarms:

- The api suite boots the real AppModule over HTTP (`src/test-support/api-harness.ts`)
  with `fileParallelism: false`. ERROR lines about audit-write failures inside a
  passing run are a deliberate failure-injection probe, not a failure.
- A red api suite with the stack down is a stack problem, not a code problem.
  Say which it was.

## 3. Browser verification (when UI changed)

The class of bug the gates above cannot catch is "compiles, renders wrong".
CI's `browser` job runs `apps/web/scripts/verify-ui.mjs` (sign-in through the
real form, nav, palette, shortcut chips, overflow at 1440px and 360px, bottom
nav, WCAG contrast in both themes) against a booted API + vite dev server.
Reproduce it locally when a change touches screens:

1. Stack up, DB migrated (`pnpm --filter @vyuha/api db:migrate`) and seeded.
2. Boot the api and the web dev server.
3. `node apps/web/scripts/verify-ui.mjs` with the env it documents in its header.

If full orchestration is not feasible in the session, say so explicitly -
"browser gate not run" - rather than letting it be assumed.

## 4. Reporting rules

- Lead with the totals: files, tests, time, warnings.
- A failing gate is reported with its output, verbatim, before any analysis.
- If a result surprises you, suspect the probe before the code - re-run the
  single failing file with `pnpm --filter @vyuha/api test <file>` before
  concluding.
- Never weaken a check, skip a test, or add an exemption to make a gate pass.
