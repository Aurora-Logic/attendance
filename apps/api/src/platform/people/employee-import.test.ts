import { describe, expect, it } from 'vitest';

import type { EmployeeImportRow } from '@vyuha/shared';

import { countImportActions, planEmployeeImport, type ImportLookups } from './employee-import.js';

/**
 * REQ-A-06 and the half of REQ-A-07 a single create cannot reach.
 *
 * The planner is pure, so every case here is the real function against real
 * input — no database, no harness, and no way for a passing test to be
 * measuring something adjacent to what it names.
 */

const EMPTY: ImportLookups = {
  departments: new Map(),
  designations: new Map(),
  locations: new Map(),
  employeesByCode: new Map(),
  managerEdges: new Map(),
};

function lookups(overrides: Partial<ImportLookups> = {}): ImportLookups {
  return { ...EMPTY, ...overrides };
}

function row(overrides: Partial<EmployeeImportRow> = {}): EmployeeImportRow {
  return {
    employeeCode: 'VY-1001',
    firstName: 'Asha',
    lastName: undefined,
    workEmail: undefined,
    personalEmail: undefined,
    mobile: undefined,
    dateOfJoining: '2026-01-05',
    employmentType: undefined,
    status: undefined,
    department: undefined,
    designation: undefined,
    location: undefined,
    reportingManagerCode: undefined,
    isFieldStaff: undefined,
    ...overrides,
  };
}

describe('planning an employee import (REQ-A-06)', () => {
  it('plans a bare row and applies the documented defaults', () => {
    const plan = planEmployeeImport([row()], lookups());

    expect(plan.results).toEqual([
      { rowNumber: 1, employeeCode: 'VY-1001', action: 'CREATE', errors: [] },
    ]);
    expect(plan.creatable[0]).toMatchObject({
      employmentType: 'PERMANENT',
      status: 'ACTIVE',
      isFieldStaff: false,
      departmentId: null,
      reportingManagerId: null,
    });
  });

  it('numbers rows from one, the way the spreadsheet does', () => {
    const plan = planEmployeeImport(
      [row({ employeeCode: 'VY-1' }), row({ employeeCode: 'VY-2' })],
      lookups(),
    );
    expect(plan.results.map((r) => r.rowNumber)).toEqual([1, 2]);
  });

  it('reports every problem with a row, not only the first', () => {
    const plan = planEmployeeImport(
      [row({ status: 'RETIRED', department: 'Nowhere', isFieldStaff: 'perhaps' })],
      lookups(),
    );

    const [result] = plan.results;
    expect(result?.action).toBe('ERROR');
    // Three independent faults; a planner that returned after the first would
    // make somebody upload the same sheet three times to learn all of them.
    expect(result?.errors).toHaveLength(3);
    expect(plan.creatable).toHaveLength(0);
  });

  it('refuses a code that already exists', () => {
    const plan = planEmployeeImport(
      [row({ employeeCode: 'VY-0001' })],
      lookups({ employeesByCode: new Map([['VY-0001', 'id-1']]) }),
    );
    expect(plan.results[0]?.errors[0]).toContain('already exists');
  });

  it('refuses a code repeated inside the same file', () => {
    const plan = planEmployeeImport(
      [row({ employeeCode: 'VY-9' }), row({ employeeCode: 'VY-9' })],
      lookups(),
    );

    // The first occurrence is fine; only the repeat is the mistake.
    expect(plan.results[0]?.action).toBe('CREATE');
    expect(plan.results[1]?.errors[0]).toContain('more than once');
  });

  it('matches a code case-insensitively when deciding it is a repeat', () => {
    const plan = planEmployeeImport(
      [row({ employeeCode: 'vy-9' }), row({ employeeCode: 'VY-9' })],
      lookups(),
    );
    expect(plan.results[1]?.action).toBe('ERROR');
  });

  it('resolves department, designation and location by name, ignoring case', () => {
    const plan = planEmployeeImport(
      [row({ department: '  Operations ', designation: 'FITTER', location: 'head office' })],
      lookups({
        departments: new Map([['operations', 'dept-1']]),
        designations: new Map([['fitter', 'desig-1']]),
        locations: new Map([['head office', 'loc-1']]),
      }),
    );

    expect(plan.creatable[0]).toMatchObject({
      departmentId: 'dept-1',
      designationId: 'desig-1',
      locationId: 'loc-1',
    });
  });

  it('names the value it could not resolve', () => {
    const plan = planEmployeeImport([row({ location: 'Mars' })], lookups());
    expect(plan.results[0]?.errors[0]).toContain('Mars');
  });

  it('reads the spellings a spreadsheet actually contains for a flag', () => {
    for (const [text, expected] of [
      ['Yes', true],
      ['TRUE', true],
      ['1', true],
      ['no', false],
      ['FALSE', false],
      ['0', false],
    ] as const) {
      const plan = planEmployeeImport([row({ isFieldStaff: text })], lookups());
      expect(plan.creatable[0]?.isFieldStaff, text).toBe(expected);
    }
  });
});

describe('reporting lines in an import (REQ-A-07)', () => {
  it('links a manager who already exists', () => {
    const plan = planEmployeeImport(
      [row({ reportingManagerCode: 'VY-0003' })],
      lookups({ employeesByCode: new Map([['VY-0003', 'mgr-id']]) }),
    );
    expect(plan.creatable[0]).toMatchObject({
      reportingManagerId: 'mgr-id',
      reportingManagerCode: null,
    });
  });

  it('defers a manager who is elsewhere in the same file', () => {
    const plan = planEmployeeImport(
      [
        row({ employeeCode: 'VY-A', reportingManagerCode: 'VY-B' }),
        row({ employeeCode: 'VY-B' }),
      ],
      lookups(),
    );

    // The manager has no id yet, so the row carries the code and the service
    // links it after both are inserted.
    expect(plan.results.every((r) => r.action === 'CREATE')).toBe(true);
    expect(plan.creatable[0]).toMatchObject({
      reportingManagerId: null,
      reportingManagerCode: 'VY-B',
    });
  });

  it('refuses a manager who is neither in the file nor in the database', () => {
    const plan = planEmployeeImport([row({ reportingManagerCode: 'VY-GHOST' })], lookups());
    expect(plan.results[0]?.errors[0]).toContain('VY-GHOST');
  });

  it('refuses an employee reporting to themselves', () => {
    const plan = planEmployeeImport(
      [row({ employeeCode: 'VY-7', reportingManagerCode: 'VY-7' })],
      lookups(),
    );
    expect(plan.results[0]?.errors[0]).toContain('themselves');
  });

  it('refuses a two-row loop, which neither row is wrong on its own', () => {
    const plan = planEmployeeImport(
      [
        row({ employeeCode: 'VY-A', reportingManagerCode: 'VY-B' }),
        row({ employeeCode: 'VY-B', reportingManagerCode: 'VY-A' }),
      ],
      lookups(),
    );

    // This is the case the single-create path cannot see: a new employee has no
    // subordinates, so on its own neither row closes anything.
    expect(plan.results.some((r) => r.action === 'ERROR')).toBe(true);
    expect(plan.results.filter((r) => r.action === 'CREATE')).toHaveLength(0);
  });

  it('refuses a loop that only closes through somebody already in the database', () => {
    // Existing: VY-OLD reports to VY-NEW. The file adds VY-NEW reporting to
    // VY-OLD. Neither half is visible without the other.
    const plan = planEmployeeImport(
      [row({ employeeCode: 'VY-NEW', reportingManagerCode: 'VY-OLD' })],
      lookups({
        employeesByCode: new Map([['VY-OLD', 'old-id']]),
        managerEdges: new Map([['VY-OLD', 'VY-NEW']]),
      }),
    );
    expect(plan.results[0]?.errors[0]).toContain('loop');
  });

  it('accepts a deep chain that does not close', () => {
    const plan = planEmployeeImport(
      [
        row({ employeeCode: 'VY-A', reportingManagerCode: 'VY-B' }),
        row({ employeeCode: 'VY-B', reportingManagerCode: 'VY-C' }),
        row({ employeeCode: 'VY-C' }),
      ],
      lookups(),
    );
    // Guards the cycle check against the lazy implementation that calls any
    // chain longer than one a loop.
    expect(plan.results.every((r) => r.action === 'CREATE')).toBe(true);
  });

  it('terminates on a cycle that already exists in the database', () => {
    // Should be impossible, and this runs against real data. Without the
    // visited set the walk never returns and the request hangs rather than
    // answering.
    const plan = planEmployeeImport(
      [row({ employeeCode: 'VY-NEW', reportingManagerCode: 'VY-X' })],
      lookups({
        employeesByCode: new Map([
          ['VY-X', 'x'],
          ['VY-Y', 'y'],
        ]),
        managerEdges: new Map([
          ['VY-X', 'VY-Y'],
          ['VY-Y', 'VY-X'],
        ]),
      }),
    );
    expect(plan.results).toHaveLength(1);
  });
});

describe('counting a plan', () => {
  it('counts each action', () => {
    const plan = planEmployeeImport(
      [row({ employeeCode: 'VY-1' }), row({ employeeCode: 'VY-2', status: 'NONSENSE' })],
      lookups(),
    );
    expect(countImportActions(plan.results)).toEqual({ CREATE: 1, ERROR: 1 });
  });
});
