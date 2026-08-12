import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The conventions from technical design §4, in one place so no table can
 * quietly differ from the others.
 *
 * Each helper returns a fresh object: Drizzle column builders carry per-table
 * state, so a shared frozen object would couple unrelated tables together.
 */

/**
 * UUID v7, defaulted by the database. The generator function is created in
 * migration 0000 — Postgres 16 has no built-in v7. Putting the default on the
 * column means a raw SQL insert during a migration or a repair script gets a
 * correct key without having to know about it.
 */
export const primaryId = () => uuid('id').primaryKey().default(sql`uuid_generate_v7()`);

/**
 * `created_by` / `updated_by` deliberately carry no foreign key to `users`.
 * A row can be written by a background job or a migration, where there is no
 * acting user, and `audit_logs` is the authoritative actor trail either way
 * (REQ-M-01). Users are never hard-deleted (REQ-M-04), so these cannot dangle.
 */
export const auditColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
});

/** REQ-M-04: soft delete everywhere. Nothing employee-related is hard-deleted. */
export const softDeleteColumn = () => ({
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** The full convention set: audit columns plus soft delete. */
export const standardColumns = () => ({
  ...auditColumns(),
  ...softDeleteColumn(),
});

/**
 * Rows are unique only among the living. Without the partial predicate, a
 * soft-deleted employee would permanently reserve their employee code, and
 * REQ-A-06 bulk imports would start failing on codes nobody can see.
 */
export const ALIVE = sql`deleted_at IS NULL`;
