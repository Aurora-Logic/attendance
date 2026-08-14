import type { EmployeeImportRow } from '@vyuha/shared';

import { normaliseDate } from '@/features/holidays/sheet-rows';

/**
 * A pasted spreadsheet, turned into REQ-A-06's import rows.
 *
 * Pure and separate from the sheet that renders it, for the reason the holiday
 * parser gives: the awkward cases are the whole point, and they are only
 * testable outside a browser.
 *
 * Two things differ from the holiday import, and both come from the shape of
 * the data rather than from taste.
 *
 * **The header row is read, not skipped.** A holiday row is three columns and
 * can be positional. An employee row is fourteen, half of them optional, and
 * nobody pastes fourteen columns in a fixed order from a real HR spreadsheet.
 * So the first line names the columns and everything after it is matched by
 * name — which also means a file with the columns in a different order, or
 * with extra columns this product does not want, imports correctly instead of
 * silently loading a mobile number into a designation.
 *
 * **Only the wrapper is validated here.** Whether a department exists, whether
 * an employee code is taken, whether a manager code resolves — all of that is
 * the server's, and `/import/validate` answers it against the real tables. This
 * file's job ends at "these cells belong to these columns"; guessing further
 * would produce a preview that disagrees with the commit.
 *
 * Date normalisation is shared with the holiday parser rather than rewritten:
 * an Indian spreadsheet writes dd-MM-yyyy, that reading was chosen once, and
 * two files disagreeing about 03-04-2026 would move somebody's joining date by
 * a month.
 */

export interface ImportColumn {
  readonly key: keyof EmployeeImportRow;
  readonly header: string;
  readonly required: boolean;
  /** Alternative spellings a real spreadsheet uses for the same column. */
  readonly aliases: readonly string[];
}

/**
 * The template, and the only columns read. The order is the template's order;
 * a pasted file may use any.
 */
export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'employeeCode', header: 'Employee code', required: true, aliases: ['code', 'empcode', 'employeeid', 'employeeno'] },
  { key: 'firstName', header: 'First name', required: true, aliases: ['firstname', 'givenname', 'name'] },
  { key: 'lastName', header: 'Last name', required: false, aliases: ['lastname', 'surname', 'familyname'] },
  { key: 'workEmail', header: 'Work email', required: false, aliases: ['workemail', 'officeemail', 'email'] },
  { key: 'personalEmail', header: 'Personal email', required: false, aliases: ['personalemail'] },
  { key: 'mobile', header: 'Mobile', required: false, aliases: ['mobile', 'phone', 'mobileno', 'contact'] },
  { key: 'dateOfJoining', header: 'Date of joining', required: true, aliases: ['dateofjoining', 'doj', 'joiningdate', 'joined'] },
  { key: 'employmentType', header: 'Employment type', required: false, aliases: ['employmenttype', 'type'] },
  { key: 'status', header: 'Status', required: false, aliases: ['status'] },
  { key: 'department', header: 'Department', required: false, aliases: ['department', 'dept'] },
  { key: 'designation', header: 'Designation', required: false, aliases: ['designation', 'title', 'role'] },
  { key: 'location', header: 'Location', required: false, aliases: ['location', 'site', 'branch'] },
  { key: 'reportingManagerCode', header: 'Reporting manager code', required: false, aliases: ['reportingmanagercode', 'managercode', 'manager', 'reportsto'] },
  { key: 'isFieldStaff', header: 'Field staff', required: false, aliases: ['fieldstaff', 'isfieldstaff', 'field'] },
];

export interface SheetProblem {
  /** 1-based over the pasted text, so it names the line the reader can see. */
  readonly line: number;
  readonly message: string;
}

export interface ParsedEmployeeSheet {
  readonly rows: EmployeeImportRow[];
  readonly problems: SheetProblem[];
  /** Header cells that matched no column, so the reader knows what was ignored. */
  readonly ignoredColumns: readonly string[];
  /** Required columns the header did not contain; nothing is parsed without them. */
  readonly missingColumns: readonly string[];
}

/** The header a person pastes back after downloading the template. */
export const TEMPLATE_HEADER = IMPORT_COLUMNS.map((column) => column.header).join('\t');

export const TEMPLATE_EXAMPLE = [
  TEMPLATE_HEADER,
  [
    'VY-0101',
    'Asha',
    'Rao',
    'asha.rao@example.com',
    '',
    '+91 98200 00000',
    '2026-04-01',
    'PERMANENT',
    'ACTIVE',
    'Operations',
    'Executive',
    'Head Office',
    'VY-0002',
    'no',
  ].join('\t'),
].join('\n');

/** Lower-cased and stripped of everything but letters and digits. */
function normaliseHeader(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

/**
 * Cells of one line.
 *
 * Tabs first and alone when the line contains one: a paste out of Excel is
 * tab-separated, and a name like "Rao, Asha" would otherwise be split by the
 * comma branch. Only a line with no tab at all falls back to comma or
 * semicolon, which is what a CSV export gives.
 */
function splitCells(line: string): string[] {
  const separator = line.includes('\t') ? /\t/u : /[,;]/u;
  return line.split(separator).map((cell) => cell.trim());
}

/** True for the words a spreadsheet uses to mean yes. */
const TRUE_WORDS = new Set(['yes', 'y', 'true', 't', '1']);
const FALSE_WORDS = new Set(['no', 'n', 'false', 'f', '0', '']);

/**
 * `isFieldStaff` travels to the server as text, because the shared row schema
 * takes text there and the server owns the interpretation. What this does is
 * catch a value that means neither, which would otherwise be reported by the
 * API as a row error the person cannot tie to a cell.
 */
export function fieldStaffProblem(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(value) || FALSE_WORDS.has(value)) return null;
  return `"${raw}" is not yes or no in the Field staff column.`;
}

export function parseEmployeeSheet(text: string): ParsedEmployeeSheet {
  const lines = text.split(/\r?\n/u);
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex === -1) {
    return { rows: [], problems: [], ignoredColumns: [], missingColumns: [] };
  }

  const headerCells = splitCells(lines[firstIndex] ?? '');
  const byIndex = new Map<number, keyof EmployeeImportRow>();
  const ignoredColumns: string[] = [];

  headerCells.forEach((cell, index) => {
    const key = normaliseHeader(cell);
    if (key.length === 0) return;
    const column = IMPORT_COLUMNS.find(
      (candidate) => normaliseHeader(candidate.header) === key || candidate.aliases.includes(key),
    );
    if (column === undefined) ignoredColumns.push(cell);
    else byIndex.set(index, column.key);
  });

  const matched = new Set(byIndex.values());
  const missingColumns = IMPORT_COLUMNS.filter(
    (column) => column.required && !matched.has(column.key),
  ).map((column) => column.header);

  // Without the required columns there is nothing to parse, and parsing anyway
  // would send the server a file of rows missing their code and produce
  // fourteen identical row errors instead of one sentence naming the column.
  if (missingColumns.length > 0) {
    return { rows: [], problems: [], ignoredColumns, missingColumns };
  }

  const rows: EmployeeImportRow[] = [];
  const problems: SheetProblem[] = [];

  lines.forEach((rawLine, index) => {
    if (index <= firstIndex) return;
    if (rawLine.trim().length === 0) return;

    const cells = splitCells(rawLine);
    const value = (key: keyof EmployeeImportRow): string => {
      for (const [position, column] of byIndex) {
        if (column === key) return cells[position]?.trim() ?? '';
      }
      return '';
    };

    const employeeCode = value('employeeCode');
    const firstName = value('firstName');
    const rawJoining = value('dateOfJoining');
    const line = index + 1;

    if (employeeCode.length === 0 && firstName.length === 0 && rawJoining.length === 0) return;

    if (employeeCode.length === 0) {
      problems.push({ line, message: 'The row has no employee code.' });
      return;
    }
    if (firstName.length === 0) {
      problems.push({ line, message: `${employeeCode} has no first name.` });
      return;
    }

    const dateOfJoining = normaliseDate(rawJoining);
    if (dateOfJoining === null) {
      problems.push({
        line,
        message: `${employeeCode}: "${rawJoining}" is not a date. Write it as 2026-04-01 or 01-04-2026.`,
      });
      return;
    }

    const fieldStaff = value('isFieldStaff');
    const fieldProblem = fieldStaffProblem(fieldStaff);
    if (fieldProblem !== null) {
      problems.push({ line, message: `${employeeCode}: ${fieldProblem}` });
      return;
    }

    // Optional cells are omitted rather than sent empty: the shared row schema
    // turns an empty string into `undefined` anyway, and omitting keeps the
    // payload honest about what the file actually said.
    const optional = (key: keyof EmployeeImportRow): Record<string, string> => {
      const cell = value(key);
      return cell.length > 0 ? { [key]: cell } : {};
    };

    rows.push({
      employeeCode,
      firstName,
      dateOfJoining,
      ...optional('lastName'),
      ...optional('workEmail'),
      ...optional('personalEmail'),
      ...optional('mobile'),
      ...optional('employmentType'),
      ...optional('status'),
      ...optional('department'),
      ...optional('designation'),
      ...optional('location'),
      ...optional('reportingManagerCode'),
      ...optional('isFieldStaff'),
    } as EmployeeImportRow);
  });

  return { rows, problems, ignoredColumns, missingColumns };
}

/**
 * REQ-A-06: "errors downloadable as an annotated sheet."
 *
 * The original columns plus a Problems column, so the file can be corrected in
 * place and pasted straight back. Only the failing rows: a sheet that also
 * carried the rows that worked would be re-imported whole and every good row
 * would come back as a duplicate-code error.
 */
export function annotatedErrorSheet(
  rows: readonly EmployeeImportRow[],
  results: readonly { rowNumber: number; employeeCode: string; errors: readonly string[] }[],
): string {
  const escape = (value: string): string =>
    /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

  const header = [...IMPORT_COLUMNS.map((column) => column.header), 'Problems'];
  const lines = [header.map(escape).join(',')];

  for (const result of results) {
    if (result.errors.length === 0) continue;
    // `rowNumber` is 1-based over the rows sent, not over the pasted text.
    const row = rows[result.rowNumber - 1];
    if (row === undefined) continue;
    lines.push(
      [
        ...IMPORT_COLUMNS.map((column) => String(row[column.key] ?? '')),
        result.errors.join('; '),
      ]
        .map(escape)
        .join(','),
    );
  }

  return lines.join('\n');
}
