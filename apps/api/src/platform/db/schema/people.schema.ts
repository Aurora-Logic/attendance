import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../columns.js';
import { locations, organizations } from './organizations.schema.js';

export const employmentTypeEnum = pgEnum('employment_type', [
  'PERMANENT',
  'CONTRACT',
  'PROBATION',
  'INTERN',
]);

export const employeeStatusEnum = pgEnum('employee_status', ['ACTIVE', 'ON_NOTICE', 'INACTIVE']);

/** REQ-A-02. `head_employee_id` and `parent_id` are both self/cross cycles, so
 * Drizzle needs the explicit return type to break the inference loop. */
export const departments = pgTable(
  'departments',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    headEmployeeId: uuid('head_employee_id').references((): AnyPgColumn => employees.id, {
      onDelete: 'set null',
    }),
    parentId: uuid('parent_id').references((): AnyPgColumn => departments.id, {
      onDelete: 'set null',
    }),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('departments_org_code_uq').on(t.orgId, t.code).where(ALIVE),
    index('departments_org_idx').on(t.orgId),
  ],
);

/** REQ-A-02. */
export const designations = pgTable(
  'designations',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    grade: text('grade'),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('designations_org_code_uq').on(t.orgId, t.code).where(ALIVE),
    index('designations_org_idx').on(t.orgId),
  ],
);

/**
 * REQ-A-03. The employee record is separate from the login account
 * (REQ-B-02) — a bulk import creates records, not users.
 */
export const employees = pgTable(
  'employees',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),

    /** REQ-A-04: immutable after creation. Enforced in the service layer and
     * asserted by a test; there is no UI path that edits it. */
    employeeCode: text('employee_code').notNull(),

    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    workEmail: text('work_email'),
    personalEmail: text('personal_email'),
    mobile: text('mobile'),

    // NFR-05: date-only fields are DATE, never timestamps. A joining date is
    // not an instant and must not shift with a timezone.
    dateOfJoining: date('date_of_joining', { mode: 'string' }).notNull(),
    dateOfLeaving: date('date_of_leaving', { mode: 'string' }),

    employmentType: employmentTypeEnum('employment_type').notNull().default('PERMANENT'),
    status: employeeStatusEnum('status').notNull().default('ACTIVE'),

    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    designationId: uuid('designation_id').references(() => designations.id, {
      onDelete: 'set null',
    }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),

    /** REQ-A-07: must not form a cycle. Validated on save. */
    reportingManagerId: uuid('reporting_manager_id').references((): AnyPgColumn => employees.id, {
      onDelete: 'set null',
    }),

    // These three point at attendance tables that arrive in Phase 1. Declared
    // without foreign keys so platform/ never imports modules/ (technical
    // design §1); the constraints are added in the Phase 1 migration.
    defaultShiftId: uuid('default_shift_id'),
    weeklyOffPatternId: uuid('weekly_off_pattern_id'),
    holidayCalendarId: uuid('holiday_calendar_id'),

    /** REQ-D-08: field staff are exempt from the geofence; their punch is
     * recorded as On Duty instead of being rejected. */
    isFieldStaff: boolean('is_field_staff').notNull().default(false),

    /** Technical design §14.3 step 2: displayed on the employee screen, blank
     * until the Phase 6 Tally sync populates it through `external_refs`. */
    tallyRef: text('tally_ref'),

    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('employees_org_code_uq').on(t.orgId, t.employeeCode).where(ALIVE),
    index('employees_org_status_idx').on(t.orgId, t.status),
    index('employees_org_department_idx').on(t.orgId, t.departmentId),
    index('employees_org_location_idx').on(t.orgId, t.locationId),
    // The scope resolver walks this chain to build the "team" data scope
    // (PRD §2), so it is a read path, not just a foreign key.
    index('employees_org_manager_idx').on(t.orgId, t.reportingManagerId),
  ],
);
