import {
  OPEN_APPROVAL_STATUSES,
  type ApprovalStatus,
  type RegularizationKind,
  type RegularizationOrigin,
} from '@vyuha/shared';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../../../platform/db/db.provider.js';
import { employees, locations, organizations, settings, users } from '../../../platform/db/schema/index.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { employeeNameSql } from '../../../platform/people/employee-name.js';
import { attendanceAdjustments, onDutyRequests, punches, regularizations } from '../schema/index.js';

/**
 * Every query the regularization and on-duty slice runs.
 *
 * `ScopedRepository` is not the base class, for the reason `LeaveRepository`
 * gives: most of the reads here are joins that carry the employee's name and
 * the decider's, and two of them compose an instant from a wall clock in SQL.
 * The rule the base class exists to enforce still holds — every statement
 * below filters `org_id` from `ctx`, and `deleted_at IS NULL` — and
 * `orgScoped()` is the single helper that does it, so a new query cannot start
 * from an empty WHERE by accident.
 */

/**
 * REQ-F-02's two limits. Spelled as literals rather than imported, because
 * `platform/settings` may not import from `modules/` — the same arrangement
 * `LEAVE_SETTING_KEYS` uses, and `settings.catalogue.test.ts` fails if either
 * side renames a key without the other.
 */
export const REGULARIZATION_SETTING_KEYS = {
  windowDays: 'attendance.regularization_window_days',
  maxPerMonth: 'attendance.regularization_max_per_month',
  autoFile: 'attendance.regularization_auto_file',
} as const;

/**
 * The statuses a request can still be decided from.
 *
 * Taken from the shared contract rather than restated, because the framework
 * decides the same question about its own rows through `isOpenApprovalStatus`.
 * Two lists spelled by hand would be two answers to "is this still open", and
 * the day they disagreed a request would be open in one table and closed in
 * the other. The spread is only to widen the readonly tuple into the mutable
 * array Drizzle's `inArray` asks for.
 */
const OPEN_STATUSES: ApprovalStatus[] = [...OPEN_APPROVAL_STATUSES];

/** UTC ISO-8601 with a literal Z, which `new Date` reads without ambiguity. */
const INSTANT_FORMAT = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);

/**
 * Never hand-roll this: a plain concatenation is NULL for anyone without a
 * surname, which is how this list once showed "null" as an employee's name.
 * `employeeNameSql` carries the reason and the test.
 */
const employeeName = employeeNameSql(employees.firstName, employees.lastName);

/** `to_char` on a nullable timestamp, for a column the wire sends as ISO text. */
function instant(column: SQL): SQL<string | null> {
  return sql<string | null>`to_char(${column} AT TIME ZONE 'UTC', ${INSTANT_FORMAT})`;
}

export interface EmployeeRegularizationContext {
  readonly id: string;
  readonly name: string;
  readonly employeeCode: string;
  readonly dateOfJoining: string;
  readonly dateOfLeaving: string | null;
  /** The location's zone, falling back to the organisation's (NFR-05). */
  readonly timezone: string;
}

export interface RegularizationRow {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly employeeCode: string;
  readonly date: string;
  readonly kind: RegularizationKind;
  readonly requestedIn: string | null;
  readonly requestedOut: string | null;
  /** Null only for an uncompleted `SYSTEM`-origin draft. */
  readonly reason: string | null;
  readonly origin: RegularizationOrigin;
  readonly attachmentFileId: string | null;
  readonly approvalRequestId: string | null;
  readonly status: ApprovalStatus;
  readonly raisedAt: string;
  readonly decidedAt: string | null;
  readonly decidedById: string | null;
  readonly decidedByName: string | null;
  readonly decisionReason: string | null;
}

export interface OnDutyRow {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly employeeCode: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly reason: string;
  readonly siteName: string | null;
  readonly approvalRequestId: string | null;
  readonly status: ApprovalStatus;
  readonly raisedAt: string;
  readonly decidedAt: string | null;
  readonly decidedById: string | null;
  readonly decidedByName: string | null;
  readonly decisionReason: string | null;
}

export interface ListFilters {
  readonly scope: SQL;
  readonly status?: ApprovalStatus | undefined;
  readonly employeeId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly limit: number;
  readonly offset: number;
  /**
   * Whose drafts stay visible; see `draftVisibleTo`. Only `listRegularizations`
   * reads this -- `listOnDuty` shares the interface but has no draft concept,
   * so leaving it out there is harmless.
   */
  readonly viewerEmployeeId?: string | null;
}

/**
 * A `SYSTEM` draft with no reason yet is invisible to everyone but the
 * employee it is about -- the whole point of leaving it blank until they
 * fill it in, per the setting's design. Applied to every read of
 * `regularizations` outside `raiseSystemDraft`/`completeSystemDraft`
 * themselves, which is why it lives beside `orgScoped` rather than only in
 * `listRegularizations`: a single-row fetch has to hide it exactly as much
 * as a list does.
 */
function draftVisibleTo(viewerEmployeeId: string | null): SQL {
  return viewerEmployeeId === null
    ? sql`NOT (${regularizations.origin} = 'SYSTEM' AND ${regularizations.reason} IS NULL)`
    : sql`(NOT (${regularizations.origin} = 'SYSTEM' AND ${regularizations.reason} IS NULL) OR ${regularizations.employeeId} = ${viewerEmployeeId})`;
}

export interface ComposedTimes {
  readonly adjustedIn: Date | null;
  readonly adjustedOut: Date | null;
}

export class RegularizationRepository {
  constructor(
    private readonly db: Database,
    private readonly ctx: OrgContext,
  ) {}

  /** Mirrors `ScopedRepository.scoped()`; see the class comment. */
  private orgScoped(orgPredicate: SQL, ...extra: (SQL | undefined)[]): SQL {
    const predicate = and(orgPredicate, ...extra);
    if (predicate === undefined) {
      throw new Error('Scope predicate collapsed to undefined; refusing to run an unscoped query.');
    }
    return predicate;
  }

  /**
   * Runs `fn` against a repository bound to one transaction.
   *
   * The raw executor is handed over beside it because `ApprovalService.raise`
   * takes one: a request row and the approval that governs it are one fact, and
   * a raise committed apart from its subject leaves a record no inbox can show
   * or a request nobody can decide. `LeaveRepository.transaction` has the same
   * two-argument shape for the same reason.
   */
  async transaction<T>(
    fn: (repository: RegularizationRepository, executor: Database) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => fn(new RegularizationRepository(tx, this.ctx), tx));
  }

  // ------------------------------------------------------------- settings

  private async readNumberSetting(key: string, fallback: number): Promise<number> {
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(
        this.orgScoped(
          eq(settings.orgId, this.ctx.orgId),
          eq(settings.key, key),
          isNull(settings.deletedAt),
        ),
      )
      .limit(1);

    const stored = rows[0]?.value;
    // A row that is not a whole number falls back rather than throwing. The
    // settings screen is the only place a corrupt row can be repaired, and
    // refusing every regularization until somebody notices would take the
    // feature down over a value the schema already refuses to write.
    if (typeof stored !== 'number' || !Number.isInteger(stored) || stored < 0) return fallback;
    return stored;
  }

  /**
   * REQ-F-02, read from `settings` and never hardcoded.
   *
   * The fallbacks are `DEFAULT_ATTENDANCE_POLICY`'s, restated rather than
   * imported for the boundary reason above. `settings.catalogue.test.ts`
   * guards the key names; the numbers are the PRD's own defaults (7 and 3).
   */
  async readPolicy(): Promise<{ windowDays: number; maxPerMonth: number }> {
    const [windowDays, maxPerMonth] = await Promise.all([
      this.readNumberSetting(REGULARIZATION_SETTING_KEYS.windowDays, 7),
      this.readNumberSetting(REGULARIZATION_SETTING_KEYS.maxPerMonth, 3),
    ]);
    return { windowDays, maxPerMonth };
  }

  /** `attendance.regularization_auto_file`. Off unless a row says otherwise. */
  async readAutoFileEnabled(): Promise<boolean> {
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(
        this.orgScoped(
          eq(settings.orgId, this.ctx.orgId),
          eq(settings.key, REGULARIZATION_SETTING_KEYS.autoFile),
          isNull(settings.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.value === true;
  }

  // ------------------------------------------------------------- employee

  async findEmployee(employeeId: string): Promise<EmployeeRegularizationContext | null> {
    const rows = await this.db
      .select({
        id: employees.id,
        name: employeeName,
        employeeCode: employees.employeeCode,
        dateOfJoining: employees.dateOfJoining,
        dateOfLeaving: employees.dateOfLeaving,
        timezone: sql<string>`coalesce(${locations.timezone}, ${organizations.timezone})`,
      })
      .from(employees)
      .innerJoin(organizations, eq(organizations.id, employees.orgId))
      .leftJoin(locations, and(eq(locations.id, employees.locationId), isNull(locations.deletedAt)))
      .where(
        this.orgScoped(
          eq(employees.orgId, this.ctx.orgId),
          eq(employees.id, employeeId),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * The login belonging to an employee, if there is one (REQ-B-02).
   *
   * An approval names a *user*, because that is who has an inbox, while a
   * regularization names an employee. The oldest living active account wins, so
   * an employee who was re-invited keeps the same requester across requests.
   */
  async findUserIdForEmployee(employeeId: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        this.orgScoped(
          eq(users.orgId, this.ctx.orgId),
          eq(users.employeeId, employeeId),
          isNull(users.deletedAt),
          eq(users.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(users.createdAt))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /**
   * What calendar date it is where this employee is standing.
   *
   * Asked of Postgres rather than computed here so it uses the same zone
   * database `AT TIME ZONE` uses everywhere else in this module — a Node
   * process and a Postgres server on different tzdata releases disagree about
   * exactly one thing, and it is always the boundary case somebody hits.
   */
  async todayFor(timezone: string): Promise<string> {
    const rows = await this.db.execute<{ today: string }>(
      sql`SELECT to_char((now() AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS today`,
    );
    const today = rows.rows[0]?.today;
    if (typeof today !== 'string') {
      throw new Error(`Could not resolve today's date in the "${timezone}" timezone.`);
    }
    return today;
  }

  // ---------------------------------------------------------------- times

  /**
   * A wall clock on a calendar date, as an instant.
   *
   * Postgres does the conversion because `AT TIME ZONE` knows the full history
   * of a zone's offsets; doing it in JavaScript would be right until the first
   * date that crosses a rule change (technical design §5, and the note on
   * `DayEngineRepository.resolveShift`).
   *
   * **Why the OUT can land on the next day.** REQ-C-02 attributes a night
   * shift to the date its shift *starts*, so an employee correcting "I left at
   * 02:00" on a shift that began at 21:00 means 02:00 tomorrow. Rather than
   * re-resolving the roster to ask whether the shift crosses midnight — a
   * second implementation of step 1 that could disagree with the first — the
   * rule is read off the times themselves: an OUT at or before the IN it is
   * paired with is the next morning. The IN it is paired with is the one being
   * requested, or, when only the OUT is being supplied, the IN punch already
   * on the day.
   */
  async composeTimes(input: {
    date: string;
    timezone: string;
    requestedIn: string | null;
    requestedOut: string | null;
    /** The day's existing first IN punch, when one exists. */
    existingIn: Date | null;
  }): Promise<ComposedTimes> {
    if (input.requestedIn === null && input.requestedOut === null) {
      return { adjustedIn: null, adjustedOut: null };
    }

    const rows = await this.db.execute<{ in_at: string | null; out_at: string | null }>(sql`
      WITH composed AS (
        SELECT
          CASE WHEN ${input.requestedIn}::text IS NULL THEN NULL
               ELSE (${input.date}::date + ${input.requestedIn}::text::time)
                    AT TIME ZONE ${input.timezone} END AS in_at,
          CASE WHEN ${input.requestedOut}::text IS NULL THEN NULL
               ELSE (${input.date}::date + ${input.requestedOut}::text::time)
                    AT TIME ZONE ${input.timezone} END AS out_at,
          ${input.existingIn}::timestamptz AS existing_in
      )
      SELECT
        to_char(in_at AT TIME ZONE 'UTC', ${INSTANT_FORMAT}) AS in_at,
        to_char(
          CASE
            WHEN out_at IS NULL THEN NULL
            WHEN coalesce(in_at, existing_in) IS NOT NULL
                 AND out_at <= coalesce(in_at, existing_in) THEN out_at + interval '1 day'
            ELSE out_at
          END AT TIME ZONE 'UTC', ${INSTANT_FORMAT}) AS out_at
      FROM composed
    `);

    const row = rows.rows[0];
    if (row === undefined) throw new Error('Composing the requested times returned no row.');

    return {
      adjustedIn: parseInstant(row.in_at, 'the requested in time'),
      adjustedOut: parseInstant(row.out_at, 'the requested out time'),
    };
  }

  /** The day's first IN punch, so a lone OUT correction has something to pair with. */
  async firstInPunchAt(employeeId: string, date: string): Promise<Date | null> {
    const rows = await this.db
      .select({ serverTime: instant(sql`min(${punches.serverTime})`) })
      .from(punches)
      .where(
        this.orgScoped(
          eq(punches.orgId, this.ctx.orgId),
          eq(punches.employeeId, employeeId),
          // REQ-C-02: attribution was decided at punch time, so a night
          // shift's early-hours OUT is already filed under the start date.
          eq(punches.attendanceDate, date),
          eq(punches.punchType, 'IN'),
          // No `deleted_at` predicate: REQ-D-12 makes punches immutable, so
          // the table carries no soft-delete column and a mutation trigger
          // refuses one. See the note on the `punches` table.
        ),
      );
    return parseInstant(rows[0]?.serverTime ?? null, 'the first in punch');
  }

  // ------------------------------------------------------ regularizations

  /** REQ-F-02's cap, counted over the calendar month the request is made in. */
  async countRaisedBetween(employeeId: string, from: string, to: string): Promise<number> {
    const rows = await this.db
      .select({ total: count() })
      .from(regularizations)
      .where(
        this.orgScoped(
          eq(regularizations.orgId, this.ctx.orgId),
          eq(regularizations.employeeId, employeeId),
          isNull(regularizations.deletedAt),
          gte(regularizations.createdAt, sql`${from}::date`),
          // `< to + 1 day` rather than `<= to`, because `created_at` is a
          // timestamp: `<= '2026-08-31'` means midnight and would drop
          // everything raised on the last day of the month.
          sql`${regularizations.createdAt} < (${to}::date + 1)`,
          // A rejected request still counts. The cap exists to bound how often
          // one person asks, and a rejection is an ask that cost an approver
          // their attention. A cancelled one does not exist yet -- there is no
          // cancel route -- and if one is added it should be excluded here.
          sql`${regularizations.status} <> 'CANCELLED'`,
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /**
   * An open request for this day, meaning one still capable of being decided.
   *
   * `ESCALATED` counts. REQ-G-09's timer moves an unanswered request up a level
   * and it stays decidable, so treating it as closed would let the same day be
   * regularized a second time while the first is still in somebody's inbox --
   * and the partial unique index behind this check covers both statuses for
   * exactly that reason (migration 0017).
   */
  async findOpenForDate(employeeId: string, date: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: regularizations.id })
      .from(regularizations)
      .where(
        this.orgScoped(
          eq(regularizations.orgId, this.ctx.orgId),
          eq(regularizations.employeeId, employeeId),
          eq(regularizations.date, date),
          inArray(regularizations.status, OPEN_STATUSES),
          isNull(regularizations.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /** Ties a raised request to the approval that governs it (REQ-I-01). */
  async linkRegularizationApproval(id: string, approvalRequestId: string): Promise<boolean> {
    const rows = await this.db
      .update(regularizations)
      .set({ approvalRequestId, updatedAt: new Date(), updatedBy: this.ctx.actorUserId })
      .where(
        this.orgScoped(
          eq(regularizations.orgId, this.ctx.orgId),
          eq(regularizations.id, id),
          isNull(regularizations.deletedAt),
        ),
      )
      .returning({ id: regularizations.id });
    return rows.length > 0;
  }

  async linkOnDutyApproval(id: string, approvalRequestId: string): Promise<boolean> {
    const rows = await this.db
      .update(onDutyRequests)
      .set({ approvalRequestId, updatedAt: new Date(), updatedBy: this.ctx.actorUserId })
      .where(
        this.orgScoped(
          eq(onDutyRequests.orgId, this.ctx.orgId),
          eq(onDutyRequests.id, id),
          isNull(onDutyRequests.deletedAt),
        ),
      )
      .returning({ id: onDutyRequests.id });
    return rows.length > 0;
  }

  async insertRegularization(input: {
    employeeId: string;
    date: string;
    kind: RegularizationKind;
    requestedIn: Date | null;
    requestedOut: Date | null;
    /** Null only for the `SYSTEM`-origin draft `insertSystemDraft` writes. */
    reason: string | null;
    origin: RegularizationOrigin;
    attachmentFileId: string | null;
  }): Promise<string> {
    const rows = await this.db
      .insert(regularizations)
      .values({
        orgId: this.ctx.orgId,
        employeeId: input.employeeId,
        date: input.date,
        kind: input.kind,
        requestedIn: input.requestedIn,
        requestedOut: input.requestedOut,
        reason: input.reason,
        origin: input.origin,
        attachmentFileId: input.attachmentFileId,
        createdBy: this.ctx.actorUserId,
        updatedBy: this.ctx.actorUserId,
      })
      .returning({ id: regularizations.id });

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('The regularization insert returned no row.');
    return id;
  }

  /**
   * The auto-file setting's write. A `WRONG_TIME` draft, reason left null,
   * `origin: 'SYSTEM'`, proposing no change -- see `RegularizationService.raiseSystemDraft`
   * for why the times equal the punch as it stands rather than a guess.
   */
  async insertSystemDraft(input: {
    employeeId: string;
    date: string;
    requestedIn: Date | null;
    requestedOut: Date | null;
  }): Promise<string> {
    return this.insertRegularization({
      employeeId: input.employeeId,
      date: input.date,
      kind: 'WRONG_TIME',
      requestedIn: input.requestedIn,
      requestedOut: input.requestedOut,
      reason: null,
      origin: 'SYSTEM',
      attachmentFileId: null,
    });
  }

  /**
   * Turns an uncompleted `SYSTEM` draft into a real request: the reason the
   * employee gave, and the times if they changed either one. Matches only a
   * row still waiting -- `origin = 'SYSTEM' AND reason IS NULL` -- so this can
   * never overwrite a request that was already raised or decided.
   */
  async completeSystemDraft(
    id: string,
    input: { reason: string; requestedIn: Date | null; requestedOut: Date | null },
  ): Promise<boolean> {
    const rows = await this.db
      .update(regularizations)
      .set({
        reason: input.reason,
        requestedIn: input.requestedIn,
        requestedOut: input.requestedOut,
        updatedAt: new Date(),
        updatedBy: this.ctx.actorUserId,
      })
      .where(
        this.orgScoped(
          eq(regularizations.orgId, this.ctx.orgId),
          eq(regularizations.id, id),
          eq(regularizations.origin, 'SYSTEM'),
          isNull(regularizations.reason),
          isNull(regularizations.deletedAt),
        ),
      )
      .returning({ id: regularizations.id });
    return rows.length > 0;
  }

  private regularizationSelect() {
    return this.db
      .select({
        id: regularizations.id,
        employeeId: regularizations.employeeId,
        employeeName,
        employeeCode: employees.employeeCode,
        date: regularizations.date,
        kind: regularizations.kind,
        requestedIn: instant(sql`${regularizations.requestedIn}`),
        requestedOut: instant(sql`${regularizations.requestedOut}`),
        reason: regularizations.reason,
        origin: regularizations.origin,
        attachmentFileId: regularizations.attachmentFileId,
        approvalRequestId: regularizations.approvalRequestId,
        status: regularizations.status,
        raisedAt: instant(sql`${regularizations.createdAt}`),
        decidedAt: instant(sql`${regularizations.decidedAt}`),
        decidedById: users.id,
        decidedByName: users.email,
        decisionReason: regularizations.decisionReason,
      })
      .from(regularizations)
      .innerJoin(employees, eq(employees.id, regularizations.employeeId))
      .leftJoin(users, eq(users.id, regularizations.decidedBy));
  }

  async listRegularizations(
    filters: ListFilters,
  ): Promise<{ rows: RegularizationRow[]; total: number }> {
    const where = this.orgScoped(
      eq(regularizations.orgId, this.ctx.orgId),
      isNull(regularizations.deletedAt),
      filters.scope,
      draftVisibleTo(filters.viewerEmployeeId ?? null),
      filters.status === undefined ? undefined : eq(regularizations.status, filters.status),
      filters.employeeId === undefined
        ? undefined
        : eq(regularizations.employeeId, filters.employeeId),
      filters.from === undefined ? undefined : gte(regularizations.date, filters.from),
      filters.to === undefined ? undefined : lte(regularizations.date, filters.to),
    );

    const [rows, totals] = await Promise.all([
      this.regularizationSelect()
        .where(where)
        // Newest first, then by id so two raised in the same millisecond do
        // not swap places between pages.
        .orderBy(desc(regularizations.date), desc(regularizations.createdAt), asc(regularizations.id))
        .limit(filters.limit)
        .offset(filters.offset),
      this.db
        .select({ total: count() })
        .from(regularizations)
        .innerJoin(employees, eq(employees.id, regularizations.employeeId))
        .where(where),
    ]);

    return { rows: rows.map(toRegularizationRow), total: totals[0]?.total ?? 0 };
  }

  /**
   * `viewerEmployeeId` is omitted by the two internal callers that already
   * know a draft cannot be the row in question -- `applyApprovalDecision`
   * only ever reaches a row the framework is deciding, and a draft has no
   * approval to decide. Every principal-scoped caller passes it.
   */
  async findRegularization(
    id: string,
    scope: SQL,
    viewerEmployeeId?: string | null,
  ): Promise<RegularizationRow | null> {
    const rows = await this.regularizationSelect()
      .where(
        this.orgScoped(
          eq(regularizations.orgId, this.ctx.orgId),
          eq(regularizations.id, id),
          isNull(regularizations.deletedAt),
          scope,
          viewerEmployeeId === undefined ? undefined : draftVisibleTo(viewerEmployeeId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toRegularizationRow(row);
  }

  /**
   * The one lookup a draft's own employee needs outside the framework: does
   * this row still exist, still `SYSTEM`-origin, still waiting on a reason.
   * No scope predicate beyond the id and the employee, because completing a
   * draft is not "raising for somebody else" and carries no approver key to
   * check.
   */
  async findOwnDraft(id: string, employeeId: string): Promise<RegularizationRow | null> {
    const rows = await this.regularizationSelect()
      .where(
        this.orgScoped(
          eq(regularizations.orgId, this.ctx.orgId),
          eq(regularizations.id, id),
          eq(regularizations.employeeId, employeeId),
          eq(regularizations.origin, 'SYSTEM'),
          isNull(regularizations.reason),
          isNull(regularizations.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toRegularizationRow(row);
  }

  /**
   * Moves a request out of an open status, and only out of an open status.
   *
   * The status predicate is the lock: two approvers clicking at the same
   * moment both pass the service's status check, and exactly one of them
   * updates a row here. The other gets `false` and is told the request was
   * already actioned, rather than both writing an adjustment.
   *
   * `ESCALATED` is in the predicate because REQ-G-09's timer can put a request
   * there while it waits, and a request the framework still considers open must
   * stay decidable on this side too.
   */
  async decideRegularization(
    id: string,
    input: { status: ApprovalStatus; decidedAt: Date; decidedBy: string | null; reason: string | null },
  ): Promise<boolean> {
    const rows = await this.db
      .update(regularizations)
      .set({
        status: input.status,
        decidedAt: input.decidedAt,
        decidedBy: input.decidedBy,
        decisionReason: input.reason,
        updatedAt: new Date(),
        updatedBy: this.ctx.actorUserId,
      })
      .where(
        this.orgScoped(
          eq(regularizations.orgId, this.ctx.orgId),
          eq(regularizations.id, id),
          inArray(regularizations.status, OPEN_STATUSES),
          isNull(regularizations.deletedAt),
        ),
      )
      .returning({ id: regularizations.id });

    return rows.length > 0;
  }

  /**
   * REQ-G-09's move, mirrored onto the subject.
   *
   * Deliberately not `decideRegularization('ESCALATED', ...)`: an escalation is
   * not a decision and must not stamp `decided_at` / `decided_by`, which the
   * `*_decision_is_attributed` check pairs and which a later real decision
   * would then be unable to attribute to the person who made it.
   */
  async escalateRegularization(id: string): Promise<boolean> {
    const rows = await this.db
      .update(regularizations)
      .set({ status: 'ESCALATED', updatedAt: new Date(), updatedBy: this.ctx.actorUserId })
      .where(
        this.orgScoped(
          eq(regularizations.orgId, this.ctx.orgId),
          eq(regularizations.id, id),
          inArray(regularizations.status, OPEN_STATUSES),
          isNull(regularizations.deletedAt),
        ),
      )
      .returning({ id: regularizations.id });
    return rows.length > 0;
  }

  /** See `escalateRegularization`. */
  async escalateOnDuty(id: string): Promise<boolean> {
    const rows = await this.db
      .update(onDutyRequests)
      .set({ status: 'ESCALATED', updatedAt: new Date(), updatedBy: this.ctx.actorUserId })
      .where(
        this.orgScoped(
          eq(onDutyRequests.orgId, this.ctx.orgId),
          eq(onDutyRequests.id, id),
          inArray(onDutyRequests.status, OPEN_STATUSES),
          isNull(onDutyRequests.deletedAt),
        ),
      )
      .returning({ id: onDutyRequests.id });
    return rows.length > 0;
  }

  // ----------------------------------------------------------- adjustment

  /** REQ-F-03: the adjusting record, beside the punches and never in them. */
  async insertAdjustment(input: {
    employeeId: string;
    attendanceDate: string;
    regularizationId: string;
    adjustedIn: Date | null;
    adjustedOut: Date | null;
    reason: string;
    /** Null when REQ-G-09's escalation timer, not a person, carried it. */
    approvedBy: string | null;
  }): Promise<string> {
    const rows = await this.db
      .insert(attendanceAdjustments)
      .values({
        orgId: this.ctx.orgId,
        employeeId: input.employeeId,
        attendanceDate: input.attendanceDate,
        regularizationId: input.regularizationId,
        adjustedIn: input.adjustedIn,
        adjustedOut: input.adjustedOut,
        reason: input.reason,
        approvedBy: input.approvedBy,
        createdBy: this.ctx.actorUserId,
        updatedBy: this.ctx.actorUserId,
      })
      .returning({ id: attendanceAdjustments.id });

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('The adjustment insert returned no row.');
    return id;
  }

  // -------------------------------------------------------------- on duty

  async insertOnDuty(input: {
    employeeId: string;
    fromDate: string;
    toDate: string;
    reason: string;
    siteName: string | null;
  }): Promise<string> {
    const rows = await this.db
      .insert(onDutyRequests)
      .values({
        orgId: this.ctx.orgId,
        employeeId: input.employeeId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
        siteName: input.siteName,
        createdBy: this.ctx.actorUserId,
        updatedBy: this.ctx.actorUserId,
      })
      .returning({ id: onDutyRequests.id });

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('The on-duty insert returned no row.');
    return id;
  }

  /** An overlapping live request, so the same days are not claimed twice. */
  async findOverlappingOnDuty(
    employeeId: string,
    fromDate: string,
    toDate: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ id: onDutyRequests.id })
      .from(onDutyRequests)
      .where(
        this.orgScoped(
          eq(onDutyRequests.orgId, this.ctx.orgId),
          eq(onDutyRequests.employeeId, employeeId),
          isNull(onDutyRequests.deletedAt),
          // Two ranges overlap when each starts before the other ends.
          lte(onDutyRequests.fromDate, toDate),
          gte(onDutyRequests.toDate, fromDate),
          // `ESCALATED` joins the list for the reason `findOpenForDate` gives:
          // REQ-G-09's timer moves an unanswered request up a level and it is
          // still live, so the days it claims are still claimed.
          sql`${onDutyRequests.status} IN ('PENDING', 'ESCALATED', 'APPROVED')`,
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  private onDutySelect() {
    return this.db
      .select({
        id: onDutyRequests.id,
        employeeId: onDutyRequests.employeeId,
        employeeName,
        employeeCode: employees.employeeCode,
        fromDate: onDutyRequests.fromDate,
        toDate: onDutyRequests.toDate,
        reason: onDutyRequests.reason,
        siteName: onDutyRequests.siteName,
        approvalRequestId: onDutyRequests.approvalRequestId,
        status: onDutyRequests.status,
        raisedAt: instant(sql`${onDutyRequests.createdAt}`),
        decidedAt: instant(sql`${onDutyRequests.decidedAt}`),
        decidedById: users.id,
        decidedByName: users.email,
        decisionReason: onDutyRequests.decisionReason,
      })
      .from(onDutyRequests)
      .innerJoin(employees, eq(employees.id, onDutyRequests.employeeId))
      .leftJoin(users, eq(users.id, onDutyRequests.decidedBy));
  }

  async listOnDuty(filters: ListFilters): Promise<{ rows: OnDutyRow[]; total: number }> {
    const where = this.orgScoped(
      eq(onDutyRequests.orgId, this.ctx.orgId),
      isNull(onDutyRequests.deletedAt),
      filters.scope,
      filters.status === undefined ? undefined : eq(onDutyRequests.status, filters.status),
      filters.employeeId === undefined
        ? undefined
        : eq(onDutyRequests.employeeId, filters.employeeId),
      filters.from === undefined ? undefined : gte(onDutyRequests.toDate, filters.from),
      filters.to === undefined ? undefined : lte(onDutyRequests.fromDate, filters.to),
    );

    const [rows, totals] = await Promise.all([
      this.onDutySelect()
        .where(where)
        .orderBy(desc(onDutyRequests.fromDate), desc(onDutyRequests.createdAt), asc(onDutyRequests.id))
        .limit(filters.limit)
        .offset(filters.offset),
      this.db
        .select({ total: count() })
        .from(onDutyRequests)
        .innerJoin(employees, eq(employees.id, onDutyRequests.employeeId))
        .where(where),
    ]);

    return { rows: rows.map(toOnDutyRow), total: totals[0]?.total ?? 0 };
  }

  async findOnDuty(id: string, scope: SQL): Promise<OnDutyRow | null> {
    const rows = await this.onDutySelect()
      .where(
        this.orgScoped(
          eq(onDutyRequests.orgId, this.ctx.orgId),
          eq(onDutyRequests.id, id),
          isNull(onDutyRequests.deletedAt),
          scope,
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toOnDutyRow(row);
  }

  /** See `decideRegularization`: the status predicate is what serialises two clicks. */
  async decideOnDuty(
    id: string,
    input: { status: ApprovalStatus; decidedAt: Date; decidedBy: string | null; reason: string | null },
  ): Promise<boolean> {
    const rows = await this.db
      .update(onDutyRequests)
      .set({
        status: input.status,
        decidedAt: input.decidedAt,
        decidedBy: input.decidedBy,
        decisionReason: input.reason,
        updatedAt: new Date(),
        updatedBy: this.ctx.actorUserId,
      })
      .where(
        this.orgScoped(
          eq(onDutyRequests.orgId, this.ctx.orgId),
          eq(onDutyRequests.id, id),
          inArray(onDutyRequests.status, OPEN_STATUSES),
          isNull(onDutyRequests.deletedAt),
        ),
      )
      .returning({ id: onDutyRequests.id });

    return rows.length > 0;
  }
}

// ---------------------------------------------------------------- helpers

function parseInstant(value: string | null, label: string): Date | null {
  if (value === null) return null;
  const instantValue = new Date(value);
  if (Number.isNaN(instantValue.getTime())) {
    throw new Error(`Expected ${label} to be a valid instant, received "${value}".`);
  }
  return instantValue;
}

/**
 * `created_at` is NOT NULL, so its formatted form cannot be null; the empty
 * string is the type system's price for saying so, and it is never reached.
 */
function toRegularizationRow(row: {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  date: string;
  kind: RegularizationKind;
  requestedIn: string | null;
  requestedOut: string | null;
  reason: string | null;
  origin: RegularizationOrigin;
  attachmentFileId: string | null;
  approvalRequestId: string | null;
  status: ApprovalStatus;
  raisedAt: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
}): RegularizationRow {
  return { ...row, raisedAt: row.raisedAt ?? '' };
}

function toOnDutyRow(row: {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  fromDate: string;
  toDate: string;
  reason: string;
  siteName: string | null;
  approvalRequestId: string | null;
  status: ApprovalStatus;
  raisedAt: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
}): OnDutyRow {
  return { ...row, raisedAt: row.raisedAt ?? '' };
}
