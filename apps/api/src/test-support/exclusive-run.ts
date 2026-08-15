import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from 'pg';

/**
 * One run of this suite at a time, enforced rather than requested.
 *
 * Every test file pins its organisation id as a constant -- `org-ids.test.ts`
 * exists to keep them distinct from each other -- and each `beforeAll` resets
 * that organisation. Two `vitest` processes started at once therefore execute
 * the *same* file against the *same* rows, and each one's reset deletes what
 * the other is mid-assertion on. `fileParallelism: false` orders files within a
 * run and can do nothing about a second run.
 *
 * The symptom is the worst kind. It surfaces as leave accrual and carry-forward
 * failing on balances -- "expected undefined to be 1" -- which reads as a bug in
 * the code under test, in a file nobody has touched. It has now sent three
 * separate sessions looking in the wrong place: first at the BullMQ queue
 * prefix, then at the accrual arithmetic, then at a change that turned out to
 * be web-only. Each time the file passed in isolation afterwards and the
 * conclusion was "flaky", which is the conclusion that guarantees it happens
 * again.
 *
 * A Postgres advisory lock cannot make two runs safe. What it can do is stop
 * the second one starting, immediately and legibly, instead of letting both
 * corrupt each other and blaming the code. The lock is session-scoped, so it
 * lives exactly as long as the connection held here, and a killed run releases
 * it when its socket closes -- no stale lock file to clear by hand.
 *
 * ## What this does not cover
 *
 * A second `vitest` process is the cause that is provable and now impossible.
 * There is a residual intermittent failure that this lock does *not* explain:
 * it lands on a different file each time -- leave accrual one run, holiday
 * filters the next -- and both pass in isolation and on a re-run of the whole
 * suite. It is not reproducible on demand, so it is recorded rather than
 * claimed fixed.
 *
 * The strongest remaining suspect is the developer's own API. `.env` ships
 * `JOBS_WORKER_ENABLED=true`, and two schedulers fire every fifteen minutes
 * (`reports:run-schedules`, `notification:punch-reminders`). Both sweep *every*
 * organisation, including the fixture organisations a test run is using, and
 * both write. A two-minute suite run has a real chance of crossing one of those
 * boundaries. The BullMQ queue prefix separates the queues; it does nothing
 * about the rows.
 *
 * If the flake matters to you, stop the dev API before running the suite, or
 * set `JOBS_WORKER_ENABLED=false` in its environment. That is a hypothesis with
 * a cheap test, not a diagnosis -- nobody has yet caught it in the act.
 */

/**
 * Any stable 64-bit value. Derived from the suite's name rather than a magic
 * number so a second suite in this repository would not collide by accident.
 */
const LOCK_KEY = 8_073_115_240_912_001n;

let client: Client | null = null;

function databaseUrl(): string {
  /*
   * Loaded here rather than relied upon.
   *
   * `globalSetup` runs before any test file, so `platform/common/env.ts` --
   * which normally does this on import -- has not been loaded yet. Node leaves
   * an already-set variable alone, so a value from the container, CI or a shell
   * prefix still wins over the file, exactly as it does for the application.
   */
  const envFile = resolve(process.cwd(), '.env');
  if (process.env.DATABASE_URL === undefined && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set, so the suite cannot take its run lock.');
  }
  return url;
}

export async function setup(): Promise<void> {
  client = new Client({ connectionString: databaseUrl() });
  await client.connect();

  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [LOCK_KEY.toString()],
  );

  if (result.rows[0]?.locked !== true) {
    await client.end();
    client = null;
    throw new Error(
      [
        'Another run of the API test suite is already using this database.',
        '',
        'Every test file resets its own organisation, so two runs delete each',
        "other's rows mid-assertion. The failures that produces look like bugs in",
        'leave accrual or carry-forward and are not -- they are this.',
        '',
        'Wait for the other run to finish, or point DATABASE_URL at a database of',
        'your own. Splitting the work by file does not help: both runs still reset',
        'the same organisations.',
      ].join('\n'),
    );
  }
}

export async function teardown(): Promise<void> {
  if (client === null) return;
  // Releasing explicitly rather than relying on the socket closing, so a run
  // that finishes fast does not leave the next one waiting on TCP teardown.
  await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY.toString()]);
  await client.end();
  client = null;
}
