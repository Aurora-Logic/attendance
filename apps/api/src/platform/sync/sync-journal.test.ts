import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../common/env.js';
import type { Database } from '../db/db.provider.js';

/**
 * REQ-T-06: `sync_journal` is append-only at the trigger level, on the same
 * footing as `punches` and `audit_logs` — with the one exception those tables
 * do not have. D-20 retains request/response bodies for 30 days and hashes
 * for ever, so the retention sweep must be able to null the two body columns
 * and must be able to do nothing else.
 *
 * Every rule is probed from the refusing side, and the one allowance is
 * probed both ways: the sweep's exact UPDATE succeeds, and the same UPDATE
 * with a value instead of NULL refuses. Falsified during development by
 * dropping the guard trigger and watching the rewrite cases pass.
 *
 * Direct SQL through a plain pool, exactly what the triggers exist to stop:
 * the control must hold against psql and a repair script, not only against
 * the application's repository layer.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000bc';
const CONNECTION_ID = '01900000-0000-7000-8000-00000000c0bc';

let pool: Pool;
let db: Database;

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    // Drizzle wraps the driver failure; the Postgres message is on the cause.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'the statement was not refused';
}

async function insertRow(requestBody: string | null = 'request xml'): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO sync_journal (org_id, connection_id, direction, entity_type, request_hash, request_body, response_body, result)
    VALUES (${ORG_ID}, ${CONNECTION_ID}, 'PULL', 'party', 'sha256:abc', ${requestBody}, 'response xml', 'ok')
    RETURNING id
  `);
  const id = rows.rows[0]?.id;
  if (id === undefined) throw new Error('journal insert returned no row');
  return id;
}

beforeAll(async () => {
  expect(new URL(env.DATABASE_URL).port).toBe('55432');
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = drizzle(pool);

  await db.execute(sql`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}, 'Sync Journal Fixture Org')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO integration_connections (id, org_id, system, name)
    VALUES (${CONNECTION_ID}, ${ORG_ID}, 'TALLY', 'Journal Fixture Company')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await pool.end();
});

describe('sync_journal is append-only with the D-20 body-sweep exception', () => {
  it('accepts an insert', async () => {
    const id = await insertRow();
    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM sync_journal WHERE id = ${id}`,
    );
    expect(Number(rows.rows[0]?.count ?? 0)).toBe(1);
  });

  it('refuses an UPDATE that rewrites the result', async () => {
    const id = await insertRow();
    const message = await failureOf(() =>
      db.execute(sql`UPDATE sync_journal SET result = 'tampered' WHERE id = ${id}`),
    );
    expect(message).toContain('append-only');
  });

  it('refuses an UPDATE that rewrites a hash — the hash is the evidence', async () => {
    const id = await insertRow();
    const message = await failureOf(() =>
      db.execute(sql`UPDATE sync_journal SET request_hash = 'sha256:forged' WHERE id = ${id}`),
    );
    expect(message).toContain('append-only');
  });

  it('lets the retention sweep null both bodies, and nothing survives of them', async () => {
    const id = await insertRow();
    await db.execute(
      sql`UPDATE sync_journal SET request_body = NULL, response_body = NULL WHERE id = ${id}`,
    );
    const rows = await db.execute<{ request_body: string | null; request_hash: string }>(
      sql`SELECT request_body, request_hash FROM sync_journal WHERE id = ${id}`,
    );
    expect(rows.rows[0]?.request_body).toBeNull();
    // The sweep clears bulk, never proof.
    expect(rows.rows[0]?.request_hash).toBe('sha256:abc');
  });

  it('refuses an UPDATE that rewrites a body to a new value', async () => {
    const id = await insertRow();
    const message = await failureOf(() =>
      db.execute(sql`UPDATE sync_journal SET request_body = 'doctored xml' WHERE id = ${id}`),
    );
    expect(message).toContain('retention sweep');
  });

  it('refuses re-filling a body the sweep already cleared', async () => {
    const id = await insertRow(null);
    const message = await failureOf(() =>
      db.execute(sql`UPDATE sync_journal SET request_body = 'planted xml' WHERE id = ${id}`),
    );
    expect(message).toContain('retention sweep');
  });

  it('refuses a DELETE, even one that matches no rows', async () => {
    // Statement-level, like audit_logs: an empty table must still refuse.
    const message = await failureOf(() =>
      db.execute(
        sql`DELETE FROM sync_journal WHERE id = '00000000-0000-0000-0000-000000000000'`,
      ),
    );
    expect(message).toContain('append-only');
    expect(message).toContain('DELETE');
  });

  it('refuses a TRUNCATE, which bypasses UPDATE and DELETE triggers', async () => {
    const message = await failureOf(() => db.execute(sql`TRUNCATE sync_journal`));
    expect(message).toContain('append-only');
  });
});

describe('sync_cursors', () => {
  it('holds one cursor per connection per entity type', async () => {
    await db.execute(sql`
      INSERT INTO sync_cursors (org_id, connection_id, entity_type, last_alter_id)
      VALUES (${ORG_ID}, ${CONNECTION_ID}, 'party', 42)
      ON CONFLICT DO NOTHING
    `);
    const message = await failureOf(() =>
      db.execute(sql`
        INSERT INTO sync_cursors (org_id, connection_id, entity_type, last_alter_id)
        VALUES (${ORG_ID}, ${CONNECTION_ID}, 'party', 99)
      `),
    );
    expect(message).toContain('sync_cursors_uq');
  });
});
