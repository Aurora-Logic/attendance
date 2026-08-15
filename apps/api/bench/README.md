# NFR-02 benchmark

> **NFR-02** — Any report renders its first page in under 1.5 seconds at 500
> employees × 24 months of data. **Seed a dataset of this size and benchmark
> against it.**

The requirement asks for a measurement, so this is the measurement. It lives in
the repository rather than in someone's shell history because "the reports are
fast" is a claim with a shelf life: the next aggregate, the next join, or the
next index dropped in a migration can end it, and nobody would notice from the
dev database, which holds a few thousand attendance days across every fixture
org ever created.

## Running it

```sh
# 500 employees x 731 days = 365,000 attendance days, in an org of its own.
# Idempotent; safe to re-run.
PGPASSWORD=vyuha_dev_only psql -h 127.0.0.1 -p 55432 -U vyuha -d vyuha \
  -f apps/api/bench/seed-nfr02-dataset.sql

# Then, with the API running:
node apps/api/bench/nfr02-report-latency.mjs
```

The seed needs a user to measure with. `bench@vyuha.test` is created by hand
once — see the header of the SQL — and reuses a known password hash so the
script needs no KDF parameters.

## What it measures, and what it does not

It calls the API, not the browser. NFR-02 is about the report answering; putting
Chrome in the loop would fold React's render into a number meant to describe the
server. The browser side is covered by `apps/web/scripts/verify-ui.mjs`.

Each report is timed five times at two periods: one month, which is what a
report opens on, and the full twenty-four, which is the widest a reader can ask
for. The **first** call is reported separately from the median — a cold cache
and a first plan are what somebody opening a report at 9am actually gets, and an
average that hides it flatters the result.

`monthly-muster` is reported `N/A` over the long period. It declares
`singleMonth` and refuses a period spanning more than one, by design: a grid
whose columns are days cannot show two months side by side. An earlier run of
this script counted that refusal as a failure, which is a worse outcome than
measuring nothing.

## Result, 15 August 2026

All 13 reports inside the limit. Over one month the worst was 54ms. Over
twenty-four months the worst was 345ms (absenteeism); the rest were under 140ms.

That absenteeism figure was **1,759ms** when this benchmark was first run — over
the limit — because the aggregate ran twice, once for the page and once for the
row count, each scanning and grouping the whole period. It is now one pass with
a window count. Nothing else needed changing.
