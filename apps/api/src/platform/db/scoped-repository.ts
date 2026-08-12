import { isUuid } from '@vyuha/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { Database } from './db.provider.js';

/**
 * Technical design §4: "Every query filters `org_id` and `deleted_at IS NULL`
 * ... never by hand in each query." ADR 0001 turns that from a Prisma
 * extension into this base class, and states the consequence plainly: the base
 * class is the only sanctioned way to reach a scoped table.
 *
 * The design goal is that a caller cannot forget. There is no method here that
 * builds a statement without both predicates, and `scoped()` is the extension
 * point for subclasses that need a query this class does not provide -- so
 * even a hand-written join starts from a scoped WHERE rather than an empty one.
 *
 * Security §15 lists IDOR as "every read filtered by `org_id` + scope; never
 * trust an ID from the client". Note that `findById` filters by org *and* id
 * rather than fetching by id and comparing afterwards: the row from another
 * organisation never enters the process, so there is nothing to leak through a
 * timing difference or a careless log line.
 */

/**
 * The column set every scoped table carries, from `columns.ts`
 * (`primaryId()` + `standardColumns()`). A table missing any of these is not
 * scopable, and the constraint makes that a compile error rather than a
 * runtime surprise.
 */
export type ScopedTable = PgTable & {
  id: PgColumn;
  orgId: PgColumn;
  deletedAt: PgColumn;
  createdAt: PgColumn;
  createdBy: PgColumn;
  updatedAt: PgColumn;
  updatedBy: PgColumn;
};

export type Row<TTable extends ScopedTable> = TTable['$inferSelect'];
type NewRow<TTable extends ScopedTable> = TTable['$inferInsert'];

/**
 * Columns the repository owns. Accepting them from a caller would let a bug
 * or a crafted payload write a row into another organisation, or resurrect a
 * deleted one, through the same method that is supposed to prevent it.
 */
type ManagedColumn = 'id' | 'orgId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'deletedAt';

export type InsertInput<TTable extends ScopedTable> = Omit<NewRow<TTable>, ManagedColumn>;
export type UpdateInput<TTable extends ScopedTable> = Partial<InsertInput<TTable>>;

/**
 * Who is asking, and on whose behalf. Built once per request by the auth layer
 * and passed to every repository it constructs; never assembled from a request
 * body.
 */
export interface OrgContext {
  readonly orgId: string;
  /** Null for a background job or a migration, matching `columns.ts`. */
  readonly actorUserId: string | null;
}

export interface FindManyOptions {
  where?: SQL;
  orderBy?: (SQL | PgColumn)[];
  limit?: number;
  offset?: number;
}

export class ScopedRepository<TTable extends ScopedTable> {
  constructor(
    protected readonly db: Database,
    protected readonly table: TTable,
    protected readonly ctx: OrgContext,
  ) {
    // A malformed org id would reach Postgres as an invalid uuid literal and
    // surface as a 500 from deep inside a query. Worse, an empty string in a
    // future text-keyed table would match nothing and read as "no data" rather
    // than "wrong context". Fail where the mistake was made.
    if (!isUuid(ctx.orgId)) {
      throw new Error(`ScopedRepository requires a UUID org id, received "${ctx.orgId}".`);
    }
  }

  /**
   * Drizzle's builder signatures are conditional types over the *concrete*
   * table, and a type parameter can never satisfy them -- `from(table)` on a
   * `TTable extends PgTable` fails to resolve. Widening once, here, keeps the
   * statements well-formed for drizzle while the public methods above and
   * below stay precisely typed for callers. This is the whole cost of the
   * ADR 0001 decision to build one base class instead of per-table repositories.
   */
  protected get widened(): PgTable {
    return this.table;
  }

  /**
   * The scoped WHERE clause. Subclasses building a query this class does not
   * cover must start here rather than from `eq(...)` alone.
   */
  protected scoped(...extra: (SQL | undefined)[]): SQL {
    const predicate = and(
      eq(this.table.orgId, this.ctx.orgId),
      isNull(this.table.deletedAt),
      ...extra,
    );
    if (predicate === undefined) {
      // `and()` returns undefined only when every argument is undefined, which
      // the two fixed predicates rule out. Throwing rather than falling back to
      // a permissive clause keeps an unscoped query impossible even if a future
      // drizzle release changes that contract.
      throw new Error('Scope predicate collapsed to undefined; refusing to run an unscoped query.');
    }
    return predicate;
  }

  async findMany(options: FindManyOptions = {}): Promise<Row<TTable>[]> {
    let query = this.db.select().from(this.widened).where(this.scoped(options.where)).$dynamic();
    if (options.orderBy !== undefined && options.orderBy.length > 0) {
      query = query.orderBy(...options.orderBy);
    }
    if (options.limit !== undefined) query = query.limit(options.limit);
    if (options.offset !== undefined) query = query.offset(options.offset);
    const rows = await query;
    // Loosely typed inside the class (see `widened`), exact for the caller.
    return rows;
  }

  async findById(id: string): Promise<Row<TTable> | null> {
    return this.findOne(eq(this.table.id, id));
  }

  async findOne(where: SQL): Promise<Row<TTable> | null> {
    const rows = await this.findMany({ where, limit: 1 });
    return rows[0] ?? null;
  }

  async count(where?: SQL): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(this.widened)
      .where(this.scoped(where));
    return rows[0]?.value ?? 0;
  }

  async exists(id: string): Promise<boolean> {
    return (await this.count(eq(this.table.id, id))) > 0;
  }

  async insert(values: InsertInput<TTable>): Promise<Row<TTable>> {
    const rows = await this.insertMany([values]);
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Insert returned no row; the statement did not run as expected.');
    }
    return row;
  }

  async insertMany(values: InsertInput<TTable>[]): Promise<Row<TTable>[]> {
    if (values.length === 0) return [];
    const now = new Date();
    // Spread last so a caller who slipped an `orgId` past the type -- an
    // unvalidated JSON body cast, say -- still writes into their own org.
    const payload: Record<string, unknown>[] = values.map((value) => ({
      ...value,
      orgId: this.ctx.orgId,
      createdAt: now,
      updatedAt: now,
      createdBy: this.ctx.actorUserId,
      updatedBy: this.ctx.actorUserId,
      deletedAt: null,
    }));
    const rows = await this.db.insert(this.widened).values(payload).returning();
    // Loosely typed inside the class (see `widened`), exact for the caller.
    return rows;
  }

  /** Returns null when the id belongs to another org or is already deleted. */
  async update(id: string, values: UpdateInput<TTable>): Promise<Row<TTable> | null> {
    const payload: Record<string, unknown> = {
      ...values,
      updatedAt: new Date(),
      updatedBy: this.ctx.actorUserId,
    };
    const rows = await this.db
      .update(this.widened)
      .set(payload)
      .where(this.scoped(eq(this.table.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * REQ-M-04: nothing employee-related is hard-deleted. False means the row was
   * not visible to this org, or had already been deleted -- both are the same
   * answer to the caller and neither is an error.
   */
  async softDelete(id: string): Promise<boolean> {
    const now = new Date();
    const payload: Record<string, unknown> = {
      deletedAt: now,
      updatedAt: now,
      updatedBy: this.ctx.actorUserId,
    };
    const rows = await this.db
      .update(this.widened)
      .set(payload)
      .where(this.scoped(eq(this.table.id, id)))
      .returning({ id: this.table.id });
    return rows.length > 0;
  }
}
