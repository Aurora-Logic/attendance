import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  type EmployeeImportRow,
  type EmployeeImportRowResult,
  type EmployeeStatus,
  type EmploymentType,
} from '@vyuha/shared';

/**
 * REQ-A-06: turns a spreadsheet into a plan, and decides nothing else.
 *
 * Pure on purpose. Everything it needs about the database arrives as plain
 * maps, so the whole of the awkward part -- names that do not resolve, codes
 * that already exist, a manager chain that closes on itself -- is testable
 * without a database and cannot half-write anything while it makes up its mind.
 *
 * Every problem with a row is reported, not just the first. Somebody fixing a
 * hundred-row sheet should learn everything wrong with row 12 in one pass
 * rather than upload it four times.
 */

export interface ImportLookups {
  /** Lower-cased name to id. Names are what a spreadsheet carries. */
  readonly departments: ReadonlyMap<string, string>;
  readonly designations: ReadonlyMap<string, string>;
  readonly locations: ReadonlyMap<string, string>;
  /** Employee code (upper-cased) to id, for everyone who already exists. */
  readonly employeesByCode: ReadonlyMap<string, string>;
  /**
   * Existing reporting edges, upper-cased code to their manager's code. Needed
   * because a new row may point at an existing manager who already reports,
   * through any number of levels, to somebody else in this same file.
   */
  readonly managerEdges: ReadonlyMap<string, string>;
}

/** A row that passed, with every name already resolved to an id. */
export interface ResolvedImportRow {
  readonly rowNumber: number;
  readonly employeeCode: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly workEmail: string | null;
  readonly personalEmail: string | null;
  readonly mobile: string | null;
  readonly dateOfJoining: string;
  readonly employmentType: EmploymentType;
  readonly status: EmployeeStatus;
  readonly departmentId: string | null;
  readonly designationId: string | null;
  readonly locationId: string | null;
  /** Null when the manager is another row in this file; linked after insert. */
  readonly reportingManagerId: string | null;
  /** Set when the manager is in this file, so the service can link it second. */
  readonly reportingManagerCode: string | null;
  readonly isFieldStaff: boolean;
}

export interface ImportPlan {
  readonly results: readonly EmployeeImportRowResult[];
  readonly creatable: readonly ResolvedImportRow[];
}

/**
 * Spreadsheets do not have booleans. They have whatever somebody typed, and
 * the same column will hold "Yes" in one file and "TRUE" in the next.
 */
const TRUE_WORDS = new Set(['true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);

function parseFlag(raw: string | undefined): { ok: true; value: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, value: false };
  const word = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return { ok: true, value: true };
  if (FALSE_WORDS.has(word)) return { ok: true, value: false };
  return { ok: false };
}

function resolveName(
  lookup: ReadonlyMap<string, string>,
  raw: string | undefined,
): { ok: true; id: string | null } | { ok: false } {
  if (raw === undefined) return { ok: true, id: null };
  const id = lookup.get(raw.trim().toLowerCase());
  return id === undefined ? { ok: false } : { ok: true, id };
}

/**
 * Walks up the reporting chain looking for the code it started from.
 *
 * The map passed in is the existing edges with this file's edges laid over the
 * top, which is what makes the batch case detectable at all: A reporting to B
 * and B reporting to A are two perfectly valid rows on their own, and only the
 * pair is wrong. The single-employee create path cannot catch this and does not
 * try to -- a brand new employee has no subordinates, so on its own it can
 * never close a loop.
 *
 * The visited set bounds the walk. Without it an existing cycle -- which should
 * be impossible, but this runs against real data -- would hang the request
 * rather than reject the row.
 */
function closesCycle(start: string, edges: ReadonlyMap<string, string>): boolean {
  const visited = new Set<string>([start]);
  let current = edges.get(start);
  while (current !== undefined) {
    if (current === start) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = edges.get(current);
  }
  return false;
}

export function planEmployeeImport(
  rows: readonly EmployeeImportRow[],
  lookups: ImportLookups,
): ImportPlan {
  const results: EmployeeImportRowResult[] = [];
  const resolved: ResolvedImportRow[] = [];

  // Codes seen earlier in this same file. A file that lists one person twice is
  // the most common way an import goes wrong, and the database's unique index
  // would only report it as a failure halfway through the commit.
  const seenCodes = new Set<string>();

  // Existing edges plus every edge this file proposes, so the cycle check sees
  // the graph as it would be after the import rather than as it is now.
  const edges = new Map<string, string>(lookups.managerEdges);
  for (const row of rows) {
    if (row.reportingManagerCode !== undefined) {
      edges.set(row.employeeCode.toUpperCase(), row.reportingManagerCode.trim().toUpperCase());
    }
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const errors: string[] = [];
    const code = row.employeeCode.toUpperCase();

    if (seenCodes.has(code)) {
      errors.push(`Employee code ${row.employeeCode} appears more than once in this file.`);
    }
    seenCodes.add(code);

    if (lookups.employeesByCode.has(code)) {
      errors.push(`Employee code ${row.employeeCode} already exists.`);
    }

    const employmentType = row.employmentType?.trim().toUpperCase();
    if (employmentType !== undefined && !EMPLOYMENT_TYPES.includes(employmentType as EmploymentType)) {
      errors.push(`Employment type must be one of: ${EMPLOYMENT_TYPES.join(', ')}.`);
    }

    const status = row.status?.trim().toUpperCase();
    if (status !== undefined && !EMPLOYEE_STATUSES.includes(status as EmployeeStatus)) {
      errors.push(`Status must be one of: ${EMPLOYEE_STATUSES.join(', ')}.`);
    }

    const fieldStaff = parseFlag(row.isFieldStaff);
    if (!fieldStaff.ok) {
      errors.push('Field staff must be yes or no.');
    }

    const department = resolveName(lookups.departments, row.department);
    if (!department.ok) errors.push(`No department named "${row.department ?? ''}".`);

    const designation = resolveName(lookups.designations, row.designation);
    if (!designation.ok) errors.push(`No designation named "${row.designation ?? ''}".`);

    const location = resolveName(lookups.locations, row.location);
    if (!location.ok) errors.push(`No location named "${row.location ?? ''}".`);

    let managerId: string | null = null;
    let managerCode: string | null = null;
    if (row.reportingManagerCode !== undefined) {
      const wanted = row.reportingManagerCode.trim().toUpperCase();
      const existing = lookups.employeesByCode.get(wanted);
      const inThisFile = rows.some((other) => other.employeeCode.toUpperCase() === wanted);

      if (existing === undefined && !inThisFile) {
        errors.push(`No employee with code ${row.reportingManagerCode} to report to.`);
      } else if (wanted === code) {
        errors.push('An employee cannot report to themselves.');
      } else if (closesCycle(code, edges)) {
        // REQ-A-07, the case a single create can never see.
        errors.push(
          `Reporting to ${row.reportingManagerCode} would close a reporting loop.`,
        );
      } else if (existing !== undefined) {
        managerId = existing;
      } else {
        managerCode = wanted;
      }
    }

    if (errors.length > 0) {
      results.push({ rowNumber, employeeCode: row.employeeCode, action: 'ERROR', errors });
      return;
    }

    results.push({ rowNumber, employeeCode: row.employeeCode, action: 'CREATE', errors: [] });
    resolved.push({
      rowNumber,
      employeeCode: row.employeeCode,
      firstName: row.firstName,
      lastName: row.lastName ?? null,
      workEmail: row.workEmail ?? null,
      personalEmail: row.personalEmail ?? null,
      mobile: row.mobile ?? null,
      dateOfJoining: row.dateOfJoining,
      employmentType: (employmentType ?? 'PERMANENT') as EmploymentType,
      status: (status ?? 'ACTIVE') as EmployeeStatus,
      departmentId: department.ok ? department.id : null,
      designationId: designation.ok ? designation.id : null,
      locationId: location.ok ? location.id : null,
      reportingManagerId: managerId,
      reportingManagerCode: managerCode,
      isFieldStaff: fieldStaff.ok ? fieldStaff.value : false,
    });
  });

  return { results, creatable: resolved };
}

export function countImportActions(
  results: readonly EmployeeImportRowResult[],
): { CREATE: number; ERROR: number } {
  return results.reduce(
    (counts, row) => ({ ...counts, [row.action]: counts[row.action] + 1 }),
    { CREATE: 0, ERROR: 0 },
  );
}
