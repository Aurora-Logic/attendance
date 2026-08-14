import type { EmployeeStatus, EmploymentType } from '@vyuha/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { shifts } from '../src/modules/attendance/schema/index.js';
import type { Database } from '../src/platform/db/db.provider.js';
import {
  departments,
  designations,
  employees,
  locations,
} from '../src/platform/db/schema/index.js';

/**
 * Master data for a development database: one location, six departments, seven
 * designations and twenty-five people (REQ-A-01 … REQ-A-03).
 *
 * **Every person here is fabricated.** The first names run A to Z in order and
 * the employee codes are sequential, which is the tell: no real roster looks
 * like this. Addresses are `@vyuha.local`, a reserved TLD that cannot receive
 * mail, and the mobile numbers are a counting sequence.
 *
 * **Idempotent, matched on code.** A re-run inserts what is missing and leaves
 * what exists exactly as it is -- including the parts an administrator may
 * have edited, since REQ-A-02 and REQ-A-03 make all of this editable. The two
 * link-up passes (reporting manager, department head) therefore only touch
 * rows this run created, so re-seeding cannot undo a reorganisation someone
 * made in the UI.
 *
 * What is deliberately **not** here: geofence coordinates and the IP allowlist
 * (docs/OPEN-QUESTIONS items 1 and 3). Both stay null and empty. A guessed
 * centre would let geofenced punch appear to work and reject real employees at
 * the door.
 */

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface MasterDataReport {
  readonly locations: { created: number; total: number };
  readonly departments: { created: number; total: number };
  readonly designations: { created: number; total: number };
  readonly shifts: { created: number; total: number };
  readonly employees: { created: number; total: number };
  /** Links written this run: reporting managers, department heads, shifts. */
  readonly links: {
    reportingManagers: number;
    departmentHeads: number;
    defaultShifts: number;
  };
}

interface LocationSpec {
  readonly code: string;
  readonly name: string;
}

interface DepartmentSpec {
  readonly code: string;
  readonly name: string;
  readonly parentCode: string | null;
  /** Employee code of the head, linked once the people exist. */
  readonly headCode: string;
}

interface DesignationSpec {
  readonly code: string;
  readonly name: string;
  readonly grade: string;
}

interface EmployeeSpec {
  readonly code: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly departmentCode: string;
  readonly designationCode: string;
  readonly managerCode: string | null;
  readonly employmentType: EmploymentType;
  readonly status: EmployeeStatus;
  readonly dateOfJoining: string;
  /** REQ-A-05: required for INACTIVE, expected for ON_NOTICE. */
  readonly dateOfLeaving?: string;
  readonly isFieldStaff?: boolean;
}

const LOCATIONS: readonly LocationSpec[] = [{ code: 'HO', name: 'Head Office' }];

/**
 * REQ-C-01 and 05-decisions ("Shifts: one general shift, timings pending").
 *
 * **The timings below are a placeholder and are not the client's answer.**
 * OPEN-QUESTIONS item 2 is still open, and the day engine refuses to compute a
 * day for an employee with no shift at all -- so without something here, Phase 1
 * has nothing to punch against and no muster to look at. The name carries the
 * warning into every screen the shift appears on, which is deliberate: a
 * plausible-looking 09:00-18:00 with an ordinary name is the version that
 * silently becomes production policy.
 *
 * Every other number is REQ-C-01's stated default, so only `start_time`,
 * `end_time` and `break_minutes` are invented, and all three are visible in
 * one place the moment the real answer arrives.
 */
interface ShiftSpec {
  readonly code: string;
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes: number;
}

const GENERAL_SHIFT_CODE = 'GEN';

const SHIFTS: readonly ShiftSpec[] = [
  {
    code: GENERAL_SHIFT_CODE,
    name: 'General Shift (placeholder timings)',
    startTime: '09:30:00',
    endTime: '18:30:00',
    breakMinutes: 60,
  },
];

const DEPARTMENTS: readonly DepartmentSpec[] = [
  { code: 'ADM', name: 'Administration', parentCode: null, headCode: 'VY-0001' },
  { code: 'OPS', name: 'Operations', parentCode: null, headCode: 'VY-0002' },
  { code: 'OPS-FIELD', name: 'Field Operations', parentCode: 'OPS', headCode: 'VY-0007' },
  { code: 'HR', name: 'Human Resources', parentCode: null, headCode: 'VY-0003' },
  { code: 'FIN', name: 'Finance', parentCode: null, headCode: 'VY-0004' },
  { code: 'ENG', name: 'Engineering', parentCode: null, headCode: 'VY-0005' },
];

const DESIGNATIONS: readonly DesignationSpec[] = [
  { code: 'DIR', name: 'Director', grade: 'G1' },
  { code: 'GM', name: 'General Manager', grade: 'G2' },
  { code: 'MGR', name: 'Manager', grade: 'G3' },
  { code: 'SR-EXEC', name: 'Senior Executive', grade: 'G4' },
  { code: 'EXEC', name: 'Executive', grade: 'G5' },
  { code: 'ASSOC', name: 'Associate', grade: 'G6' },
  { code: 'TRAINEE', name: 'Trainee', grade: 'G7' },
];

/**
 * The employee the seeded administrator login is joined to (see `seed.ts`).
 *
 * VY-0001 rather than a row of the administrator's own: they are the root of
 * the reporting tree and head of Administration, so a login joined to them has
 * the whole organisation in team scope, which is what an administrator needs.
 */
export const ADMINISTRATOR_EMPLOYEE_CODE = 'VY-0001';

/**
 * Five levels deep on the longest branch -- Anita, Bharat, Farhan, Lalit,
 * Varun -- because the team data scope walks a chain rather than a list of
 * direct reports (PRD §2), and a two-level tree cannot tell a correct
 * implementation from one that stops after the first hop.
 */
const EMPLOYEES: readonly EmployeeSpec[] = [
  { code: ADMINISTRATOR_EMPLOYEE_CODE, firstName: 'Anita', lastName: 'Rao', departmentCode: 'ADM', designationCode: 'DIR', managerCode: null, employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2019-04-01' },

  { code: 'VY-0002', firstName: 'Bharat', lastName: 'Menon', departmentCode: 'OPS', designationCode: 'GM', managerCode: 'VY-0001', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2019-06-17' },
  { code: 'VY-0003', firstName: 'Chandni', lastName: 'Iyer', departmentCode: 'HR', designationCode: 'GM', managerCode: 'VY-0001', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2019-08-05' },
  { code: 'VY-0004', firstName: 'Devang', lastName: 'Pillai', departmentCode: 'FIN', designationCode: 'GM', managerCode: 'VY-0001', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2020-01-20' },
  { code: 'VY-0005', firstName: 'Esha', lastName: 'Kulkarni', departmentCode: 'ENG', designationCode: 'GM', managerCode: 'VY-0001', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2020-02-10' },

  { code: 'VY-0006', firstName: 'Farhan', lastName: 'Qureshi', departmentCode: 'OPS', designationCode: 'MGR', managerCode: 'VY-0002', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2021-03-15' },
  { code: 'VY-0007', firstName: 'Gauri', lastName: 'Deshpande', departmentCode: 'OPS-FIELD', designationCode: 'MGR', managerCode: 'VY-0002', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2021-05-03', isFieldStaff: true },
  { code: 'VY-0008', firstName: 'Harish', lastName: 'Nambiar', departmentCode: 'HR', designationCode: 'SR-EXEC', managerCode: 'VY-0003', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2021-07-19' },
  { code: 'VY-0009', firstName: 'Ishita', lastName: 'Bhatt', departmentCode: 'FIN', designationCode: 'SR-EXEC', managerCode: 'VY-0004', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2021-09-06' },
  { code: 'VY-0010', firstName: 'Jatin', lastName: 'Verma', departmentCode: 'ENG', designationCode: 'MGR', managerCode: 'VY-0005', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2021-11-22' },
  { code: 'VY-0011', firstName: 'Kavya', lastName: 'Reddy', departmentCode: 'ENG', designationCode: 'MGR', managerCode: 'VY-0005', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2022-01-10' },

  { code: 'VY-0012', firstName: 'Lalit', lastName: 'Chauhan', departmentCode: 'OPS', designationCode: 'SR-EXEC', managerCode: 'VY-0006', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2022-02-14' },
  { code: 'VY-0013', firstName: 'Meera', lastName: 'Saxena', departmentCode: 'OPS', designationCode: 'EXEC', managerCode: 'VY-0006', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2022-04-04' },
  { code: 'VY-0014', firstName: 'Nikhil', lastName: 'Barua', departmentCode: 'OPS-FIELD', designationCode: 'EXEC', managerCode: 'VY-0007', employmentType: 'CONTRACT', status: 'ACTIVE', dateOfJoining: '2022-06-13', isFieldStaff: true },
  { code: 'VY-0015', firstName: 'Omkar', lastName: 'Joshi', departmentCode: 'OPS-FIELD', designationCode: 'EXEC', managerCode: 'VY-0007', employmentType: 'PERMANENT', status: 'ON_NOTICE', dateOfJoining: '2022-08-01', dateOfLeaving: '2026-09-30', isFieldStaff: true },
  { code: 'VY-0016', firstName: 'Pooja', lastName: 'Grewal', departmentCode: 'HR', designationCode: 'EXEC', managerCode: 'VY-0008', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2022-10-17' },
  { code: 'VY-0017', firstName: 'Rahul', lastName: 'Sethi', departmentCode: 'FIN', designationCode: 'EXEC', managerCode: 'VY-0009', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2023-01-09' },
  { code: 'VY-0018', firstName: 'Sneha', lastName: 'Kamath', departmentCode: 'ENG', designationCode: 'SR-EXEC', managerCode: 'VY-0010', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2023-03-06' },
  { code: 'VY-0019', firstName: 'Tarun', lastName: 'Mahajan', departmentCode: 'ENG', designationCode: 'EXEC', managerCode: 'VY-0010', employmentType: 'PERMANENT', status: 'ON_NOTICE', dateOfJoining: '2023-05-22', dateOfLeaving: '2026-08-31' },
  { code: 'VY-0020', firstName: 'Uma', lastName: 'Shenoy', departmentCode: 'ENG', designationCode: 'EXEC', managerCode: 'VY-0011', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2023-07-31' },

  { code: 'VY-0021', firstName: 'Varun', lastName: 'Tiwari', departmentCode: 'OPS', designationCode: 'ASSOC', managerCode: 'VY-0012', employmentType: 'PROBATION', status: 'ACTIVE', dateOfJoining: '2026-06-01' },
  { code: 'VY-0022', firstName: 'Wasim', lastName: 'Ansari', departmentCode: 'OPS-FIELD', designationCode: 'ASSOC', managerCode: 'VY-0014', employmentType: 'CONTRACT', status: 'INACTIVE', dateOfJoining: '2024-02-19', dateOfLeaving: '2026-05-31', isFieldStaff: true },
  { code: 'VY-0023', firstName: 'Yamini', lastName: 'Prabhu', departmentCode: 'ENG', designationCode: 'TRAINEE', managerCode: 'VY-0018', employmentType: 'INTERN', status: 'ACTIVE', dateOfJoining: '2026-05-04' },
  { code: 'VY-0024', firstName: 'Zoya', lastName: 'Fernandes', departmentCode: 'ENG', designationCode: 'ASSOC', managerCode: 'VY-0018', employmentType: 'PERMANENT', status: 'INACTIVE', dateOfJoining: '2023-09-11', dateOfLeaving: '2026-03-15' },
  { code: 'VY-0025', firstName: 'Aditya', lastName: 'Bhandari', departmentCode: 'ADM', designationCode: 'SR-EXEC', managerCode: 'VY-0001', employmentType: 'PERMANENT', status: 'ACTIVE', dateOfJoining: '2024-04-15' },
];

export async function seedMasterData(tx: Transaction, orgId: string): Promise<MasterDataReport> {
  const locationIds = await ensureLocations(tx, orgId);
  const departmentIds = await ensureDepartments(tx, orgId);
  const designationIds = await ensureDesignations(tx, orgId);
  const shiftIds = await ensureShifts(tx, orgId);

  const headOfficeId = locationIds.get('HO') ?? null;
  const created = await ensureEmployees(tx, orgId, departmentIds, designationIds, headOfficeId);
  const employeeIds = await codeIndex(tx, orgId);

  const reportingManagers = await linkReportingManagers(tx, orgId, created, employeeIds);
  const departmentHeads = await linkDepartmentHeads(tx, orgId, departmentIds, employeeIds);
  const defaultShifts = await linkDefaultShift(tx, orgId, shiftIds.get(GENERAL_SHIFT_CODE) ?? null);

  return {
    locations: { created: locationIds.createdCount, total: LOCATIONS.length },
    departments: { created: departmentIds.createdCount, total: DEPARTMENTS.length },
    designations: { created: designationIds.createdCount, total: DESIGNATIONS.length },
    shifts: { created: shiftIds.createdCount, total: SHIFTS.length },
    employees: { created: created.size, total: EMPLOYEES.length },
    links: { reportingManagers, departmentHeads, defaultShifts },
  };
}

/** A code -> id map that also remembers how many of its entries are new. */
class CodeMap extends Map<string, string> {
  createdCount = 0;
}

async function ensureLocations(tx: Transaction, orgId: string): Promise<CodeMap> {
  const existing = await tx
    .select({ id: locations.id, code: locations.code })
    .from(locations)
    .where(and(eq(locations.orgId, orgId), isNull(locations.deletedAt)));

  const map = new CodeMap(existing.map((row) => [row.code, row.id]));
  const missing = LOCATIONS.filter((spec) => !map.has(spec.code));
  if (missing.length === 0) return map;

  const inserted = await tx
    .insert(locations)
    .values(
      missing.map((spec) => ({
        orgId,
        code: spec.code,
        name: spec.name,
        // Null means "the organisation timezone applies". Geofence and
        // allowlist are left at their column defaults; see the file comment.
        timezone: null,
      })),
    )
    .returning({ id: locations.id, code: locations.code });

  for (const row of inserted) map.set(row.code, row.id);
  map.createdCount = inserted.length;
  return map;
}

async function ensureDepartments(tx: Transaction, orgId: string): Promise<CodeMap> {
  const existing = await tx
    .select({ id: departments.id, code: departments.code })
    .from(departments)
    .where(and(eq(departments.orgId, orgId), isNull(departments.deletedAt)));

  const map = new CodeMap(existing.map((row) => [row.code, row.id]));
  const missing = DEPARTMENTS.filter((spec) => !map.has(spec.code));

  if (missing.length > 0) {
    const inserted = await tx
      .insert(departments)
      .values(missing.map((spec) => ({ orgId, code: spec.code, name: spec.name })))
      .returning({ id: departments.id, code: departments.code });

    for (const row of inserted) map.set(row.code, row.id);
    map.createdCount = inserted.length;
  }

  // A second pass, because a child department can be inserted in the same
  // batch as its parent and there is no id to point at until the batch lands.
  for (const spec of DEPARTMENTS) {
    if (spec.parentCode === null) continue;
    const id = map.get(spec.code);
    const parentId = map.get(spec.parentCode);
    if (id === undefined || parentId === undefined) continue;
    await tx
      .update(departments)
      .set({ parentId })
      .where(and(eq(departments.id, id), isNull(departments.parentId)));
  }

  return map;
}

async function ensureDesignations(tx: Transaction, orgId: string): Promise<CodeMap> {
  const existing = await tx
    .select({ id: designations.id, code: designations.code })
    .from(designations)
    .where(and(eq(designations.orgId, orgId), isNull(designations.deletedAt)));

  const map = new CodeMap(existing.map((row) => [row.code, row.id]));
  const missing = DESIGNATIONS.filter((spec) => !map.has(spec.code));
  if (missing.length === 0) return map;

  const inserted = await tx
    .insert(designations)
    .values(missing.map((spec) => ({ orgId, code: spec.code, name: spec.name, grade: spec.grade })))
    .returning({ id: designations.id, code: designations.code });

  for (const row of inserted) map.set(row.code, row.id);
  map.createdCount = inserted.length;
  return map;
}

async function ensureShifts(tx: Transaction, orgId: string): Promise<CodeMap> {
  const existing = await tx
    .select({ id: shifts.id, code: shifts.code })
    .from(shifts)
    .where(and(eq(shifts.orgId, orgId), isNull(shifts.deletedAt)));

  const map = new CodeMap(existing.map((row) => [row.code, row.id]));
  const missing = SHIFTS.filter((spec) => !map.has(spec.code));
  if (missing.length === 0) return map;

  // Only the three invented columns are set. Every grace and threshold is left
  // to the REQ-C-01 default on the column, so the policy this seed installs is
  // the one the requirement prints rather than one this file decided.
  const inserted = await tx
    .insert(shifts)
    .values(
      missing.map((spec) => ({
        orgId,
        code: spec.code,
        name: spec.name,
        startTime: spec.startTime,
        endTime: spec.endTime,
        breakMinutes: spec.breakMinutes,
      })),
    )
    .returning({ id: shifts.id, code: shifts.code });

  for (const row of inserted) map.set(row.code, row.id);
  map.createdCount = inserted.length;
  return map;
}

/**
 * REQ-C-04's fallback: an employee with no roster row punches against their
 * default shift.
 *
 * Only fills a default that is empty, for the same reason the department head
 * pass does -- somebody who moved an employee onto a night shift in the UI must
 * not have that undone by a re-seed.
 */
async function linkDefaultShift(
  tx: Transaction,
  orgId: string,
  shiftId: string | null,
): Promise<number> {
  if (shiftId === null) return 0;

  const updated = await tx
    .update(employees)
    .set({ defaultShiftId: shiftId })
    .where(
      and(
        eq(employees.orgId, orgId),
        isNull(employees.deletedAt),
        isNull(employees.defaultShiftId),
      ),
    )
    .returning({ id: employees.id });

  return updated.length;
}

/** Returns the employee codes this run created, so only they get linked up. */
async function ensureEmployees(
  tx: Transaction,
  orgId: string,
  departmentIds: CodeMap,
  designationIds: CodeMap,
  locationId: string | null,
): Promise<Set<string>> {
  const existing = await codeIndex(tx, orgId);
  const missing = EMPLOYEES.filter((spec) => !existing.has(spec.code));
  if (missing.length === 0) return new Set();

  await tx.insert(employees).values(
    missing.map((spec) => ({
      orgId,
      employeeCode: spec.code,
      firstName: spec.firstName,
      lastName: spec.lastName,
      workEmail: workEmail(spec),
      mobile: mobile(spec.code),
      dateOfJoining: spec.dateOfJoining,
      dateOfLeaving: spec.dateOfLeaving ?? null,
      employmentType: spec.employmentType,
      status: spec.status,
      departmentId: departmentIds.get(spec.departmentCode) ?? null,
      designationId: designationIds.get(spec.designationCode) ?? null,
      locationId,
      isFieldStaff: spec.isFieldStaff ?? false,
    })),
  );

  return new Set(missing.map((spec) => spec.code));
}

async function linkReportingManagers(
  tx: Transaction,
  orgId: string,
  createdCodes: ReadonlySet<string>,
  employeeIds: ReadonlyMap<string, string>,
): Promise<number> {
  let linked = 0;

  for (const spec of EMPLOYEES) {
    if (!createdCodes.has(spec.code) || spec.managerCode === null) continue;
    const id = employeeIds.get(spec.code);
    const managerId = employeeIds.get(spec.managerCode);
    if (id === undefined || managerId === undefined) continue;

    await tx
      .update(employees)
      .set({ reportingManagerId: managerId })
      .where(and(eq(employees.id, id), eq(employees.orgId, orgId)));
    linked += 1;
  }

  return linked;
}

/**
 * Only fills a head that is empty. An administrator who moved a department to
 * a different head must not have that undone by a re-seed.
 */
async function linkDepartmentHeads(
  tx: Transaction,
  orgId: string,
  departmentIds: ReadonlyMap<string, string>,
  employeeIds: ReadonlyMap<string, string>,
): Promise<number> {
  let linked = 0;

  for (const spec of DEPARTMENTS) {
    const id = departmentIds.get(spec.code);
    const headEmployeeId = employeeIds.get(spec.headCode);
    if (id === undefined || headEmployeeId === undefined) continue;

    const updated = await tx
      .update(departments)
      .set({ headEmployeeId })
      .where(
        and(
          eq(departments.id, id),
          eq(departments.orgId, orgId),
          isNull(departments.headEmployeeId),
        ),
      )
      .returning({ id: departments.id });

    linked += updated.length;
  }

  return linked;
}

async function codeIndex(tx: Transaction, orgId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .where(
      and(
        eq(employees.orgId, orgId),
        isNull(employees.deletedAt),
        inArray(
          employees.employeeCode,
          EMPLOYEES.map((spec) => spec.code),
        ),
      ),
    );

  return new Map(rows.map((row) => [row.code, row.id]));
}

/** `.local` is reserved for local networks, so none of these can reach anybody. */
function workEmail(spec: EmployeeSpec): string {
  return `${spec.firstName}.${spec.lastName}@vyuha.local`.toLowerCase();
}

/** A counting sequence, so no digit of it resembles a real subscriber number. */
function mobile(code: string): string {
  const serial = code.slice(-4);
  return `+91 90000 ${serial}`;
}
