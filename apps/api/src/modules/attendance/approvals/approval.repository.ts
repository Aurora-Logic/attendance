import {
  employeeDisplayName,
  type ApprovalAction,
  type ApprovalRequestSummary,
  type ApprovalStatus,
  type ApprovalStepRecord,
  type ApprovalType,
  type ApprovalView,
  type NamedRef,
} from '@vyuha/shared';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../../../platform/db/db.provider.js';
import { employees, organizations, users } from '../../../platform/db/schema/index.js';
import { ScopedRepository, type OrgContext } from '../../../platform/db/scoped-repository.js';
import {
  approvalDelegations,
  approvalRequests,
  approvalSteps,
  delegationLiveOn,
} from '../schema/approval.schema.js';

/**
 * Every statement the approval framework runs (technical design §4.3, ADR
 * 0001: nothing queries the database outside this layer).
 *
 * Three scoped repositories rather than one, because `ScopedRepository` binds
 * to a single table and the three tables have genuinely different lifetimes: a
 * request is advanced, a step is written once and then answered, a delegation
 * is a standing grant. `ApprovalSweepRepository` at the foot is the exception
 * and says why.
 */

/**
 * Created once at module scope. `alias()` mints a new object per call, and a
 * join built from one instance while the select reads another names two
 * different aliases -- which Postgres answers with a cross join.
 */
const requesterUser = alias(users, 'requester_user');
const requesterEmployee = alias(employees, 'requester_employee');
const approverUser = alias(users, 'approver_user');
const approverEmployee = alias(employees, 'approver_employee');
const actorUser = alias(users, 'actor_user');
const actorEmployee = alias(employees, 'actor_employee');
const delegatorUser = alias(users, 'delegator_user');
const delegatorEmployee = alias(employees, 'delegator_employee');
const fromUser = alias(users, 'delegation_from_user');
const fromEmployee = alias(employees, 'delegation_from_employee');
const toUser = alias(users, 'delegation_to_user');
const toEmployee = alias(employees, 'delegation_to_employee');

/**
 * The reader-facing name for a user.
 *
 * An account with no employee record (REQ-B-02) still raises and decides
 * things, and rendering it as an empty string would produce an inbox row
 * whose requester column is blank. The email is the honest fallback.
 */
function nameOf(
  firstName: string | null,
  lastName: string | null,
  email: string,
): string {
  if (firstName === null) return email;
  return employeeDisplayName(firstName, lastName);
}

function refOf(
  id: string | null,
  firstName: string | null,
  lastName: string | null,
  email: string | null,
): NamedRef | null {
  if (id === null || email === null) return null;
  return { id, name: nameOf(firstName, lastName, email) };
}

export interface ApprovalListFilters {
  readonly view: ApprovalView;
  /** Resolved by `ScopeService`; never built here and never optional. */
  readonly scope: SQL;
  readonly actorUserId: string;
  readonly type?: ApprovalType | undefined;
  readonly status?: ApprovalStatus | undefined;
  readonly subjectType?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

/** The columns of a request that the decision and escalation paths read. */
export interface ApprovalRequestRow {
  readonly id: string;
  readonly type: ApprovalType;
  readonly requesterUserId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly subjectSummary: string;
  readonly currentStep: number;
  readonly status: ApprovalStatus;
  readonly currentStepStartedAt: Date;
  readonly escalateAfterDays: number;
  readonly escalatedAt: Date | null;
  readonly createdAt: Date;
}

export interface ApprovalStepRow {
  readonly id: string;
  readonly stepNo: number;
  readonly approverUserId: string;
  readonly action: ApprovalAction | null;
}

export class ApprovalRepository extends ScopedRepository<typeof approvalRequests> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, approvalRequests, ctx);
  }

  /**
   * Today, on the organisation's calendar.
   *
   * A scalar subquery rather than a value computed in Node, because the
   * question "is this delegation live" is asked inside predicates that already
   * run in Postgres, and a date computed in the API's timezone would hand an
   * IST organisation the wrong day for five and a half hours of every evening.
   */
  private orgToday(): SQL {
    return sql`(now() AT TIME ZONE (
      SELECT ${organizations.timezone} FROM ${organizations}
       WHERE ${organizations.id} = ${this.ctx.orgId}
    ))::date`;
  }

  /**
   * The approvers who have delegated to this user, live today (REQ-I-04).
   *
   * A subquery rather than a loaded list: it is used inside `EXISTS` clauses on
   * the inbox query, and materialising it would mean a round trip before every
   * list request to answer a question Postgres can answer in the same plan.
   */
  private delegatorIds(actorUserId: string): SQL {
    return sql`(
      SELECT ${approvalDelegations.fromUserId} FROM ${approvalDelegations}
       WHERE ${approvalDelegations.orgId} = ${this.ctx.orgId}
         AND ${approvalDelegations.toUserId} = ${actorUserId}
         AND ${approvalDelegations.deletedAt} IS NULL
         AND ${delegationLiveOn(this.orgToday())}
    )`;
  }

  /** Rows that were ever routed to this user, directly or by delegation. */
  private routedTo(actorUserId: string): SQL {
    return sql`EXISTS (
      SELECT 1 FROM ${approvalSteps}
       WHERE ${approvalSteps.approvalRequestId} = ${approvalRequests.id}
         AND ${approvalSteps.orgId} = ${this.ctx.orgId}
         AND ${approvalSteps.deletedAt} IS NULL
         AND (
           ${approvalSteps.approverUserId} = ${actorUserId}
           OR ${approvalSteps.approverUserId} IN ${this.delegatorIds(actorUserId)}
         )
    )`;
  }

  /**
   * What this caller may see, by view.
   *
   * `inbox` and `raised` carry no scope predicate on purpose -- both are
   * defined by the caller's own identity, so widening them with a permission
   * breadth would show an HR user their whole organisation under the word
   * "inbox". `all` is the only view a permission widens, and it still starts
   * from the two personal branches so a requester with no keys at all can
   * always see their own request.
   */
  private visibility(filters: ApprovalListFilters): SQL {
    const raisedByMe = eq(approvalRequests.requesterUserId, filters.actorUserId);

    if (filters.view === 'raised') return raisedByMe;
    if (filters.view === 'inbox') return this.routedTo(filters.actorUserId);

    return sql`(${raisedByMe} OR ${this.routedTo(filters.actorUserId)} OR ${filters.scope})`;
  }

  private filterPredicate(filters: ApprovalListFilters): SQL | undefined {
    const parts: SQL[] = [this.visibility(filters)];
    if (filters.type !== undefined) parts.push(eq(approvalRequests.type, filters.type));
    if (filters.status !== undefined) parts.push(eq(approvalRequests.status, filters.status));
    if (filters.subjectType !== undefined) {
      parts.push(eq(approvalRequests.subjectType, filters.subjectType));
    }
    return and(...parts);
  }

  /**
   * The requester joins. Every statement that filters on visibility carries
   * them, and that is not a convenience: `ScopeService` writes its predicate
   * against `"requester_user"."employee_id"`, so a visibility filter without
   * this join fails at Postgres with "missing FROM-clause entry". The two
   * builders below are separate because Drizzle's `select` shape is part of
   * the query type and cannot be added afterwards.
   */
  private requesterJoin(): SQL | undefined {
    return and(
      eq(requesterUser.id, approvalRequests.requesterUserId),
      eq(requesterUser.orgId, this.ctx.orgId),
    );
  }

  private requesterEmployeeJoin(): SQL | undefined {
    return and(
      eq(requesterEmployee.id, requesterUser.employeeId),
      eq(requesterEmployee.orgId, this.ctx.orgId),
      isNull(requesterEmployee.deletedAt),
    );
  }

  private summarySelect() {
    return this.db
      .select({
        id: approvalRequests.id,
        type: approvalRequests.type,
        requesterUserId: approvalRequests.requesterUserId,
        requesterFirstName: requesterEmployee.firstName,
        requesterLastName: requesterEmployee.lastName,
        requesterEmail: requesterUser.email,
        subject: approvalRequests.subjectSummary,
        submittedAt: approvalRequests.createdAt,
        currentStep: approvalRequests.currentStep,
        status: approvalRequests.status,
      })
      .from(approvalRequests)
      // Inner: `requester_user_id` is NOT NULL and RESTRICT, so the row always
      // exists. An outer join here would invite a nameless requester into the
      // inbox the first time that assumption is broken by a repair script.
      .innerJoin(requesterUser, this.requesterJoin())
      // Left: an account may have no employee record (REQ-B-02), and a
      // soft-deleted employee must not remove the request from the trail.
      .leftJoin(requesterEmployee, this.requesterEmployeeJoin());
  }

  private countingSelect() {
    return this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(approvalRequests)
      .innerJoin(requesterUser, this.requesterJoin())
      .leftJoin(requesterEmployee, this.requesterEmployeeJoin());
  }

  async list(
    filters: ApprovalListFilters,
  ): Promise<{ rows: ApprovalRequestSummary[]; total: number }> {
    const where = this.scoped(this.filterPredicate(filters));

    const rows = await this.summarySelect()
      .where(where)
      // Newest first. The id tiebreak is not decoration: two requests raised in
      // the same millisecond can otherwise come back in a different order on
      // two requests, so one appears on page one and again on page two while
      // another never appears at all.
      .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
      .limit(filters.limit)
      .offset(filters.offset);

    // A second statement rather than `count(*) OVER ()`: a window function
    // returns no row at all for an empty page, and "no rows" and "total zero"
    // are different answers.
    const totals = await this.countingSelect().where(where);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        type: row.type,
        requester: {
          id: row.requesterUserId,
          name: nameOf(row.requesterFirstName, row.requesterLastName, row.requesterEmail),
        },
        subject: row.subject,
        submittedAt: row.submittedAt.toISOString(),
        currentStep: row.currentStep,
        status: row.status,
      })),
      total: totals[0]?.value ?? 0,
    };
  }

  /** One request, with its requester resolved. Org-scoped by the base class. */
  async summary(id: string): Promise<ApprovalRequestSummary | null> {
    const rows = await this.summarySelect()
      .where(this.scoped(eq(approvalRequests.id, id)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      type: row.type,
      requester: {
        id: row.requesterUserId,
        name: nameOf(row.requesterFirstName, row.requesterLastName, row.requesterEmail),
      },
      subject: row.subject,
      submittedAt: row.submittedAt.toISOString(),
      currentStep: row.currentStep,
      status: row.status,
    };
  }

  /** May this caller read this request at all? Answered as a count, not a fetch. */
  async isVisible(id: string, filters: ApprovalListFilters): Promise<boolean> {
    const rows = await this.countingSelect().where(
      this.scoped(eq(approvalRequests.id, id), this.visibility(filters)),
    );
    return (rows[0]?.value ?? 0) > 0;
  }

  async findRow(id: string): Promise<ApprovalRequestRow | null> {
    const rows = await this.db
      .select({
        id: approvalRequests.id,
        type: approvalRequests.type,
        requesterUserId: approvalRequests.requesterUserId,
        subjectType: approvalRequests.subjectType,
        subjectId: approvalRequests.subjectId,
        subjectSummary: approvalRequests.subjectSummary,
        currentStep: approvalRequests.currentStep,
        status: approvalRequests.status,
        currentStepStartedAt: approvalRequests.currentStepStartedAt,
        escalateAfterDays: approvalRequests.escalateAfterDays,
        escalatedAt: approvalRequests.escalatedAt,
        createdAt: approvalRequests.createdAt,
      })
      .from(approvalRequests)
      .where(this.scoped(eq(approvalRequests.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** REQ-I-01: the framework's own lookup for "does this subject have one". */
  async findBySubject(
    subjectType: string,
    subjectId: string,
  ): Promise<ApprovalRequestRow | null> {
    const rows = await this.db
      .select({
        id: approvalRequests.id,
        type: approvalRequests.type,
        requesterUserId: approvalRequests.requesterUserId,
        subjectType: approvalRequests.subjectType,
        subjectId: approvalRequests.subjectId,
        subjectSummary: approvalRequests.subjectSummary,
        currentStep: approvalRequests.currentStep,
        status: approvalRequests.status,
        currentStepStartedAt: approvalRequests.currentStepStartedAt,
        escalateAfterDays: approvalRequests.escalateAfterDays,
        escalatedAt: approvalRequests.escalatedAt,
        createdAt: approvalRequests.createdAt,
      })
      .from(approvalRequests)
      .where(
        this.scoped(
          eq(approvalRequests.subjectType, subjectType),
          eq(approvalRequests.subjectId, subjectId),
        ),
      )
      .orderBy(desc(approvalRequests.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Moves the request to `nextStep`, restating the step it is moving *from* in
   * the predicate.
   *
   * That restatement is a compare-and-swap, and it is what makes two
   * simultaneous approvals safe without a transaction-level lock: the second
   * update matches no row, returns null, and the caller reports "already
   * decided" rather than advancing the request twice.
   */
  async advance(
    id: string,
    fromStep: number,
    nextStep: number,
    status: ApprovalStatus,
    at: Date,
  ): Promise<ApprovalRequestRow | null> {
    const rows = await this.db
      .update(approvalRequests)
      .set({
        currentStep: nextStep,
        status,
        currentStepStartedAt: at,
        ...(status === 'ESCALATED' ? { escalatedAt: at } : {}),
        updatedAt: at,
        updatedBy: this.ctx.actorUserId,
      })
      .where(
        this.scoped(
          eq(approvalRequests.id, id),
          eq(approvalRequests.currentStep, fromStep),
          sql`${approvalRequests.status} IN ('PENDING', 'ESCALATED')`,
        ),
      )
      .returning({
        id: approvalRequests.id,
        type: approvalRequests.type,
        requesterUserId: approvalRequests.requesterUserId,
        subjectType: approvalRequests.subjectType,
        subjectId: approvalRequests.subjectId,
        subjectSummary: approvalRequests.subjectSummary,
        currentStep: approvalRequests.currentStep,
        status: approvalRequests.status,
        currentStepStartedAt: approvalRequests.currentStepStartedAt,
        escalateAfterDays: approvalRequests.escalateAfterDays,
        escalatedAt: approvalRequests.escalatedAt,
        createdAt: approvalRequests.createdAt,
      });
    return rows[0] ?? null;
  }
}

export class ApprovalStepRepository extends ScopedRepository<typeof approvalSteps> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, approvalSteps, ctx);
  }

  /** The whole route, in order. REQ-I-02's history, unfiltered. */
  async forRequest(requestId: string): Promise<ApprovalStepRow[]> {
    return this.db
      .select({
        id: approvalSteps.id,
        stepNo: approvalSteps.stepNo,
        approverUserId: approvalSteps.approverUserId,
        action: approvalSteps.action,
      })
      .from(approvalSteps)
      .where(this.scoped(eq(approvalSteps.approvalRequestId, requestId)))
      .orderBy(asc(approvalSteps.stepNo));
  }

  async at(requestId: string, stepNo: number): Promise<ApprovalStepRow | null> {
    const rows = await this.db
      .select({
        id: approvalSteps.id,
        stepNo: approvalSteps.stepNo,
        approverUserId: approvalSteps.approverUserId,
        action: approvalSteps.action,
      })
      .from(approvalSteps)
      .where(
        this.scoped(
          eq(approvalSteps.approvalRequestId, requestId),
          eq(approvalSteps.stepNo, stepNo),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** The history with every identity resolved, for the detail view. */
  async history(requestId: string): Promise<ApprovalStepRecord[]> {
    const orgId = this.ctx.orgId;

    const rows = await this.db
      .select({
        id: approvalSteps.id,
        stepNo: approvalSteps.stepNo,
        approverUserId: approvalSteps.approverUserId,
        approverFirstName: approverEmployee.firstName,
        approverLastName: approverEmployee.lastName,
        approverEmail: approverUser.email,
        actedById: approvalSteps.actedByUserId,
        actedByFirstName: actorEmployee.firstName,
        actedByLastName: actorEmployee.lastName,
        actedByEmail: actorUser.email,
        delegatedFromId: approvalSteps.delegatedFromUserId,
        delegatedFromFirstName: delegatorEmployee.firstName,
        delegatedFromLastName: delegatorEmployee.lastName,
        delegatedFromEmail: delegatorUser.email,
        action: approvalSteps.action,
        reason: approvalSteps.reason,
        actedAt: approvalSteps.actedAt,
      })
      .from(approvalSteps)
      .innerJoin(
        approverUser,
        and(eq(approverUser.id, approvalSteps.approverUserId), eq(approverUser.orgId, orgId)),
      )
      .leftJoin(
        approverEmployee,
        and(
          eq(approverEmployee.id, approverUser.employeeId),
          eq(approverEmployee.orgId, orgId),
          isNull(approverEmployee.deletedAt),
        ),
      )
      .leftJoin(
        actorUser,
        and(eq(actorUser.id, approvalSteps.actedByUserId), eq(actorUser.orgId, orgId)),
      )
      .leftJoin(
        actorEmployee,
        and(
          eq(actorEmployee.id, actorUser.employeeId),
          eq(actorEmployee.orgId, orgId),
          isNull(actorEmployee.deletedAt),
        ),
      )
      .leftJoin(
        delegatorUser,
        and(
          eq(delegatorUser.id, approvalSteps.delegatedFromUserId),
          eq(delegatorUser.orgId, orgId),
        ),
      )
      .leftJoin(
        delegatorEmployee,
        and(
          eq(delegatorEmployee.id, delegatorUser.employeeId),
          eq(delegatorEmployee.orgId, orgId),
          isNull(delegatorEmployee.deletedAt),
        ),
      )
      .where(this.scoped(eq(approvalSteps.approvalRequestId, requestId)))
      .orderBy(asc(approvalSteps.stepNo));

    return rows.map((row) => ({
      id: row.id,
      stepNo: row.stepNo,
      approver: {
        id: row.approverUserId,
        name: nameOf(row.approverFirstName, row.approverLastName, row.approverEmail),
      },
      actedBy: refOf(row.actedById, row.actedByFirstName, row.actedByLastName, row.actedByEmail),
      delegatedFrom: refOf(
        row.delegatedFromId,
        row.delegatedFromFirstName,
        row.delegatedFromLastName,
        row.delegatedFromEmail,
      ),
      action: row.action,
      reason: row.reason,
      actedAt: row.actedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Records the decision on a step, refusing a step that already carries one.
   *
   * `action IS NULL` in the predicate is the same compare-and-swap the request
   * update uses: two approvers acting at once cannot both write a decision
   * onto one step, and the loser gets null rather than an overwritten trail.
   */
  async recordAction(input: {
    readonly stepId: string;
    readonly action: ApprovalAction;
    readonly actedByUserId: string | null;
    readonly delegatedFromUserId: string | null;
    readonly reason: string | null;
    readonly at: Date;
  }): Promise<boolean> {
    const rows = await this.db
      .update(approvalSteps)
      .set({
        action: input.action,
        actedByUserId: input.actedByUserId,
        delegatedFromUserId: input.delegatedFromUserId,
        reason: input.reason,
        actedAt: input.at,
        updatedAt: input.at,
        updatedBy: this.ctx.actorUserId,
      })
      .where(this.scoped(eq(approvalSteps.id, input.stepId), isNull(approvalSteps.action)))
      .returning({ id: approvalSteps.id });
    return rows.length > 0;
  }
}

export interface DelegationRow {
  readonly id: string;
  readonly fromUserId: string;
  readonly fromFirstName: string | null;
  readonly fromLastName: string | null;
  readonly fromEmail: string;
  readonly toUserId: string;
  readonly toFirstName: string | null;
  readonly toLastName: string | null;
  readonly toEmail: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly reason: string | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export class ApprovalDelegationRepository extends ScopedRepository<typeof approvalDelegations> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, approvalDelegations, ctx);
  }

  private joined() {
    const orgId = this.ctx.orgId;
    return this.db
      .select({
        id: approvalDelegations.id,
        fromUserId: approvalDelegations.fromUserId,
        fromFirstName: fromEmployee.firstName,
        fromLastName: fromEmployee.lastName,
        fromEmail: fromUser.email,
        toUserId: approvalDelegations.toUserId,
        toFirstName: toEmployee.firstName,
        toLastName: toEmployee.lastName,
        toEmail: toUser.email,
        fromDate: approvalDelegations.fromDate,
        toDate: approvalDelegations.toDate,
        reason: approvalDelegations.reason,
        revokedAt: approvalDelegations.revokedAt,
        createdAt: approvalDelegations.createdAt,
      })
      .from(approvalDelegations)
      .innerJoin(
        fromUser,
        and(eq(fromUser.id, approvalDelegations.fromUserId), eq(fromUser.orgId, orgId)),
      )
      .leftJoin(
        fromEmployee,
        and(
          eq(fromEmployee.id, fromUser.employeeId),
          eq(fromEmployee.orgId, orgId),
          isNull(fromEmployee.deletedAt),
        ),
      )
      .innerJoin(
        toUser,
        and(eq(toUser.id, approvalDelegations.toUserId), eq(toUser.orgId, orgId)),
      )
      .leftJoin(
        toEmployee,
        and(
          eq(toEmployee.id, toUser.employeeId),
          eq(toEmployee.orgId, orgId),
          isNull(toEmployee.deletedAt),
        ),
      );
  }

  /** Both directions: what the caller granted, and what was granted to them. */
  async involving(userId: string): Promise<DelegationRow[]> {
    return this.joined()
      .where(
        this.scoped(
          sql`(${approvalDelegations.fromUserId} = ${userId} OR ${approvalDelegations.toUserId} = ${userId})`,
        ),
      )
      .orderBy(desc(approvalDelegations.fromDate), desc(approvalDelegations.id));
  }

  async findJoined(id: string): Promise<DelegationRow | null> {
    const rows = await this.joined()
      .where(this.scoped(eq(approvalDelegations.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(approvalDelegations)
      .set({ revokedAt: at, updatedAt: at, updatedBy: this.ctx.actorUserId })
      .where(this.scoped(eq(approvalDelegations.id, id), isNull(approvalDelegations.revokedAt)))
      .returning({ id: approvalDelegations.id });
    return rows.length > 0;
  }
}

export function toDelegation(row: DelegationRow) {
  return {
    id: row.id,
    from: { id: row.fromUserId, name: nameOf(row.fromFirstName, row.fromLastName, row.fromEmail) },
    to: { id: row.toUserId, name: nameOf(row.toFirstName, row.toLastName, row.toEmail) },
    fromDate: row.fromDate,
    toDate: row.toDate,
    reason: row.reason,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface StaleApprovalRow {
  readonly id: string;
  readonly orgId: string;
  readonly requesterUserId: string;
  readonly currentStep: number;
  readonly currentStepStartedAt: Date;
  readonly escalateAfterDays: number;
}

/**
 * The escalation sweep's reader, and the one repository here that is not
 * org-scoped.
 *
 * `ScopedRepository` exists so no request can read across organisations, and
 * that is exactly right for every path a person takes. The escalation job is
 * not a person: it runs once, for every organisation, and constructing one
 * scoped repository per org would mean first querying which organisations
 * exist and then issuing a query each -- turning one indexed sweep into N.
 * It reads ids only; every write it then makes goes through the scoped
 * repositories above, with the org id the sweep returned.
 */
export class ApprovalSweepRepository {
  constructor(private readonly db: Database) {}

  /**
   * Requests whose current step has gone untouched past its own threshold.
   *
   * The staleness test is in SQL rather than in the handler because the
   * alternative is loading every open request in the product to filter four of
   * them in JavaScript. `approval_requests_escalation_idx` covers the two
   * leading predicates.
   */
  async stale(now: Date, limit: number): Promise<StaleApprovalRow[]> {
    return this.db
      .select({
        id: approvalRequests.id,
        orgId: approvalRequests.orgId,
        requesterUserId: approvalRequests.requesterUserId,
        currentStep: approvalRequests.currentStep,
        currentStepStartedAt: approvalRequests.currentStepStartedAt,
        escalateAfterDays: approvalRequests.escalateAfterDays,
      })
      .from(approvalRequests)
      .where(
        and(
          isNull(approvalRequests.deletedAt),
          sql`${approvalRequests.status} IN ('PENDING', 'ESCALATED')`,
          sql`${approvalRequests.escalateAfterDays} > 0`,
          // The cast is load-bearing: a bare parameter next to `make_interval`
          // gives Postgres nothing to infer from, and it resolves the
          // subtraction as `unknown - interval` and refuses the comparison.
          sql`${approvalRequests.currentStepStartedAt} <= ${now}::timestamptz - make_interval(days => ${approvalRequests.escalateAfterDays})`,
        ),
      )
      .orderBy(asc(approvalRequests.currentStepStartedAt))
      .limit(limit);
  }
}
