import { ERROR_CODES, SYSTEM_ROLES, type ApiErrorBody } from '@vyuha/shared';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { PG_POOL } from './db.provider.js';

/**
 * What a caller is told when the connection pool has nothing to give it.
 *
 * Found live rather than reasoned about: with every one of the ten pool
 * connections blocked on a table lock, `GET /me/today` for an employee with
 * nothing to do with the contention answered `500 INTERNAL_ERROR` after
 * 5.067s -- exactly `connectionTimeoutMillis` -- while `GET /ready` reported
 * `503 degraded` at the same instant with the driver's own words, "timeout
 * exceeded when trying to connect".
 *
 * The two answers disagreed about the same fact, and the wrong one was the one
 * clients act on. 500 says stop; the offline punch outbox (REQ-D-10) keeps a
 * punch and re-sends it only when a request comes back without a usable
 * answer, so this status decides whether a punch taken during a slow minute
 * survives or is thrown away.
 *
 * The pool is exhausted here by checking its clients out directly, which is
 * the same starvation without needing a second session to hold a lock.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000f7';

let harness: ApiHarness;
let pool: Pool;
let token: string;

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Vyuha Pool Exhaustion');
  pool = harness.resolve<Pool>(PG_POOL);

  await harness.ensurePermissionCatalogue();
  const adminRole = await harness.createSystemRole(SYSTEM_ROLES.ADMIN);
  const admin = await harness.createUser({
    email: scopedEmail('pool.admin'),
    roleIds: [adminRole],
  });

  // Everything the fixture needs from the database happens before the pool is
  // taken away from it; a `beforeEach` here would deadlock against the test.
  const session = await harness.login(admin.email, admin.password);
  expect(session.status).toBe(200);
  token = session.token;
}, 60_000);

afterAll(async () => {
  await harness.close();
});

/**
 * Holds every connection the pool is allowed to open.
 *
 * Read from the pool's own configuration rather than repeating `10` here: a
 * change to `db.provider.ts` must make this test exhaust the new maximum, not
 * quietly stop exhausting anything.
 */
async function withExhaustedPool<T>(run: () => Promise<T>): Promise<T> {
  const max = pool.options.max ?? 10;
  const held: PoolClient[] = [];
  try {
    while (held.length < max) {
      held.push(await pool.connect());
    }
    expect(pool.idleCount).toBe(0);
    expect(held.length).toBe(max);
    return await run();
  } finally {
    for (const client of held) client.release();
  }
}

describe('a request that cannot get a database connection', () => {
  it('is answered 503 with a retry hint, not 500', async () => {
    const result = await withExhaustedPool(async () =>
      harness.get<ApiErrorBody>('/employees', { token }),
    );

    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect(result.headers.get('retry-after')).not.toBeNull();
    expect(Number(result.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 60_000);

  /**
   * The negative half. A 503 that leaked the failing SQL would be a worse bug
   * than the 500 it replaced, and the generic-message rule (technical design
   * §6) is not suspended because the status changed.
   */
  it('says nothing about the query that could not run', async () => {
    const result = await withExhaustedPool(async () =>
      harness.get<ApiErrorBody>('/employees', { token }),
    );

    const serialised = JSON.stringify(result.body);
    expect(serialised).not.toContain('select');
    expect(serialised).not.toContain('timeout exceeded');
    expect(result.body.error.requestId.length).toBeGreaterThan(0);
  }, 60_000);

  /**
   * The control, and the thing that makes the two tests above mean anything:
   * the same request against the same server with the pool free is a plain
   * 200. Without this, a 503 from a permanently broken fixture would look like
   * a pass.
   */
  it('is a normal 200 once the pool is free again', async () => {
    const result = await harness.get('/employees', { token });
    expect(result.status).toBe(200);
  }, 30_000);
});
