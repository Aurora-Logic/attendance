import { employeeDisplayName } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness } from '../../test-support/api-harness.js';
import { employeeNameSql } from './employee-name.js';

/**
 * Run against a real database on purpose.
 *
 * The bug this closes is a property of SQL's NULL semantics, not of any
 * TypeScript in this repository: the naive expression type-checks perfectly
 * and is typed `string`. Only Postgres can say that it returns NULL. A mocked
 * or in-memory assertion here would pass against the very expression that was
 * broken in production.
 */
const ORG_ID = '01900000-0000-7000-8000-0000000000c4';

/**
 * Every shape a name arrives in, including the two that produced real bugs:
 * a null surname, and the empty string an import writes where a form wrote
 * nothing.
 */
const NAMES: readonly { first: string; last: string | null }[] = [
  { first: 'Asha', last: 'Patil' },
  { first: 'Asha', last: null },
  { first: 'Asha', last: '' },
  { first: 'Ram Kumar', last: 'Van Der Berg' },
  { first: "D'Souza", last: null },
  { first: 'Jean-Luc', last: 'Picard' },
];

let harness: ApiHarness;

/** Evaluates the fragment against literals, with no table involved. */
async function render(first: string, last: string | null): Promise<string | null> {
  const expression = employeeNameSql(
    sql`${first}::text`,
    last === null ? sql`NULL::text` : sql`${last}::text`,
  );
  const rows = await harness.db.execute<{ name: string | null }>(
    sql`SELECT ${expression} AS name`,
  );
  return rows.rows[0]?.name ?? null;
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Employee Name Fixture Org');
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('the employee display name expression', () => {
  /**
   * The assertion that makes the pair enforceable rather than merely parallel.
   *
   * A name computed in TypeScript and the same name computed in SQL appear
   * side by side in this product -- the employees list names people in JS, the
   * approvals inbox names them in SQL inside the subject line -- and two rules
   * that drift produce a person who is called one thing on one screen and
   * another thing on the next. Neither implementation is the test's authority
   * here; agreement is.
   */
  it.each(NAMES)('matches the shared function for $first / $last', async ({ first, last }) => {
    expect(await render(first, last)).toBe(employeeDisplayName(first, last));
  });

  /**
   * The case the whole file exists for, stated on its own so a failure names
   * it. Before the `coalesce`, this returned NULL, which the wire then
   * rendered as the literal string "null" as the employee's name on three
   * different screens.
   */
  it('returns the first name alone when there is no surname, not null', async () => {
    expect(await render('Asha', null)).toBe('Asha');
  });

  it('leaves no trailing space behind the missing surname', async () => {
    expect(await render('Asha', null)).not.toMatch(/\s$/u);
  });

  /**
   * The falsification: the expression this replaced, run side by side, so the
   * file states the defect rather than only the fix. If somebody "simplifies"
   * `employeeNameSql` back to a plain concatenation, the assertions above fail
   * and this one explains why.
   */
  it('proves the naive concatenation really does return null', async () => {
    const rows = await harness.db.execute<{ naive: string | null }>(
      sql`SELECT ${sql`'Asha'::text`} || ' ' || ${sql`NULL::text`} AS naive`,
    );
    expect(rows.rows[0]?.naive).toBeNull();
  });
});
