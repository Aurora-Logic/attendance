import {
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
  ATTENDANCE_STATUSES,
  HALF_DAY_PARTS,
  LEAVE_ACCRUAL_METHODS,
  LEAVE_DAY_PORTIONS,
  LEAVE_MOVEMENT_TYPES,
  PUNCH_SOURCES,
  PUNCH_TYPES,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../../../platform/common/env.js';
import type { Database } from '../../../platform/db/db.provider.js';
import { approvalStatusEnum, approvalTypeEnum } from '../../../platform/db/schema/approval.schema.js';
import { attendanceStatusEnum } from './attendance-day.schema.js';
import { leaveAccrualMethodEnum, leaveDayPortionEnum, leaveMovementTypeEnum } from './leave.schema.js';
import { halfDayPartEnum, punchSourceEnum, punchTypeEnum } from './punch.schema.js';

/**
 * `packages/shared/src/enums.ts` says of itself: "These mirror the Postgres
 * enum types created in the first migration; changing one means changing both."
 * That is a comment, and a comment is not a control. This file makes the drift
 * a failing test instead.
 *
 * Three copies have to agree: the contract package the web client imports, the
 * Drizzle schema, and the type that actually exists in the database. The third
 * is the one a comment can never catch -- a migration hand-edited after
 * generation would leave the first two agreeing perfectly with each other and
 * with nothing that is deployed.
 */

interface Parity {
  readonly typeName: string;
  readonly shared: readonly string[];
  readonly schema: readonly string[];
  /** True where the order is part of the contract, not just the membership. */
  readonly orderIsContract?: boolean;
}

const ENUMS: readonly Parity[] = [
  // REQ-E-02: the array order *is* the resolution order the engine applies.
  {
    typeName: 'attendance_status',
    shared: ATTENDANCE_STATUSES,
    schema: attendanceStatusEnum.enumValues,
    orderIsContract: true,
  },
  { typeName: 'punch_type', shared: PUNCH_TYPES, schema: punchTypeEnum.enumValues },
  { typeName: 'punch_source', shared: PUNCH_SOURCES, schema: punchSourceEnum.enumValues },
  { typeName: 'half_day_part', shared: HALF_DAY_PARTS, schema: halfDayPartEnum.enumValues },
  { typeName: 'approval_type', shared: APPROVAL_TYPES, schema: approvalTypeEnum.enumValues },
  { typeName: 'approval_status', shared: APPROVAL_STATUSES, schema: approvalStatusEnum.enumValues },
  {
    typeName: 'leave_movement_type',
    shared: LEAVE_MOVEMENT_TYPES,
    schema: leaveMovementTypeEnum.enumValues,
  },
  {
    typeName: 'leave_accrual_method',
    shared: LEAVE_ACCRUAL_METHODS,
    schema: leaveAccrualMethodEnum.enumValues,
  },
  // The day engine's leave lookup orders by this column to make a full day
  // outrank a half, which only works while FULL is declared first.
  {
    typeName: 'leave_day_portion',
    shared: LEAVE_DAY_PORTIONS,
    schema: leaveDayPortionEnum.enumValues,
    orderIsContract: true,
  },
];

let pool: Pool;
let db: Database;

beforeAll(() => {
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  db = drizzle(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('attendance enum parity', () => {
  it.each(ENUMS)('$typeName matches between the contract package and the schema', (parity) => {
    if (parity.orderIsContract === true) {
      expect(parity.schema).toEqual([...parity.shared]);
    } else {
      expect([...parity.schema].sort()).toEqual([...parity.shared].sort());
    }
  });

  it('matches the types that actually exist in the database', async () => {
    // string_agg rather than array_agg: Drizzle installs its own pg type
    // parsers, so an array comes back as Postgres's own "{A,B}" text and would
    // compare unequal to an array for a reason that has nothing to do with
    // enum drift. No enum label here contains a comma.
    const result = await db.execute<{ typname: string; labels: string }>(sql`
      SELECT t.typname, string_agg(e.enumlabel::text, ',' ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = ANY(${sql.param(ENUMS.map((parity) => parity.typeName))}::text[])
       GROUP BY t.typname
    `);

    const inDatabase = new Map(result.rows.map((row) => [row.typname, row.labels.split(',')]));

    // Every type is present, so a renamed or missing type fails here rather
    // than making the loop below vacuously pass.
    expect([...inDatabase.keys()].sort()).toEqual(ENUMS.map((p) => p.typeName).sort());

    for (const parity of ENUMS) {
      expect(inDatabase.get(parity.typeName), parity.typeName).toEqual([...parity.schema]);
    }
  });
});
