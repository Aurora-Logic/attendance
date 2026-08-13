import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { leaveYearBounds, leaveYearOf, roundLeaveDays } from '@vyuha/shared';

import { AuditService } from '../../../platform/audit/audit.service.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import {
  JobRegistry,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '../../../platform/jobs/job-handler.js';
import type { JobPayloads } from '../../../platform/jobs/queue.registry.js';
import { NOTIFICATION_EVENTS } from '../../../platform/notifications/notification-events.js';
import { NotificationDispatcher } from '../../../platform/notifications/notification.dispatcher.js';
import { addDays } from '../day-engine/calendar-date.js';
import { accrualForPeriod, accrualPeriodFor, carryForward } from './leave-accrual.js';
import { projectLedger } from './leave-balance.js';
import { LeaveRepository, type LedgerAppend } from './leave.repository.js';
import { LeaveService } from './leave.service.js';

/**
 * The three scheduled jobs the leave slice owns (REQ-G-05, REQ-G-01, REQ-G-11).
 *
 * Registered the way `PurgeExpiredFilesHandler` is: each handler registers
 * itself with `JobRegistry` during `onModuleInit`, so `JobsModule` never has to
 * import the module that provides it and the dependency arrow points one way.
 *
 * **All three are idempotent, and none of them uses a "has this already run"
 * flag to be.** `leave_ledger` is append-only, so a job that posts twice
 * cannot be undone -- the correction would be a third row, and the balance
 * would have been wrong for whoever read it in between. Idempotency is
 * therefore a property of the writes:
 *
 *   - accrual and carry forward carry `period_key`, and migration 0009 makes
 *     it unique per movement, so a second post is refused by the database.
 *   - the comp-off sweep selects on `lapsed_at IS NULL` and stamps it in the
 *     same transaction as the LAPSE rows, so a run interrupted halfway leaves
 *     exactly the unfinished credits selectable and nothing half-posted.
 *
 * A job also runs for every organisation, not for one caller's: it has no
 * principal, so its `OrgContext` carries a null actor -- which `columns.ts`
 * anticipates, and which `audit_logs` records as a system action.
 */

/** REQ-G-11: "notifies ... at 7 days and again at 2 days before a credit lapses". */
const COMP_OFF_WARNING_THRESHOLDS: readonly number[] = [7, 2];

function previousMonthOf(instant: Date): string {
  const year = instant.getUTCFullYear();
  const month = instant.getUTCMonth(); // 0-indexed, so this is already "last month".
  const rolled = month === 0 ? { y: year - 1, m: 12 } : { y: year, m: month };
  return `${String(rolled.y)}-${String(rolled.m).padStart(2, '0')}`;
}

function parseMonthKey(key: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/u.exec(key);
  if (match === null) throw new RangeError(`Expected a YYYY-MM month key, received "${key}".`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new RangeError(`"${key}" is not a real month.`);
  return { year, month };
}

/**
 * REQ-G-05. Posts one month's accrual for every employee, every active type
 * and every organisation.
 */
@Injectable()
export class AccrueLeaveHandler implements JobHandler<'accrue-leave'>, OnModuleInit {
  readonly jobName = 'accrue-leave' as const;
  private readonly logger = new Logger(AccrueLeaveHandler.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly leave: LeaveService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(payload: JobPayloads['accrue-leave'], _context: JobContext): Promise<JobResult> {
    const monthKey = payload.month ?? previousMonthOf(new Date(payload.requestedAt));
    const { year, month } = parseMonthKey(monthKey);

    let posted = 0;
    let skipped = 0;
    let employees = 0;

    for (const orgId of await LeaveRepository.listOrganisationIds(this.db)) {
      const repository = this.leave.repositoryFor(orgId, null);
      const startMonth = await this.leave.leaveYearStartMonth(repository);
      const leaveYear = leaveYearOf(`${monthKey}-01`, startMonth);

      // The offset of this calendar month within the org's own leave year.
      const offset = (year * 12 + month - 1) - (leaveYear * 12 + startMonth - 1);
      if (offset < 0 || offset > 11) {
        // Cannot happen for a month inside the year `leaveYearOf` just named,
        // but a settings change mid-run would make it possible and a silently
        // wrong leave year is the worst outcome available here.
        throw new Error(
          `Month ${monthKey} does not fall in leave year ${String(leaveYear)} for organisation ${orgId}.`,
        );
      }
      const period = accrualPeriodFor(leaveYear, startMonth, offset);

      const [types, staff] = await Promise.all([
        repository.listLeaveTypes({ active: true, limit: 200, offset: 0 }),
        repository.listAccruableEmployees(period.start, period.end),
      ]);

      const accruingTypes = types.rows.filter(
        (type) => type.accrualMethod !== 'NONE' && type.annualEntitlement > 0,
      );
      if (accruingTypes.length === 0 || staff.length === 0) continue;

      const entries: LedgerAppend[] = [];
      const touched: { employeeId: string; leaveTypeId: string }[] = [];

      for (const employee of staff) {
        employees += 1;
        for (const type of accruingTypes) {
          if (
            type.applicableEmploymentTypes.length > 0 &&
            !type.applicableEmploymentTypes.includes(employee.employmentType)
          ) {
            continue;
          }

          const days = accrualForPeriod({
            accrualMethod: type.accrualMethod,
            annualEntitlement: type.annualEntitlement,
            employee,
            period,
            leaveYearStartMonth: startMonth,
          });
          // A zero-day row is noise in a ledger whose whole point is that
          // every row means something.
          if (days <= 0) continue;

          entries.push({
            employeeId: employee.id,
            leaveTypeId: type.id,
            leaveYear,
            movementType: 'ACCRUAL',
            days,
            periodKey: period.periodKey,
            note: `Accrual for ${period.periodKey}`,
          });
          touched.push({ employeeId: employee.id, leaveTypeId: type.id });
        }
      }

      const inserted = await repository.appendLedger(entries);
      posted += inserted;
      skipped += entries.length - inserted;

      // Only recompute what moved. A no-op re-run touches nothing.
      if (inserted > 0) {
        for (const key of dedupe(touched)) {
          await this.leave.recomputeBalance(
            repository,
            key.employeeId,
            key.leaveTypeId,
            leaveYear,
          );
        }
      }
    }

    this.logger.log({ msg: 'Leave accrual complete', monthKey, posted, skipped });
    return { month: monthKey, employees, posted, alreadyPosted: skipped };
  }
}

/**
 * REQ-G-01's carry forward. Runs daily and does nothing on a day that opens
 * nobody's leave year.
 */
@Injectable()
export class CarryForwardLeaveHandler
  implements JobHandler<'carry-forward-leave'>, OnModuleInit
{
  readonly jobName = 'carry-forward-leave' as const;
  private readonly logger = new Logger(CarryForwardLeaveHandler.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly leave: LeaveService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(payload: JobPayloads['carry-forward-leave'], _context: JobContext): Promise<JobResult> {
    const today = new Date(payload.requestedAt).toISOString().slice(0, 10);

    let organisations = 0;
    let carriedRows = 0;
    let lapsedRows = 0;

    for (const orgId of await LeaveRepository.listOrganisationIds(this.db)) {
      const repository = this.leave.repositoryFor(orgId, null);
      const startMonth = await this.leave.leaveYearStartMonth(repository);

      const openingYear = leaveYearOf(today, startMonth);
      const bounds = leaveYearBounds(openingYear, startMonth);
      // Today opens a leave year only if it is that year's first day.
      if (today !== bounds.start) continue;

      organisations += 1;
      const closingYear = openingYear - 1;

      const types = await repository.listLeaveTypes({ limit: 200, offset: 0 });
      const typeById = new Map(types.rows.map((type) => [type.id, type]));

      const entries: LedgerAppend[] = [];
      const touched: { employeeId: string; leaveTypeId: string; leaveYear: number }[] = [];

      for (const key of await repository.listBalanceKeys(closingYear)) {
        const type = typeById.get(key.leaveTypeId);
        if (type === undefined) continue;

        const ledger = await repository.readLedger(key.employeeId, closingYear, key.leaveTypeId);
        const closing = projectLedger(ledger).closing;

        const outcome = carryForward({
          carryForwardAllowed: type.carryForwardAllowed,
          carryForwardCap: type.carryForwardCap,
          closingBalance: closing,
        });

        const periodKey = `${String(closingYear)}->${String(openingYear)}`;

        if (outcome.lapsed > 0) {
          // Posted into the *closing* year, so that year's ledger still adds
          // up to zero afterwards -- a lapse that only appeared in the new
          // year would leave the old one claiming a balance nobody has.
          entries.push({
            employeeId: key.employeeId,
            leaveTypeId: key.leaveTypeId,
            leaveYear: closingYear,
            movementType: 'LAPSE',
            days: -outcome.lapsed,
            periodKey,
            note: `Lapsed at the close of leave year ${String(closingYear)}`,
          });
          touched.push({ ...key, leaveYear: closingYear });
        }

        if (outcome.carried !== 0) {
          // The closing year gives it up and the opening year receives it, so
          // neither year invents days. The pair is what makes the two ledgers
          // reconcile against each other.
          entries.push({
            employeeId: key.employeeId,
            leaveTypeId: key.leaveTypeId,
            leaveYear: closingYear,
            movementType: 'CARRY_FORWARD',
            days: -outcome.carried,
            periodKey,
            note: `Carried into leave year ${String(openingYear)}`,
          });
          entries.push({
            employeeId: key.employeeId,
            leaveTypeId: key.leaveTypeId,
            leaveYear: openingYear,
            movementType: 'CARRY_FORWARD',
            days: outcome.carried,
            periodKey,
            note: `Carried from leave year ${String(closingYear)}`,
          });
          touched.push({ ...key, leaveYear: closingYear }, { ...key, leaveYear: openingYear });
          carriedRows += 1;
        }

        if (outcome.lapsed > 0) lapsedRows += 1;
      }

      const inserted = await repository.appendLedger(entries);
      if (inserted > 0) {
        for (const key of dedupeWithYear(touched)) {
          await this.leave.recomputeBalance(
            repository,
            key.employeeId,
            key.leaveTypeId,
            key.leaveYear,
          );
        }
      }
    }

    this.logger.log({ msg: 'Leave carry forward complete', today, organisations, carriedRows });
    return { date: today, organisations, carried: carriedRows, lapsed: lapsedRows };
  }
}

/**
 * REQ-G-11. Lapses a comp-off credit that has run out, and warns before it
 * does, "because 30 days is short".
 */
@Injectable()
export class ExpireCompOffHandler implements JobHandler<'expire-comp-off'>, OnModuleInit {
  readonly jobName = 'expire-comp-off' as const;
  private readonly logger = new Logger(ExpireCompOffHandler.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly leave: LeaveService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatcher,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(payload: JobPayloads['expire-comp-off'], _context: JobContext): Promise<JobResult> {
    const now = new Date(payload.requestedAt);
    const today = now.toISOString().slice(0, 10);
    const furthestWarning = Math.max(...COMP_OFF_WARNING_THRESHOLDS);

    let lapsed = 0;
    let warned = 0;

    for (const orgId of await LeaveRepository.listOrganisationIds(this.db)) {
      const repository = this.leave.repositoryFor(orgId, null);
      const startMonth = await this.leave.leaveYearStartMonth(repository);

      // One scan covers both jobs: everything expiring from today back (due)
      // and everything expiring inside the warning horizon (not due yet).
      const horizon = addDays(today, furthestWarning);
      const candidates = await repository.findCompOffExpiringOnOrBefore(horizon);

      const due = candidates.filter((credit) => credit.expiresOn <= today);
      const upcoming = candidates.filter((credit) => credit.expiresOn > today);

      if (due.length > 0) {
        const entries: LedgerAppend[] = due.map((credit) => ({
          employeeId: credit.employeeId,
          leaveTypeId: credit.leaveTypeId,
          leaveYear: leaveYearOf(credit.earnedForDate, startMonth),
          movementType: 'LAPSE' as const,
          days: -roundLeaveDays(credit.days),
          referenceType: 'comp_off_credit',
          referenceId: credit.id,
          note: `Comp-off earned for ${credit.earnedForDate} expired on ${credit.expiresOn}`,
        }));

        // The LAPSE rows and the `lapsed_at` stamps are one fact. Written in
        // two commits, an interruption between them either loses the days
        // from the balance with no row explaining it, or leaves the credits
        // selectable so the next run posts the LAPSE a second time -- and
        // the ledger cannot take one back.
        const inserted = await repository.transaction(async (tx) => {
          const count = await tx.appendLedger(entries);
          await tx.markCompOffLapsed(
            due.map((credit) => credit.id),
            now,
          );
          for (const key of dedupeWithYear(
            due.map((credit) => ({
              employeeId: credit.employeeId,
              leaveTypeId: credit.leaveTypeId,
              leaveYear: leaveYearOf(credit.earnedForDate, startMonth),
            })),
          )) {
            await this.leave.recomputeBalance(tx, key.employeeId, key.leaveTypeId, key.leaveYear);
          }
          return count;
        });

        lapsed += inserted;

        // A job has no request to enrich, so it writes its own audit row --
        // see `AuditContext.record`, which deliberately does nothing outside
        // a request context.
        await this.audit.write({
          orgId,
          actorUserId: null,
          action: 'comp_off.lapsed',
          entityType: 'comp_off_credit',
          after: { count: due.length, asOf: today },
        });
      }

      for (const credit of upcoming) {
        const daysRemaining = daysBetween(today, credit.expiresOn);
        // The smallest threshold this credit has now crossed, so a job that
        // missed a day still sends the more urgent warning rather than none.
        const threshold = COMP_OFF_WARNING_THRESHOLDS.filter(
          (value) => daysRemaining <= value,
        ).sort((a, b) => a - b)[0];
        if (threshold === undefined) continue;
        // Already warned at this threshold or a nearer one.
        if (credit.expiryWarnedDays !== null && credit.expiryWarnedDays <= threshold) continue;

        await this.notifications.emit({
          orgId,
          type: NOTIFICATION_EVENTS.LEAVE_COMP_OFF_EXPIRING,
          audience: { kind: 'employees', employeeIds: [credit.employeeId] },
          payload: {
            days: credit.days,
            earnedForDate: credit.earnedForDate,
            expiresOn: credit.expiresOn,
            daysRemaining,
          },
          // A sweep that runs twice in a day must not send it twice.
          idempotencyKey: `comp-off-expiring.${credit.id}.${String(threshold)}`,
        });

        await repository.recordCompOffWarning(credit.id, threshold, now);
        warned += 1;
      }
    }

    this.logger.log({ msg: 'Comp-off expiry sweep complete', today, lapsed, warned });
    return { date: today, lapsed, warned };
  }
}

function daysBetween(from: string, to: string): number {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((end - start) / 86_400_000);
}

function dedupe(
  keys: readonly { employeeId: string; leaveTypeId: string }[],
): { employeeId: string; leaveTypeId: string }[] {
  const seen = new Map<string, { employeeId: string; leaveTypeId: string }>();
  for (const key of keys) seen.set(`${key.employeeId}|${key.leaveTypeId}`, key);
  return [...seen.values()];
}

function dedupeWithYear(
  keys: readonly { employeeId: string; leaveTypeId: string; leaveYear: number }[],
): { employeeId: string; leaveTypeId: string; leaveYear: number }[] {
  const seen = new Map<string, { employeeId: string; leaveTypeId: string; leaveYear: number }>();
  for (const key of keys) {
    seen.set(`${key.employeeId}|${key.leaveTypeId}|${String(key.leaveYear)}`, key);
  }
  return [...seen.values()];
}
