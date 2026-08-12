import { uuidv7 } from '@vyuha/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../common/env.js';
import type { Database } from './db.provider.js';
import { locations, organizations } from './schema/index.js';
import { ScopedRepository, type OrgContext } from './scoped-repository.js';

/**
 * ADR 0001: "an integration test asserts that a query built for org A returns
 * no rows belonging to org B." This runs against the real database on 55432,
 * not a mock -- the guarantee being tested is the SQL that reaches Postgres,
 * and a mocked client would assert only that this file calls the methods this
 * file calls.
 *
 * Every assertion about invisibility is paired with a raw, unscoped count.
 * "Org A sees none of B's rows" is trivially true when org A sees nothing at
 * all, which is exactly how a broken scope predicate would look.
 */

let pool: Pool;
let db: Database;

const orgAId = uuidv7();
const orgBId = uuidv7();
const suffix = orgAId.slice(-8);

const ctxA: OrgContext = { orgId: orgAId, actorUserId: null };
const ctxB: OrgContext = { orgId: orgBId, actorUserId: null };

let repoA: ScopedRepository<typeof locations>;
let repoB: ScopedRepository<typeof locations>;

/** Bypasses the repository on purpose: the control the tests measure against. */
async function rawLocationIds(): Promise<string[]> {
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(inArray(locations.orgId, [orgAId, orgBId]));
  return rows.map((row) => row.id);
}

async function rawDeletedAt(id: string): Promise<Date | null | undefined> {
  const rows = await db
    .select({ deletedAt: locations.deletedAt })
    .from(locations)
    .where(eq(locations.id, id));
  return rows[0]?.deletedAt;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = drizzle(pool);

  // Confirm we are talking to the port the compose file publishes, not a
  // Homebrew Postgres that happens to answer. A wrong database would make the
  // isolation assertions pass for the wrong reason: no rows anywhere.
  const port = new URL(env.DATABASE_URL).port;
  expect(port).toBe('55432');

  await db.insert(organizations).values([
    { id: orgAId, name: `Test Org A ${suffix}` },
    { id: orgBId, name: `Test Org B ${suffix}` },
  ]);

  repoA = new ScopedRepository(db, locations, ctxA);
  repoB = new ScopedRepository(db, locations, ctxB);
});

afterAll(async () => {
  // Hard delete: this is test data, and leaving soft-deleted rows behind would
  // slowly poison a developer's database.
  await db.delete(locations).where(inArray(locations.orgId, [orgAId, orgBId]));
  await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  await pool.end();
});

describe('ScopedRepository against Postgres', () => {
  it('refuses an org context that is not a UUID', () => {
    expect(() => new ScopedRepository(db, locations, { orgId: '', actorUserId: null })).toThrow(
      /UUID org id/u,
    );
    expect(
      () => new ScopedRepository(db, locations, { orgId: 'org-a', actorUserId: null }),
    ).toThrow(/UUID org id/u);
  });

  it('stamps org_id from the context, not from the caller', async () => {
    const row = await repoA.insert({ name: 'Head Office', code: `HO-${suffix}` });
    expect(row.orgId).toBe(orgAId);

    // A caller who defeats the type -- an unvalidated body cast, a stale DTO --
    // still writes into their own organisation.
    const smuggled = { name: 'Smuggled', code: `SM-${suffix}`, orgId: orgBId } as unknown as {
      name: string;
      code: string;
    };
    const forced = await repoA.insert(smuggled);
    expect(forced.orgId).toBe(orgAId);
  });

  it('returns only the rows of its own organisation', async () => {
    await repoB.insert({ name: 'Branch Office', code: `BR-${suffix}` });

    const allIds = await rawLocationIds();
    // Three rows physically exist across the two orgs. Without this the next
    // two assertions would also hold for a repository that returns nothing.
    expect(allIds).toHaveLength(3);

    const fromA = await repoA.findMany();
    const fromB = await repoB.findMany();

    expect(fromA).toHaveLength(2);
    expect(fromB).toHaveLength(1);
    expect(fromA.every((row) => row.orgId === orgAId)).toBe(true);
    expect(fromB.every((row) => row.orgId === orgBId)).toBe(true);

    const idsFromA = new Set(fromA.map((row) => row.id));
    expect(fromB.some((row) => idsFromA.has(row.id))).toBe(false);

    expect(await repoA.count()).toBe(2);
    expect(await repoB.count()).toBe(1);
  });

  it('cannot reach another organisation row by id', async () => {
    const [rowB] = await repoB.findMany();
    expect(rowB).toBeDefined();
    if (rowB === undefined) return;

    // The row is real and readable by its owner, so a null here is scoping and
    // not a missing fixture.
    expect(await repoB.findById(rowB.id)).not.toBeNull();

    expect(await repoA.findById(rowB.id)).toBeNull();
    expect(await repoA.exists(rowB.id)).toBe(false);
    expect(await repoA.update(rowB.id, { name: 'Renamed by another org' })).toBeNull();
    expect(await repoA.softDelete(rowB.id)).toBe(false);

    // And the attempted write did nothing.
    const untouched = await repoB.findById(rowB.id);
    expect(untouched?.name).toBe('Branch Office');
    expect(untouched?.deletedAt).toBeNull();
  });

  it('hides a soft-deleted row from reads while keeping it on disk', async () => {
    const target = await repoA.findOne(eq(locations.code, `SM-${suffix}`));
    expect(target).not.toBeNull();
    if (target === null) return;

    expect(await repoA.softDelete(target.id)).toBe(true);

    expect(await repoA.findById(target.id)).toBeNull();
    expect(await repoA.exists(target.id)).toBe(false);
    expect(await repoA.count()).toBe(1);
    expect((await repoA.findMany()).map((row) => row.id)).not.toContain(target.id);

    // REQ-M-04: soft delete, not delete. The row is still there.
    expect(await rawDeletedAt(target.id)).toBeInstanceOf(Date);
    expect(await rawLocationIds()).toHaveLength(3);

    // Deleting twice is not an error, and reports that nothing changed.
    expect(await repoA.softDelete(target.id)).toBe(false);
  });

  it('does not update a soft-deleted row', async () => {
    const target = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.code, `SM-${suffix}`));
    const id = target[0]?.id;
    expect(id).toBeDefined();
    if (id === undefined) return;

    expect(await repoA.update(id, { name: 'Resurrected' })).toBeNull();
  });

  it('applies limit, offset, and ordering on top of the scope', async () => {
    await repoA.insertMany([
      { name: 'Annexe', code: `AX-${suffix}` },
      { name: 'Warehouse', code: `WH-${suffix}` },
    ]);

    const ordered = await repoA.findMany({ orderBy: [locations.name] });
    expect(ordered.map((row) => row.name)).toEqual(['Annexe', 'Head Office', 'Warehouse']);

    const page = await repoA.findMany({ orderBy: [locations.name], limit: 2, offset: 1 });
    expect(page.map((row) => row.name)).toEqual(['Head Office', 'Warehouse']);

    // Org B is unaffected by any of it.
    expect(await repoB.count()).toBe(1);
  });

  it('applies the scope to a caller-supplied predicate rather than replacing it', async () => {
    const rowB = (await repoB.findMany())[0];
    expect(rowB).toBeDefined();
    if (rowB === undefined) return;

    // A predicate that matches B's row exactly still returns nothing for A.
    expect(await repoA.findMany({ where: eq(locations.id, rowB.id) })).toHaveLength(0);
    expect(await repoA.count(eq(locations.id, rowB.id))).toBe(0);
  });

  it('emits SQL containing both predicates', () => {
    // A structural check on top of the behavioural ones: if a future refactor
    // makes findMany build its own where clause, the behaviour tests above
    // could still pass on a database that happens to hold one org.
    const query = db
      .select()
      .from(locations)
      .where(new ScopedRepository(db, locations, ctxA)['scoped'](sql`true`));
    const { sql: text } = query.toSQL();

    expect(text).toContain('"org_id" =');
    expect(text).toContain('"deleted_at" is null');
  });
});
