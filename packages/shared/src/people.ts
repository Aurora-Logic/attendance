import { z } from 'zod';

import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  type EmployeeStatus,
  type EmploymentType,
} from './enums.js';
import { pageQuerySchema } from './pagination.js';

/**
 * The employee contract (REQ-A-03 … REQ-A-07).
 *
 * It lives here rather than in the API because both ends need the same
 * definition: the server parses a request body with these schemas, and the web
 * client builds its form against them. Two copies would drift, and the drift
 * shows up as a field the form sends and the server silently discards.
 */

/**
 * A foreign key, resolved to something a person can read.
 *
 * The employee table shows a department name, not a department id. Returning
 * the id alone would make every client fetch four more collections and join
 * them by hand to render one row -- so the join happens once, in SQL, where it
 * is one query rather than four round trips.
 */
export interface NamedRef {
  readonly id: string;
  readonly name: string;
}

export interface EmployeeListItem {
  readonly id: string;
  readonly employeeCode: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly workEmail: string | null;
  readonly mobile: string | null;
  /** Date-only, `YYYY-MM-DD`. NFR-05: a joining date is not an instant. */
  readonly dateOfJoining: string;
  /** REQ-A-05: the last working date, set when an employee is deactivated. */
  readonly dateOfLeaving: string | null;
  readonly employmentType: EmploymentType;
  readonly status: EmployeeStatus;
  readonly department: NamedRef | null;
  readonly designation: NamedRef | null;
  readonly location: NamedRef | null;
  readonly reportingManager: NamedRef | null;
}

/** Everything the list carries, plus the fields only the detail screen shows. */
export interface EmployeeDetail extends EmployeeListItem {
  readonly personalEmail: string | null;
  /** REQ-D-08: exempt from the geofence; punches are recorded as On Duty. */
  readonly isFieldStaff: boolean;
  /** Technical design §14.3: blank until the Phase 6 Tally sync fills it. */
  readonly tallyRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * REQ-A-04: unique per organisation and immutable once created. Trimmed
 * because a trailing space produces a second code that looks identical on
 * every screen it appears on, and the charset excludes whitespace for the
 * same reason.
 */
const employeeCodeField = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u, 'may contain letters, digits, dot, underscore, slash and hyphen');

const nameField = z.string().trim().min(1).max(80);

/** RFC 5321 caps a path at 256 octets; 254 is the practical maximum address. */
const emailField = z
  .email('must be an email address')
  .max(254)
  .transform((value) => value.trim().toLowerCase());

/**
 * Deliberately permissive. Numbers arrive from an Excel import (REQ-A-06) with
 * country codes, spaces and brackets, and rejecting them at the boundary would
 * fail an import row over formatting rather than over data.
 */
const mobileField = z
  .string()
  .trim()
  .min(6)
  .max(24)
  .regex(/^[+0-9][0-9 ()-]*$/u, 'may contain digits, spaces, brackets and a leading plus');

/** `YYYY-MM-DD`, calendar-checked: `z.iso.date()` rejects 2026-02-31. */
const dateField = z.iso.date();

/**
 * The employee columns a client may sort on. Sorting by department or manager
 * name is deliberately absent: both are joins, and neither has an index that
 * would keep the sort cheap once the table is a few thousand rows.
 */
export const EMPLOYEE_SORT_FIELDS = [
  'employeeCode',
  'firstName',
  'lastName',
  'dateOfJoining',
  'dateOfLeaving',
  'employmentType',
  'status',
] as const;

export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export const DEFAULT_EMPLOYEE_SORT = 'employeeCode';

/** Technical design §6: `?departmentId=&locationId=&status=`, `?sort=-field`. */
export const employeeListQuerySchema = pageQuerySchema.extend({
  /** Free text over employee code and name. */
  q: z.string().trim().min(1).max(80).optional(),
  departmentId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  sort: z.string().max(200).optional(),
});

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

export const createEmployeeSchema = z.object({
  employeeCode: employeeCodeField,
  firstName: nameField,
  lastName: nameField.nullish(),
  workEmail: emailField.nullish(),
  personalEmail: emailField.nullish(),
  mobile: mobileField.nullish(),
  dateOfJoining: dateField,
  dateOfLeaving: dateField.nullish(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('PERMANENT'),
  status: z.enum(EMPLOYEE_STATUSES).default('ACTIVE'),
  departmentId: z.uuid().nullish(),
  designationId: z.uuid().nullish(),
  locationId: z.uuid().nullish(),
  /** REQ-A-07: the server refuses a value that would close a reporting loop. */
  reportingManagerId: z.uuid().nullish(),
  isFieldStaff: z.boolean().default(false),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/**
 * Not `createEmployeeSchema.partial()`, for two reasons that both matter.
 *
 * The defaults have to go: `.partial()` keeps them, so a PATCH that never
 * mentions `status` would arrive carrying `status: 'ACTIVE'` and quietly
 * reactivate somebody who was on notice.
 *
 * And `employeeCode` stays in the schema even though REQ-A-04 makes it
 * immutable. Dropping it would let Zod strip the key and the request would
 * succeed while silently ignoring the field -- the caller would believe the
 * code had changed. It is accepted here and refused in the service with
 * EMPLOYEE_CODE_IMMUTABLE.
 */
export const updateEmployeeSchema = z
  .object({
    employeeCode: employeeCodeField,
    firstName: nameField,
    lastName: nameField.nullable(),
    workEmail: emailField.nullable(),
    personalEmail: emailField.nullable(),
    mobile: mobileField.nullable(),
    dateOfJoining: dateField,
    dateOfLeaving: dateField.nullable(),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    status: z.enum(EMPLOYEE_STATUSES),
    departmentId: z.uuid().nullable(),
    designationId: z.uuid().nullable(),
    locationId: z.uuid().nullable(),
    reportingManagerId: z.uuid().nullable(),
    isFieldStaff: z.boolean(),
  })
  .partial();

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/**
 * One place that decides how a person's name is written, so the manager column
 * of a table and the heading of a profile cannot disagree about it.
 */
export function employeeDisplayName(firstName: string, lastName: string | null): string {
  return lastName === null || lastName.length === 0 ? firstName : `${firstName} ${lastName}`;
}

/**
 * REQ-A-06: one row of a bulk employee import.
 *
 * Deliberately not `createEmployeeSchema`. A spreadsheet row is typed by a
 * person and names things the way that person knows them -- "Operations",
 * "Head Office", the manager's employee code -- and it has never seen a UUID.
 * Making the importer take ids would push the lookup onto whoever prepares the
 * file, which is the one place it cannot be done.
 *
 * Every optional field accepts an empty string, because a spreadsheet exports
 * blanks as empty cells rather than omitting the column, and rejecting the
 * whole row for a blank optional would make the file unusable.
 */
const importTextField = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value !== undefined && value.length > 0 ? value : undefined));

export const employeeImportRowSchema = z.object({
  employeeCode: employeeCodeField,
  firstName: nameField,
  lastName: importTextField,
  workEmail: importTextField,
  personalEmail: importTextField,
  mobile: importTextField,
  dateOfJoining: dateField,
  employmentType: importTextField,
  status: importTextField,
  /** Resolved by name, case-insensitively. */
  department: importTextField,
  designation: importTextField,
  location: importTextField,
  /** The manager's employee code, not their name: names are not unique. */
  reportingManagerCode: importTextField,
  isFieldStaff: importTextField,
});

export type EmployeeImportRow = z.infer<typeof employeeImportRowSchema>;

/** Bounded so one request cannot hold a connection open resolving ten thousand names. */
export const MAX_EMPLOYEE_IMPORT_ROWS = 500;

export const employeeImportSchema = z.object({
  rows: z.array(employeeImportRowSchema).min(1).max(MAX_EMPLOYEE_IMPORT_ROWS),
});

export type EmployeeImportRequest = z.infer<typeof employeeImportSchema>;

export const EMPLOYEE_IMPORT_ACTIONS = ['CREATE', 'ERROR'] as const;
export type EmployeeImportAction = (typeof EMPLOYEE_IMPORT_ACTIONS)[number];

export interface EmployeeImportRowResult {
  /** 1-based, matching what the person sees in their spreadsheet. */
  readonly rowNumber: number;
  readonly employeeCode: string;
  readonly action: EmployeeImportAction;
  /** Empty when the row is fine; one entry per problem, so nothing is hidden. */
  readonly errors: readonly string[];
}

export interface EmployeeImportReport {
  readonly rows: readonly EmployeeImportRowResult[];
  readonly counts: { readonly CREATE: number; readonly ERROR: number };
  /** True only for a commit that ran; false for a validate, which writes nothing. */
  readonly committed: boolean;
  readonly createdCount: number;
}
