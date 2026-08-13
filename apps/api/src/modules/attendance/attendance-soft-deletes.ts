import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@vyuha/shared';
import { inArray, isNull, or, sql } from 'drizzle-orm';

import { employees, locations } from '../../platform/db/schema/index.js';
import { SoftDeletableRegistry } from '../../platform/recycle-bin/soft-deletable.js';
import { holidayCalendars, leaveRequests, leaveTypes, shiftAssignments, shifts } from './schema/index.js';

/**
 * REQ-M-04 delete and restore for the three masters this module owns.
 *
 * Registration rather than a shared module reaching in: `platform/` may never
 * import `modules/` (technical design §1), so the platform holds the mechanism
 * and attendance says which of its tables it applies to. Same shape as
 * `JobRegistry` — the arrow only ever points at the platform.
 *
 * What blocks a delete is a live row that would keep *depending* on the record,
 * not a historical row that merely mentions it. `attendance_days.shift_id`
 * points at whichever shift was worked, and refusing to retire a shift because
 * somebody worked it in March would mean no shift could ever be retired. A
 * future roster assignment is a different matter: the day engine resolves it
 * with `deleted_at IS NULL`, so deleting the shift underneath it turns every
 * covered day into the "no shift for this date" configuration error.
 */
@Injectable()
export class AttendanceSoftDeletes implements OnModuleInit {
  constructor(private readonly registry: SoftDeletableRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      entityType: 'shift',
      label: 'Shift',
      table: shifts,
      nameColumn: shifts.name,
      codeColumn: shifts.code,
      uniqueColumn: shifts.code,
      managePermission: PERMISSIONS.SHIFT_MANAGE,
      references: [
        {
          label: 'employees using it as their default shift',
          table: employees,
          column: employees.defaultShiftId,
          labelColumn: employees.employeeCode,
        },
        {
          // Only assignments that still cover a future date. One that ended
          // last year is history and must not hold a shift hostage.
          label: 'current or future roster assignments',
          table: shiftAssignments,
          column: shiftAssignments.shiftId,
          labelColumn: shiftAssignments.effectiveFrom,
          extraPredicate: or(
            isNull(shiftAssignments.effectiveTo),
            sql`${shiftAssignments.effectiveTo} >= current_date`,
          ),
        },
      ],
    });

    this.registry.register({
      entityType: 'leaveType',
      label: 'Leave type',
      table: leaveTypes,
      nameColumn: leaveTypes.name,
      codeColumn: leaveTypes.code,
      uniqueColumn: leaveTypes.code,
      managePermission: PERMISSIONS.LEAVE_POLICY_MANAGE,
      references: [
        {
          // Pending and approved only. A rejected or cancelled request is a
          // record of something that did not happen, and REQ-G-03's balances
          // are reproducible from the ledger whatever happens to the type row.
          label: 'open or approved leave requests',
          table: leaveRequests,
          column: leaveRequests.leaveTypeId,
          labelColumn: leaveRequests.fromDate,
          extraPredicate: sql`${inArray(leaveRequests.status, ['PENDING', 'APPROVED'])} AND ${isNull(leaveRequests.cancelledAt)}`,
        },
      ],
    });

    this.registry.register({
      entityType: 'holidayCalendar',
      label: 'Holiday calendar',
      table: holidayCalendars,
      nameColumn: holidayCalendars.name,
      // A calendar is identified by name and year, not by a code.
      codeColumn: null,
      // Unique on (name, year), which is two columns: the restore relies on
      // Postgres refusing, which the service turns into the same answer.
      uniqueColumn: null,
      managePermission: PERMISSIONS.HOLIDAY_MANAGE,
      references: [
        {
          label: 'employees on this calendar',
          table: employees,
          column: employees.holidayCalendarId,
          labelColumn: employees.employeeCode,
        },
        {
          label: 'locations on this calendar',
          table: locations,
          column: locations.holidayCalendarId,
          labelColumn: locations.name,
        },
      ],
    });
  }
}
