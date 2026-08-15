import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/db.provider.js';
import { employees, organizations, users } from '../db/schema/index.js';
import type { OrgContext } from '../db/scoped-repository.js';
import type { SubjectAccessColumn } from './subject-access-writer.js';

/**
 * Everything held about one employee, gathered for REQ-M-05.
 *
 * ## Why the module tables are reached with SQL rather than a schema import
 *
 * Half of what the system holds about a person lives in `modules/attendance` --
 * days, punches, leave, regularizations, approvals. `platform/` may not import
 * `modules/` (technical design §1, enforced by `moduleBoundaries` in the ESLint
 * config), and the sanctioned inversion -- platform declares an interface, the
 * module implements it -- cannot be completed from inside platform alone: a
 * contributor registered by the attendance module has to be written there.
 *
 * So the coupling is made *data* rather than *code*. Each section below is a
 * descriptor: a title, a column list and one statement. Nothing here branches
 * on attendance behaviour, nothing imports an attendance type, and moving a
 * section into an attendance-owned contributor later is a move of one array
 * element rather than a rewrite.
 *
 * The risk this trades for is a renamed column becoming a runtime failure
 * instead of a compile error. That is met head-on in `rowsFor`: every declared
 * column must be present on the returned row or the section throws by name. A
 * column that quietly exported blanks would be the worse outcome -- a
 * compliance file is read once, by somebody who cannot tell an empty column
 * from an empty value. `employee-data-export.endpoints.test.ts` runs every
 * section against a real database, so a rename is caught by the suite.
 *
 * ## What is deliberately not exported
 *
 * Password hashes, TOTP secrets, session and refresh-token hashes, and password
 * reset tokens: credentials are not personal data a subject needs and are the
 * one category whose disclosure creates the harm the export exists to prevent.
 * Punch photo *bytes* are excluded and their file ids included, so the subject
 * knows the photographs exist and can ask for them separately.
 *
 * Soft-deleted rows are included, with the deletion timestamp as a column.
 * REQ-M-04 makes deletion soft everywhere, so a row with `deleted_at` set is
 * still data the organisation holds, and omitting it would make the export
 * quietly untrue.
 */

/** The identifiers every section query is scoped by. */
export interface SubjectIds {
  readonly orgId: string;
  readonly employeeId: string;
  /** Null for an employee with no login account (REQ-B-02). */
  readonly userId: string | null;
}

export interface SubjectSection {
  readonly key: string;
  readonly title: string;
  readonly columns: readonly SubjectAccessColumn[];
  /** Null means the section has no meaning for this subject and is skipped. */
  readonly build: (ids: SubjectIds) => SQL | null;
}

export interface SectionRows {
  readonly rows: readonly (readonly unknown[])[];
  /** True when the cap was hit and the section is not the whole story. */
  readonly truncated: boolean;
}

/**
 * Per-section row cap.
 *
 * One person's attendance is bounded by the calendar, but their audit trail is
 * not, and a subject access export must not be the thing that exhausts the API
 * process. Ten thousand rows is roughly twenty-five years of daily attendance,
 * so hitting it means the section is genuinely unusual -- and the file says so
 * rather than silently ending early.
 */
export const SUBJECT_SECTION_ROW_CAP = 10_000;

export interface SubjectIdentity {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly userId: string | null;
  readonly status: string;
}

export interface OrgProfile {
  readonly name: string;
  readonly timezone: string;
  readonly dateFormat: string;
}

/**
 * A row as the driver hands it back.
 *
 * The database is a boundary like any other, and this is the narrowest true
 * statement about what comes back from a raw statement: an object keyed by the
 * aliases the SELECT declared. The values stay `unknown` because the driver
 * decides their runtime type -- `numeric` arrives as a string, `timestamptz` as
 * a `Date`, `jsonb` as a parsed object -- and `formatSubjectCell` is written to
 * handle each without a cast.
 */
const rowSchema = z.record(z.string(), z.unknown());

export class EmployeeDataExportRepository {
  constructor(
    private readonly db: Database,
    private readonly ctx: OrgContext,
  ) {}

  async orgProfile(): Promise<OrgProfile> {
    const rows = await this.db
      .select({
        name: organizations.name,
        timezone: organizations.timezone,
        dateFormat: organizations.dateFormat,
      })
      .from(organizations)
      .where(and(eq(organizations.id, this.ctx.orgId), isNull(organizations.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Organisation ${this.ctx.orgId} was not found while preparing an export.`);
    }
    return row;
  }

  /**
   * The subject, by employee id.
   *
   * Soft-deleted employees are found on purpose: REQ-M-04 keeps the row, and
   * "everything held about this person" has to include a person the
   * organisation has retired. Org scoping is what makes another tenant's id a
   * miss rather than a leak.
   */
  async findSubject(employeeId: string): Promise<SubjectIdentity | null> {
    const rows = await this.db
      .select({
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        status: employees.status,
        userId: users.id,
      })
      .from(employees)
      .leftJoin(users, and(eq(users.employeeId, employees.id), isNull(users.deletedAt)))
      .where(and(eq(employees.orgId, this.ctx.orgId), eq(employees.id, employeeId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /** Who asked, for the header block and for the audit entry. */
  async findRequesterEmail(userId: string): Promise<string | null> {
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.orgId, this.ctx.orgId), eq(users.id, userId)))
      .limit(1);

    return rows[0]?.email ?? null;
  }

  /**
   * One section's rows, in the order its columns declare.
   *
   * The `Object.hasOwn` check is the guard the raw statements buy back: a
   * column renamed underneath this file fails the section by name instead of
   * exporting a column of blanks that nobody can distinguish from no data.
   */
  async rowsFor(section: SubjectSection, ids: SubjectIds): Promise<SectionRows> {
    const statement = section.build(ids);
    if (statement === null) return { rows: [], truncated: false };

    const result = await this.db.execute(statement);
    const parsed = z.array(rowSchema).safeParse(result.rows);
    if (!parsed.success) {
      throw new Error(
        `Section "${section.key}" returned a row the export cannot read: ${parsed.error.message}`,
      );
    }

    const rows = parsed.data.map((row) =>
      section.columns.map((column) => {
        if (!Object.hasOwn(row, column.key)) {
          throw new Error(
            `Section "${section.key}" is missing column "${column.key}". ` +
              'A table it reads has changed shape.',
          );
        }
        return row[column.key] ?? null;
      }),
    );

    return {
      rows: rows.slice(0, SUBJECT_SECTION_ROW_CAP),
      truncated: rows.length > SUBJECT_SECTION_ROW_CAP,
    };
  }
}

// ---------------------------------------------------------------- sections

const AUDIT_LIMIT = SUBJECT_SECTION_ROW_CAP + 1;

function columns(...pairs: readonly (readonly [string, string])[]): readonly SubjectAccessColumn[] {
  return pairs.map(([key, header]) => ({ key, header }));
}

/**
 * The identity and employment facts, as one row that becomes labelled pairs.
 *
 * Names rather than ids for department, designation, location and manager: the
 * subject of the export is a person, and a uuid answers nothing they would ask.
 * The uuid is kept alongside for anyone reconciling against another system.
 */
export const SUBJECT_PROFILE_SECTION: SubjectSection = {
  key: 'profile',
  title: 'Identity and employment',
  columns: columns(
    ['employeeId', 'Employee id'],
    ['employeeCode', 'Employee code'],
    ['firstName', 'First name'],
    ['lastName', 'Last name'],
    ['workEmail', 'Work email'],
    ['personalEmail', 'Personal email'],
    ['mobile', 'Mobile'],
    ['dateOfJoining', 'Date of joining'],
    ['dateOfLeaving', 'Date of leaving'],
    ['employmentType', 'Employment type'],
    ['employeeStatus', 'Employment status'],
    ['departmentName', 'Department'],
    ['designationName', 'Designation'],
    ['locationName', 'Location'],
    ['reportingManager', 'Reporting manager'],
    ['defaultShift', 'Default shift'],
    ['weeklyOffPattern', 'Weekly off pattern'],
    ['holidayCalendar', 'Holiday calendar'],
    ['isFieldStaff', 'Field staff'],
    ['tallyRef', 'TallyPrime reference'],
    ['recordCreatedAt', 'Record created'],
    ['recordUpdatedAt', 'Record last updated'],
    ['recordDeletedAt', 'Record deleted'],
    ['accountEmail', 'Sign-in email'],
    ['accountStatus', 'Account status'],
    ['lastLoginAt', 'Last sign-in'],
    ['passwordChangedAt', 'Password last changed'],
    ['accountLockedUntil', 'Account locked until'],
  ),
  build: (ids) => sql`
    SELECT
      e.id::text                      AS "employeeId",
      e.employee_code                 AS "employeeCode",
      e.first_name                    AS "firstName",
      e.last_name                     AS "lastName",
      e.work_email                    AS "workEmail",
      e.personal_email                AS "personalEmail",
      e.mobile                        AS "mobile",
      e.date_of_joining::text         AS "dateOfJoining",
      e.date_of_leaving::text         AS "dateOfLeaving",
      e.employment_type               AS "employmentType",
      e.status                        AS "employeeStatus",
      dep.name                        AS "departmentName",
      des.name                        AS "designationName",
      loc.name                        AS "locationName",
      CASE WHEN mgr.id IS NULL THEN NULL
           ELSE concat_ws(' ', mgr.first_name, mgr.last_name) || ' (' || mgr.employee_code || ')'
      END                             AS "reportingManager",
      sh.name                         AS "defaultShift",
      wop.name                        AS "weeklyOffPattern",
      hc.name                         AS "holidayCalendar",
      e.is_field_staff                AS "isFieldStaff",
      e.tally_ref                     AS "tallyRef",
      e.created_at                    AS "recordCreatedAt",
      e.updated_at                    AS "recordUpdatedAt",
      e.deleted_at                    AS "recordDeletedAt",
      u.email                         AS "accountEmail",
      u.status                        AS "accountStatus",
      u.last_login_at                 AS "lastLoginAt",
      u.password_changed_at           AS "passwordChangedAt",
      u.locked_until                  AS "accountLockedUntil"
    FROM employees e
    LEFT JOIN departments       dep ON dep.id = e.department_id
    LEFT JOIN designations      des ON des.id = e.designation_id
    LEFT JOIN locations         loc ON loc.id = e.location_id
    LEFT JOIN employees         mgr ON mgr.id = e.reporting_manager_id
    LEFT JOIN shifts            sh  ON sh.id  = e.default_shift_id
    LEFT JOIN weekly_off_patterns wop ON wop.id = e.weekly_off_pattern_id
    LEFT JOIN holiday_calendars hc  ON hc.id  = e.holiday_calendar_id
    LEFT JOIN users             u   ON u.employee_id = e.id AND u.deleted_at IS NULL
    WHERE e.org_id = ${ids.orgId} AND e.id = ${ids.employeeId}
  `,
};

/**
 * Everything else, in the order a reader would want it: who they are, then
 * what happened to them, then what was recorded about it.
 */
export const SUBJECT_SECTIONS: readonly SubjectSection[] = [
  {
    key: 'roles',
    title: 'Roles held',
    columns: columns(
      ['roleName', 'Role'],
      ['roleDescription', 'Description'],
      ['grantedAt', 'Granted'],
    ),
    build: (ids) =>
      ids.userId === null
        ? null
        : sql`
            SELECT r.name AS "roleName", r.description AS "roleDescription",
                   ur.created_at AS "grantedAt"
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = ${ids.userId} AND r.org_id = ${ids.orgId}
            ORDER BY ur.created_at
          `,
  },
  {
    key: 'devices',
    title: 'Devices',
    columns: columns(
      ['label', 'Label'],
      ['fingerprint', 'Fingerprint'],
      ['deviceStatus', 'Status'],
      ['firstSeenAt', 'First seen'],
      ['lastSeenAt', 'Last seen'],
      ['deletedAt', 'Deleted'],
    ),
    build: (ids) => sql`
      SELECT label AS "label", fingerprint AS "fingerprint", status AS "deviceStatus",
             first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt",
             deleted_at AS "deletedAt"
      FROM devices
      WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
      ORDER BY first_seen_at
    `,
  },
  {
    key: 'invitations',
    title: 'Invitations',
    columns: columns(
      ['email', 'Sent to'],
      ['expiresAt', 'Expires'],
      ['acceptedAt', 'Accepted'],
      ['revokedAt', 'Revoked'],
      ['createdAt', 'Created'],
    ),
    build: (ids) => sql`
      SELECT email AS "email", expires_at AS "expiresAt", accepted_at AS "acceptedAt",
             revoked_at AS "revokedAt", created_at AS "createdAt"
      FROM invitations
      WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
      ORDER BY created_at
    `,
  },
  {
    key: 'consent',
    title: 'Consent',
    columns: columns(
      ['consentKey', 'Notice'],
      ['noticeVersion', 'Version'],
      ['retentionMonthsQuoted', 'Retention quoted (months)'],
      ['acceptedAt', 'Accepted'],
    ),
    build: (ids) =>
      ids.userId === null
        ? null
        : sql`
            SELECT consent_key AS "consentKey", notice_version AS "noticeVersion",
                   retention_months_quoted AS "retentionMonthsQuoted",
                   accepted_at AS "acceptedAt"
            FROM consent_acceptances
            WHERE org_id = ${ids.orgId} AND user_id = ${ids.userId}
            ORDER BY accepted_at
          `,
  },
  {
    key: 'shift-assignments',
    title: 'Shift assignments',
    columns: columns(
      ['shiftName', 'Shift'],
      ['effectiveFrom', 'From'],
      ['effectiveTo', 'To'],
      ['deletedAt', 'Deleted'],
    ),
    build: (ids) => sql`
      SELECT s.name AS "shiftName", sa.effective_from::text AS "effectiveFrom",
             sa.effective_to::text AS "effectiveTo", sa.deleted_at AS "deletedAt"
      FROM shift_assignments sa
      LEFT JOIN shifts s ON s.id = sa.shift_id
      WHERE sa.org_id = ${ids.orgId} AND sa.employee_id = ${ids.employeeId}
      ORDER BY sa.effective_from
    `,
  },
  {
    key: 'attendance-days',
    title: 'Attendance days',
    columns: columns(
      ['date', 'Date'],
      ['shiftName', 'Shift'],
      ['scheduledIn', 'Scheduled in'],
      ['scheduledOut', 'Scheduled out'],
      ['dayStatus', 'Status'],
      ['workedMinutes', 'Worked minutes'],
      ['breakMinutes', 'Break minutes'],
      ['otMinutes', 'Overtime minutes'],
      ['lateMinutes', 'Late minutes'],
      ['earlyExitMinutes', 'Early exit minutes'],
      ['flags', 'Flags'],
      ['isManualOverride', 'Overridden'],
      ['overrideReason', 'Override reason'],
      ['overriddenBy', 'Overridden by'],
      ['overrideAt', 'Overridden at'],
      ['locked', 'Locked'],
      ['deletedAt', 'Deleted'],
    ),
    build: (ids) => sql`
      SELECT d.date::text AS "date", s.name AS "shiftName",
             d.scheduled_in AS "scheduledIn", d.scheduled_out AS "scheduledOut",
             d.status AS "dayStatus", d.worked_minutes AS "workedMinutes",
             d.break_minutes AS "breakMinutes", d.ot_minutes AS "otMinutes",
             d.late_minutes AS "lateMinutes", d.early_exit_minutes AS "earlyExitMinutes",
             d.flags AS "flags", d.is_manual_override AS "isManualOverride",
             d.override_reason AS "overrideReason", ov.email AS "overriddenBy",
             d.override_at AS "overrideAt", d.locked AS "locked", d.deleted_at AS "deletedAt"
      FROM attendance_days d
      LEFT JOIN shifts s ON s.id = d.shift_id
      LEFT JOIN users ov ON ov.id = d.override_by
      WHERE d.org_id = ${ids.orgId} AND d.employee_id = ${ids.employeeId}
      ORDER BY d.date
    `,
  },
  {
    key: 'punches',
    title: 'Punches',
    columns: columns(
      ['attendanceDate', 'Attendance date'],
      ['punchType', 'Direction'],
      ['serverTime', 'Recorded at'],
      ['clientTime', 'Device time'],
      ['effectiveTime', 'Effective time'],
      ['source', 'Source'],
      ['latitude', 'Latitude'],
      ['longitude', 'Longitude'],
      ['gpsAccuracyM', 'GPS accuracy (m)'],
      ['distanceFromGeofenceM', 'Distance from geofence (m)'],
      ['outsideGeofence', 'Outside geofence'],
      ['outsideWindow', 'Outside window'],
      ['deviceMismatch', 'Device mismatch'],
      ['deviceFingerprint', 'Device fingerprint'],
      ['ip', 'IP address'],
      ['userAgent', 'User agent'],
      ['appVersion', 'App version'],
      ['reason', 'Reason given'],
      ['flags', 'Flags'],
      ['photoFileId', 'Photo file id'],
      ['thumbnailFileId', 'Thumbnail file id'],
    ),
    // The photo bytes are not here on purpose (REQ-M-05 asks for what is held
    // about a person, and a signed URL in a seven-day file would outlive its
    // own access check). The ids are, so the subject knows the photographs
    // exist and can ask for them through `GET /files/:id`.
    build: (ids) => sql`
      SELECT attendance_date::text AS "attendanceDate", punch_type AS "punchType",
             server_time AS "serverTime", client_time AS "clientTime",
             effective_time AS "effectiveTime", source AS "source",
             latitude AS "latitude", longitude AS "longitude",
             gps_accuracy_m AS "gpsAccuracyM",
             distance_from_geofence_m AS "distanceFromGeofenceM",
             outside_geofence AS "outsideGeofence", outside_window AS "outsideWindow",
             device_mismatch AS "deviceMismatch", device_fingerprint AS "deviceFingerprint",
             ip::text AS "ip", user_agent AS "userAgent", app_version AS "appVersion",
             reason AS "reason", flags AS "flags",
             photo_file_id::text AS "photoFileId",
             thumbnail_file_id::text AS "thumbnailFileId"
      FROM punches
      WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
      ORDER BY server_time
    `,
  },
  {
    key: 'leave-requests',
    title: 'Leave requests',
    columns: columns(
      ['leaveType', 'Leave type'],
      ['fromDate', 'From'],
      ['toDate', 'To'],
      ['totalDays', 'Days'],
      ['requestStatus', 'Status'],
      ['reason', 'Reason'],
      ['decidedAt', 'Decided'],
      ['decidedBy', 'Decided by'],
      ['decisionReason', 'Decision reason'],
      ['cancelledAt', 'Cancelled'],
      ['cancellationReason', 'Cancellation reason'],
      ['attachmentFileId', 'Attachment file id'],
      ['createdAt', 'Applied'],
      ['deletedAt', 'Deleted'],
    ),
    build: (ids) => sql`
      SELECT lt.name AS "leaveType", lr.from_date::text AS "fromDate",
             lr.to_date::text AS "toDate", lr.total_days::text AS "totalDays",
             lr.status AS "requestStatus", lr.reason AS "reason",
             lr.decided_at AS "decidedAt", du.email AS "decidedBy",
             lr.decision_reason AS "decisionReason", lr.cancelled_at AS "cancelledAt",
             lr.cancellation_reason AS "cancellationReason",
             lr.attachment_file_id::text AS "attachmentFileId",
             lr.created_at AS "createdAt", lr.deleted_at AS "deletedAt"
      FROM leave_requests lr
      LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN users du ON du.id = lr.decided_by
      WHERE lr.org_id = ${ids.orgId} AND lr.employee_id = ${ids.employeeId}
      ORDER BY lr.from_date
    `,
  },
  {
    key: 'leave-ledger',
    title: 'Leave ledger',
    columns: columns(
      ['postedAt', 'Posted'],
      ['leaveType', 'Leave type'],
      ['leaveYear', 'Leave year'],
      ['movementType', 'Movement'],
      ['days', 'Days'],
      ['referenceType', 'Caused by'],
      ['periodKey', 'Period'],
      ['note', 'Note'],
    ),
    build: (ids) => sql`
      SELECT l.created_at AS "postedAt", lt.name AS "leaveType", l.leave_year AS "leaveYear",
             l.movement_type AS "movementType", l.days::text AS "days",
             l.reference_type AS "referenceType", l.period_key AS "periodKey",
             l.note AS "note"
      FROM leave_ledger l
      LEFT JOIN leave_types lt ON lt.id = l.leave_type_id
      WHERE l.org_id = ${ids.orgId} AND l.employee_id = ${ids.employeeId}
      ORDER BY l.created_at
    `,
  },
  {
    key: 'leave-balances',
    title: 'Leave balances',
    columns: columns(
      ['leaveType', 'Leave type'],
      ['leaveYear', 'Leave year'],
      ['opening', 'Opening'],
      ['accrued', 'Accrued'],
      ['availed', 'Availed'],
      ['adjusted', 'Adjusted'],
      ['carriedForward', 'Carried forward'],
      ['closing', 'Balance'],
    ),
    build: (ids) => sql`
      SELECT lt.name AS "leaveType", b.leave_year AS "leaveYear", b.opening::text AS "opening",
             b.accrued::text AS "accrued", b.availed::text AS "availed",
             b.adjusted::text AS "adjusted", b.carried_forward::text AS "carriedForward",
             b.closing::text AS "closing"
      FROM leave_balances b
      LEFT JOIN leave_types lt ON lt.id = b.leave_type_id
      WHERE b.org_id = ${ids.orgId} AND b.employee_id = ${ids.employeeId}
      ORDER BY b.leave_year, lt.name
    `,
  },
  {
    key: 'comp-off',
    title: 'Comp-off credits',
    columns: columns(
      ['earnedForDate', 'Earned for'],
      ['days', 'Days'],
      ['expiresOn', 'Expires'],
      ['lapsedAt', 'Lapsed'],
      ['createdAt', 'Credited'],
    ),
    build: (ids) => sql`
      SELECT earned_for_date::text AS "earnedForDate", days::text AS "days",
             expires_on::text AS "expiresOn", lapsed_at AS "lapsedAt",
             created_at AS "createdAt"
      FROM comp_off_credits
      WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
      ORDER BY earned_for_date
    `,
  },
  {
    key: 'regularizations',
    title: 'Regularizations',
    columns: columns(
      ['date', 'Date'],
      ['kind', 'Kind'],
      ['requestedIn', 'Requested in'],
      ['requestedOut', 'Requested out'],
      ['reason', 'Reason'],
      ['requestStatus', 'Status'],
      ['decidedAt', 'Decided'],
      ['decidedBy', 'Decided by'],
      ['decisionReason', 'Decision reason'],
      ['attachmentFileId', 'Attachment file id'],
      ['createdAt', 'Raised'],
      ['deletedAt', 'Deleted'],
    ),
    build: (ids) => sql`
      SELECT r.date::text AS "date", r.kind AS "kind", r.requested_in AS "requestedIn",
             r.requested_out AS "requestedOut", r.reason AS "reason", r.status AS "requestStatus",
             r.decided_at AS "decidedAt", du.email AS "decidedBy",
             r.decision_reason AS "decisionReason",
             r.attachment_file_id::text AS "attachmentFileId",
             r.created_at AS "createdAt", r.deleted_at AS "deletedAt"
      FROM regularizations r
      LEFT JOIN users du ON du.id = r.decided_by
      WHERE r.org_id = ${ids.orgId} AND r.employee_id = ${ids.employeeId}
      ORDER BY r.date
    `,
  },
  {
    key: 'on-duty',
    title: 'On-duty requests',
    columns: columns(
      ['fromDate', 'From'],
      ['toDate', 'To'],
      ['siteName', 'Site'],
      ['reason', 'Reason'],
      ['requestStatus', 'Status'],
      ['decidedAt', 'Decided'],
      ['decidedBy', 'Decided by'],
      ['decisionReason', 'Decision reason'],
      ['createdAt', 'Raised'],
      ['deletedAt', 'Deleted'],
    ),
    build: (ids) => sql`
      SELECT o.from_date::text AS "fromDate", o.to_date::text AS "toDate",
             o.site_name AS "siteName", o.reason AS "reason", o.status AS "requestStatus",
             o.decided_at AS "decidedAt", du.email AS "decidedBy",
             o.decision_reason AS "decisionReason", o.created_at AS "createdAt",
             o.deleted_at AS "deletedAt"
      FROM on_duty_requests o
      LEFT JOIN users du ON du.id = o.decided_by
      WHERE o.org_id = ${ids.orgId} AND o.employee_id = ${ids.employeeId}
      ORDER BY o.from_date
    `,
  },
  {
    key: 'attendance-adjustments',
    title: 'Attendance adjustments',
    columns: columns(
      ['attendanceDate', 'Date'],
      ['adjustedIn', 'Adjusted in'],
      ['adjustedOut', 'Adjusted out'],
      ['reason', 'Reason'],
      ['approvedBy', 'Approved by'],
      ['createdAt', 'Applied'],
    ),
    build: (ids) => sql`
      SELECT a.attendance_date::text AS "attendanceDate", a.adjusted_in AS "adjustedIn",
             a.adjusted_out AS "adjustedOut", a.reason AS "reason",
             ap.email AS "approvedBy", a.created_at AS "createdAt"
      FROM attendance_adjustments a
      LEFT JOIN users ap ON ap.id = a.approved_by
      WHERE a.org_id = ${ids.orgId} AND a.employee_id = ${ids.employeeId}
      ORDER BY a.attendance_date
    `,
  },
  {
    key: 'approvals-raised',
    title: 'Approvals raised',
    columns: columns(
      ['approvalType', 'Type'],
      ['subjectSummary', 'Subject'],
      ['requestStatus', 'Status'],
      ['currentStep', 'Current step'],
      ['escalatedAt', 'Escalated'],
      ['createdAt', 'Raised'],
    ),
    build: (ids) =>
      ids.userId === null
        ? null
        : sql`
            SELECT type AS "approvalType", subject_summary AS "subjectSummary",
                   status AS "requestStatus", current_step AS "currentStep",
                   escalated_at AS "escalatedAt", created_at AS "createdAt"
            FROM approval_requests
            WHERE org_id = ${ids.orgId} AND requester_user_id = ${ids.userId}
            ORDER BY created_at
          `,
  },
  {
    key: 'approvals-decided',
    title: 'Approvals decided',
    // Only the step this person acted on, and the one-line summary the
    // approvals framework already shows them. The requester's own record is
    // deliberately not joined in: this file belongs to the subject, and
    // another employee's leave reason is not theirs to be handed.
    columns: columns(
      ['approvalType', 'Type'],
      ['subjectSummary', 'Subject'],
      ['stepNo', 'Step'],
      ['action', 'Action'],
      ['reason', 'Reason given'],
      ['actedAt', 'Acted'],
      ['delegatedFrom', 'Delegated from'],
    ),
    build: (ids) =>
      ids.userId === null
        ? null
        : sql`
            SELECT ar.type AS "approvalType", ar.subject_summary AS "subjectSummary",
                   st.step_no AS "stepNo", st.action AS "action", st.reason AS "reason",
                   st.acted_at AS "actedAt", df.email AS "delegatedFrom"
            FROM approval_steps st
            JOIN approval_requests ar ON ar.id = st.approval_request_id
            LEFT JOIN users df ON df.id = st.delegated_from_user_id
            WHERE st.org_id = ${ids.orgId}
              AND st.acted_at IS NOT NULL
              AND (st.acted_by_user_id = ${ids.userId} OR st.approver_user_id = ${ids.userId})
            ORDER BY st.acted_at
          `,
  },
  {
    key: 'audit',
    title: 'Audit entries about this person',
    // Entries where this person is the *subject*, never where they were merely
    // the actor. An HR user's actor trail carries the before/after of other
    // employees' records, and handing that to them because they asked for their
    // own data would make the export the leak it exists to prevent.
    columns: columns(
      ['createdAt', 'When'],
      ['action', 'Action'],
      ['entityType', 'Record type'],
      ['actorEmail', 'Changed by'],
      ['impersonatorEmail', 'Impersonated by'],
      ['ip', 'IP address'],
      ['userAgent', 'User agent'],
      ['before', 'Before'],
      ['after', 'After'],
    ),
    build: (ids) => sql`
      SELECT a.created_at AS "createdAt", a.action AS "action", a.entity_type AS "entityType",
             actor.email AS "actorEmail", imp.email AS "impersonatorEmail",
             a.ip::text AS "ip", a.user_agent AS "userAgent",
             a.before AS "before", a.after AS "after"
      FROM audit_logs a
      LEFT JOIN users actor ON actor.id = a.actor_user_id
      LEFT JOIN users imp ON imp.id = a.impersonator_user_id
      WHERE a.org_id = ${ids.orgId}
        AND a.entity_id IN (
          SELECT ${ids.employeeId}::uuid
          UNION ALL SELECT ${ids.userId}::uuid WHERE ${ids.userId}::uuid IS NOT NULL
          UNION ALL SELECT id FROM punches WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
          UNION ALL SELECT id FROM attendance_days WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
          UNION ALL SELECT id FROM leave_requests WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
          UNION ALL SELECT id FROM regularizations WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
          UNION ALL SELECT id FROM on_duty_requests WHERE org_id = ${ids.orgId} AND employee_id = ${ids.employeeId}
        )
      ORDER BY a.created_at
      LIMIT ${AUDIT_LIMIT}
    `,
  },
];
