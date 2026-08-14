import { describe, expect, it } from 'vitest';

import { employeeImportSchema } from '@vyuha/shared';

import {
  IMPORT_COLUMNS,
  TEMPLATE_EXAMPLE,
  annotatedErrorSheet,
  fieldStaffProblem,
  parseEmployeeSheet,
} from './import-rows';

/**
 * REQ-A-06. The cases here are the ones that turn a usable import into an
 * unusable one silently: columns in a different order, a name containing a
 * comma, a European CSV, a date read the wrong way round.
 */

const HEADER = 'Employee code\tFirst name\tLast name\tDate of joining\tDepartment';

describe('parseEmployeeSheet', () => {
  it('reads the template it hands out', () => {
    const parsed = parseEmployeeSheet(TEMPLATE_EXAMPLE);
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      employeeCode: 'VY-0101',
      firstName: 'Asha',
      lastName: 'Rao',
      dateOfJoining: '2026-04-01',
      department: 'Operations',
      reportingManagerCode: 'VY-0002',
    });
  });

  it('matches columns by name, in any order', () => {
    const parsed = parseEmployeeSheet(
      ['Date of joining\tFirst name\tEmployee code', '2026-04-01\tAsha\tVY-0101'].join('\n'),
    );
    expect(parsed.rows[0]).toMatchObject({
      employeeCode: 'VY-0101',
      firstName: 'Asha',
      dateOfJoining: '2026-04-01',
    });
  });

  it('accepts the spellings a real spreadsheet uses', () => {
    const parsed = parseEmployeeSheet(['code\tname\tDOJ', 'VY-0101\tAsha\t01-04-2026'].join('\n'));
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ employeeCode: 'VY-0101', firstName: 'Asha', dateOfJoining: '2026-04-01' });
  });

  it('reports the columns it ignored rather than dropping them silently', () => {
    const parsed = parseEmployeeSheet(
      ['Employee code\tFirst name\tDate of joining\tPAN\tBank', 'VY-0101\tAsha\t2026-04-01\tABCDE\tHDFC'].join('\n'),
    );
    expect(parsed.ignoredColumns).toEqual(['PAN', 'Bank']);
    expect(parsed.rows).toHaveLength(1);
  });

  it('refuses the whole file when a required column is missing', () => {
    // Parsing anyway would send a file of rows with no code and produce one
    // identical row error per line instead of one sentence naming the column.
    const parsed = parseEmployeeSheet(['First name\tDate of joining', 'Asha\t2026-04-01'].join('\n'));
    expect(parsed.missingColumns).toEqual(['Employee code']);
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems).toEqual([]);
  });

  it('reads day-first dates, the way an Indian spreadsheet writes them', () => {
    const parsed = parseEmployeeSheet([HEADER, 'VY-0101\tAsha\tRao\t03-04-2026\tOperations'].join('\n'));
    expect(parsed.rows[0]?.dateOfJoining).toBe('2026-04-03');
  });

  it('names the row and the cell when a date cannot be read', () => {
    const parsed = parseEmployeeSheet([HEADER, 'VY-0101\tAsha\tRao\tlast April\tOperations'].join('\n'));
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems[0]?.message).toContain('VY-0101');
    expect(parsed.problems[0]?.message).toContain('last April');
    expect(parsed.problems[0]?.line).toBe(2);
  });

  it('does not split a tab-separated line on a comma inside a cell', () => {
    // "Rao, Asha" in one cell is ordinary in an exported sheet, and splitting
    // on the comma would push the joining date into the wrong column.
    const parsed = parseEmployeeSheet(
      [HEADER, 'VY-0101\tAsha\tRao, the elder\t2026-04-01\tOperations'].join('\n'),
    );
    expect(parsed.rows[0]?.lastName).toBe('Rao, the elder');
  });

  it('reads a comma or semicolon separated line when there is no tab', () => {
    const comma = parseEmployeeSheet(
      ['Employee code,First name,Date of joining', 'VY-0101,Asha,2026-04-01'].join('\n'),
    );
    expect(comma.rows[0]?.employeeCode).toBe('VY-0101');

    const semicolon = parseEmployeeSheet(
      ['Employee code;First name;Date of joining', 'VY-0101;Asha;2026-04-01'].join('\n'),
    );
    expect(semicolon.rows[0]?.employeeCode).toBe('VY-0101');
  });

  it('skips blank lines and fully empty rows', () => {
    const parsed = parseEmployeeSheet(
      [HEADER, '', 'VY-0101\tAsha\tRao\t2026-04-01\tOperations', '\t\t\t\t', ''].join('\n'),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.problems).toEqual([]);
  });

  it('reports a row with a code but no name', () => {
    const parsed = parseEmployeeSheet([HEADER, 'VY-0101\t\tRao\t2026-04-01\tOperations'].join('\n'));
    expect(parsed.problems[0]?.message).toContain('no first name');
  });

  it('omits an optional cell that is empty rather than sending an empty string', () => {
    const parsed = parseEmployeeSheet([HEADER, 'VY-0101\tAsha\t\t2026-04-01\t'].join('\n'));
    expect(parsed.rows[0]).not.toHaveProperty('lastName');
    expect(parsed.rows[0]).not.toHaveProperty('department');
  });

  it('is empty for empty input rather than throwing', () => {
    expect(parseEmployeeSheet('')).toEqual({
      rows: [],
      problems: [],
      ignoredColumns: [],
      missingColumns: [],
    });
    expect(parseEmployeeSheet('   \n\n').rows).toEqual([]);
  });

  it('produces rows the shared import schema accepts', () => {
    // The whole point of parsing on this side is that the request the server
    // parses is well formed. If this ever fails, the preview is lying.
    const parsed = parseEmployeeSheet(TEMPLATE_EXAMPLE);
    expect(employeeImportSchema.safeParse({ rows: parsed.rows }).success).toBe(true);
  });
});

describe('fieldStaffProblem', () => {
  it('accepts the words a spreadsheet uses for yes and no', () => {
    for (const value of ['yes', 'Y', 'TRUE', '1', 'no', 'n', 'false', '0', '']) {
      expect(fieldStaffProblem(value)).toBeNull();
    }
  });

  it('names anything else, so the cell can be found', () => {
    expect(fieldStaffProblem('maybe')).toContain('maybe');
  });
});

describe('annotatedErrorSheet', () => {
  const rows = parseEmployeeSheet(
    [HEADER, 'VY-0101\tAsha\tRao\t2026-04-01\tOperations', 'VY-0102\tBhavna\tIyer\t2026-04-01\tNowhere'].join('\n'),
  ).rows;

  it('carries only the failing rows, with their problems', () => {
    const csv = annotatedErrorSheet(rows, [
      { rowNumber: 1, employeeCode: 'VY-0101', errors: [] },
      { rowNumber: 2, employeeCode: 'VY-0102', errors: ['No department named "Nowhere"'] },
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Problems');
    expect(lines[1]).toContain('VY-0102');
    expect(lines[1]).toContain('Nowhere');
    // Re-importing the good row would come back as a duplicate-code error,
    // so it must not be in the corrections file.
    expect(csv).not.toContain('VY-0101');
  });

  it('quotes a value containing a comma so the file still parses', () => {
    const csv = annotatedErrorSheet(rows, [
      { rowNumber: 1, employeeCode: 'VY-0101', errors: ['One problem, and another'] },
    ]);
    expect(csv).toContain('"One problem, and another"');
  });

  it('has a column for every column of the template', () => {
    const csv = annotatedErrorSheet(rows, [{ rowNumber: 1, employeeCode: 'VY-0101', errors: ['x'] }]);
    expect(csv.split('\n')[0]?.split(',')).toHaveLength(IMPORT_COLUMNS.length + 1);
  });

  it('ignores a result that names a row the file does not have', () => {
    expect(annotatedErrorSheet(rows, [{ rowNumber: 99, employeeCode: 'VY-9999', errors: ['x'] }]).split('\n')).toHaveLength(1);
  });
});
