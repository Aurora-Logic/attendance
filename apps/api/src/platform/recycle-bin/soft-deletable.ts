import { Injectable, Logger } from '@nestjs/common';
import {
  PERMISSIONS,
  type BlockingReference,
  type PermissionKey,
  type SoftDeletableEntity,
} from '@vyuha/shared';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import type { Database } from '../db/db.provider.js';
import type { OrgContext, ScopedTable } from '../db/scoped-repository.js';

/**
 * What the platform needs to know to soft-delete, restore and list a record,
 * and nothing else.
 *
 * A registry rather than seven services, for the reason `JobRegistry` exists:
 * the mechanism is the platform's and the records are not. Departments live in
 * `platform/org`, shifts and leave types live in `modules/attendance`, and a
 * shared module that imported the attendance schema to delete a shift would
 * break the one rule technical design §1 states outright. Here the arrow only
 * ever points at the platform — each module registers itself on init.
 *
 * It also means the reason, the audit shape, the in-use refusal and the
 * permission check exist exactly once. Seven copies of a destructive rule is
 * seven chances for one of them to be the copy that forgot.
 */

/**
 * One kind of row that can block a delete.
 *
 * `labelColumn` is a column, not a literal: REQ-B-09a's refusal has to say
 * *which* rows are in the way. "In use" sends an administrator hunting; "in use
 * by EMP004, EMP011 and 4 more" tells them what to go and change.
 */
export interface BlockingReferenceSpec {
  /** Plural, lower case: "employees", "current or future roster assignments". */
  readonly label: string;
  readonly table: ScopedTable;
  /** The foreign key pointing at the record being deleted. */
  readonly column: PgColumn;
  /** Renders one blocking row for a human. */
  readonly labelColumn: PgColumn;
  /** Narrows what counts as live beyond `org_id` and `deleted_at IS NULL`. */
  readonly extraPredicate?: SQL;
}

export interface SoftDeletableSpec {
  readonly entityType: SoftDeletableEntity;
  /** Singular, sentence case: "Department", "Leave type". */
  readonly label: string;
  readonly table: ScopedTable;
  readonly nameColumn: PgColumn;
  /** Null for a record with no code of its own: a holiday calendar, a role. */
  readonly codeColumn: PgColumn | null;
  /**
   * The column a restore could collide on, if it is a single column.
   *
   * Every master's unique index is partial on `deleted_at IS NULL`, so the code
   * a delete frees can be claimed while the record sits in the bin. Naming the
   * column lets the refusal say who took it. Null where the constraint spans
   * more than one column — the restore then relies on Postgres refusing, which
   * the service turns into the same kind of answer with less detail.
   */
  readonly uniqueColumn: PgColumn | null;
  /**
   * The key required to delete or restore one of these.
   *
   * Deliberately the same key that writes the record. A separate `*.delete` key
   * per master would be six more rows in the matrix answering a question nobody
   * asked: whoever may rename a department may retire one.
   */
  readonly managePermission: PermissionKey;
  readonly references: readonly BlockingReferenceSpec[];
  /**
   * Anything `references` cannot express.
   *
   * Roles are the reason it exists: membership runs through `user_roles`, which
   * is a join table with no `org_id` and no `deleted_at`, so it does not fit the
   * declarative shape at all — and a seeded role must refuse outright rather
   * than report a count. Returning blockers produces the ordinary
   * `RECORD_IN_USE` refusal; throwing an `AppError` produces whatever that error
   * says, which is how the seeded-role protection is expressed.
   *
   * Bolting these two cases into `references` would have meant a predicate
   * language; a function is smaller and says what it does.
   */
  readonly extraBlockers?: (
    db: Database,
    ctx: OrgContext,
    id: string,
  ) => Promise<readonly BlockingReference[]>;
}

/**
 * Every key that can appear as a `managePermission`, as a literal tuple.
 *
 * `@RequirePermission` is decorator metadata read when the class is defined,
 * long before any module has registered anything, so the route policy cannot be
 * computed from the registry. This is the list it uses — the guard's job is only
 * to keep out an account holding none of them, and `RecycleBinService` then
 * checks the one key the resolved entity type actually needs.
 *
 * `register()` asserts membership, so a record registered with a key missing
 * from this tuple fails at boot rather than returning 403 to whoever finds it
 * first.
 */
export const MASTER_MANAGE_KEYS = [
  PERMISSIONS.EMPLOYEE_MANAGE,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.SHIFT_MANAGE,
  PERMISSIONS.LEAVE_POLICY_MANAGE,
  PERMISSIONS.HOLIDAY_MANAGE,
  PERMISSIONS.ROLES_MANAGE,
] as const satisfies readonly PermissionKey[];

@Injectable()
export class SoftDeletableRegistry {
  private readonly logger = new Logger(SoftDeletableRegistry.name);
  private readonly specs = new Map<SoftDeletableEntity, SoftDeletableSpec>();

  register(spec: SoftDeletableSpec): void {
    if (this.specs.has(spec.entityType)) {
      // Two registrations means one silently wins, and which one would depend
      // on module initialisation order -- so a delete would enforce whichever
      // set of references happened to load second.
      throw new Error(`Soft-deletable "${spec.entityType}" is already registered.`);
    }
    if (!(MASTER_MANAGE_KEYS as readonly PermissionKey[]).includes(spec.managePermission)) {
      throw new Error(
        `Soft-deletable "${spec.entityType}" requires "${spec.managePermission}", which the ` +
          'delete route does not list. Add it to MASTER_MANAGE_KEYS, or the route will refuse ' +
          'every caller who holds only that key.',
      );
    }
    this.specs.set(spec.entityType, spec);
    this.logger.log({ msg: `Soft-deletable registered: ${spec.entityType}` });
  }

  get(entityType: SoftDeletableEntity): SoftDeletableSpec | null {
    return this.specs.get(entityType) ?? null;
  }

  all(): readonly SoftDeletableSpec[] {
    return [...this.specs.values()];
  }
}
