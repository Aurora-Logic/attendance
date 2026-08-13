import {
  MAX_EXPORT_RANGE_DAYS,
  REPORT_DEFINITIONS,
  REPORT_KEYS,
  attendanceRegisterCell,
  defaultVisibleColumns,
  describeFilters,
  exportFileName,
  exportRequestSchema,
  isReportKey,
  punchAuditCell,
  rangeLengthInDays,
  reportRowQuerySchema,
  resolveColumns,
  savedViewInputSchema,
  sortableFields,
  type AttendanceRegisterSource,
  type PunchAuditSource,
} from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

/**
 * The report contract, which is shared between the screen and the exporter.
 *
 * Worth testing on its own because the whole design rests on one claim: the
 * cell the table renders and the cell the file writes come from the same
 * function. If these extractors drift from the column definitions, the
 * spreadsheet quietly disagrees with the screen and nothing fails.
 */

describe('the report catalogue', () => {
  it('gives every report a definition and every definition a default sort it can honour', () => {
    for (const key of REPORT_KEYS) {
      const definition = REPORT_DEFINITIONS[key];
      expect(definition.key).toBe(key);
      expect(definition.columns.length).toBeGreaterThan(0);

      const allowed = new Set(sortableFields(key));
      for (const term of definition.defaultSort.split(',')) {
        expect(allowed).toContain(term.replace(/^-/u, ''));
      }
    }
  });

  it('gives every column a unique key', () => {
    for (const key of REPORT_KEYS) {
      const keys = REPORT_DEFINITIONS[key].columns.map((column) => column.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  /**
   * The guard the design actually needs. A column whose key no extractor
   * understands renders as an empty cell everywhere, on screen and in the
   * file, and nothing anywhere reports it.
   */
  it('has an extractor for every column of every report', () => {
    const day: AttendanceRegisterSource = {
      employee: { name: 'Asha Menon' },
      employeeCode: 'E-001',
      date: '2026-08-01',
      status: 'PRESENT',
      shift: { name: 'General' },
      scheduledIn: '2026-08-01T03:30:00.000Z',
      scheduledOut: '2026-08-01T12:30:00.000Z',
      firstInAt: '2026-08-01T03:34:00.000Z',
      lastOutAt: '2026-08-01T12:41:00.000Z',
      workedMinutes: 487,
      breakMinutes: 30,
      otMinutes: 11,
      lateMinutes: 4,
      earlyExitMinutes: 0,
      flags: ['late'],
      isManualOverride: false,
      locked: true,
    };

    for (const column of REPORT_DEFINITIONS['attendance-register'].columns) {
      expect(
        attendanceRegisterCell(day, column.key),
        `no extractor for attendance-register column "${column.key}"`,
      ).not.toBeNull();
    }

    const punch: PunchAuditSource = {
      employee: { name: 'Asha Menon' },
      employeeCode: 'E-001',
      attendanceDate: '2026-08-01',
      type: 'IN',
      serverTime: '2026-08-01T03:34:00.000Z',
      clientTime: '2026-08-01T03:33:58.000Z',
      clockSkewSeconds: 2,
      syncDelaySeconds: 0,
      source: 'MOBILE',
      location: { latitude: 12.9716, longitude: 77.5946, accuracyM: 8, distanceFromGeofenceM: 14 },
      isHalfDayMarked: true,
      halfDayPart: 'FIRST_HALF',
      reason: 'Client site',
      flags: ['outside_geofence'],
    };

    for (const column of REPORT_DEFINITIONS['punch-audit'].columns) {
      expect(
        punchAuditCell(punch, column.key),
        `no extractor for punch-audit column "${column.key}"`,
      ).not.toBeNull();
    }
  });

  it('reads a coordinate pair as one cell and an absent location as empty', () => {
    const base: PunchAuditSource = {
      employee: { name: 'A' },
      employeeCode: 'E',
      attendanceDate: '2026-08-01',
      type: 'IN',
      serverTime: '2026-08-01T03:34:00.000Z',
      clientTime: null,
      clockSkewSeconds: null,
      syncDelaySeconds: null,
      source: 'WEB',
      location: null,
      isHalfDayMarked: false,
      halfDayPart: null,
      reason: null,
      flags: [],
    };
    expect(punchAuditCell(base, 'location')).toBeNull();
    expect(punchAuditCell(base, 'gpsAccuracyM')).toBeNull();
    expect(
      punchAuditCell(
        { ...base, location: { latitude: 12.9716, longitude: 77.5946, accuracyM: null, distanceFromGeofenceM: null } },
        'location',
      ),
    ).toBe('12.97160, 77.59460');
  });

  it('drops an unknown key rather than inventing a value', () => {
    const day = { flags: [] } as unknown as AttendanceRegisterSource;
    expect(attendanceRegisterCell(day, 'salary')).toBeNull();
  });
});

describe('column selection', () => {
  it('hides the default-hidden columns until they are asked for', () => {
    const visible = defaultVisibleColumns('attendance-register');
    expect(visible).toContain('status');
    expect(visible).not.toContain('locked');
  });

  it('keeps the report order regardless of the order the request lists', () => {
    // A saved view holding a shuffled list must not be able to reorder a sheet
    // somebody reads positionally.
    const resolved = resolveColumns('attendance-register', ['status', 'date', 'employeeCode']);
    expect(resolved.map((column) => column.key)).toEqual(['date', 'employeeCode', 'status']);
  });

  it('ignores an unknown column instead of refusing the whole export', () => {
    const resolved = resolveColumns('attendance-register', ['date', 'leaveTypeThatDoesNotExist']);
    expect(resolved.map((column) => column.key)).toEqual(['date']);
  });

  it('falls back to the defaults when a selection resolves to nothing', () => {
    // Otherwise a stale saved view produces a file with a header row and no
    // columns, which reads as an export that silently failed.
    expect(resolveColumns('attendance-register', ['nothing-real'])).toEqual(
      resolveColumns('attendance-register', undefined),
    );
    expect(resolveColumns('attendance-register', []).length).toBeGreaterThan(0);
  });
});

describe('the filter caption block', () => {
  it('names the ids it was given labels for and falls back to the id otherwise', () => {
    const captions = describeFilters(
      { from: '2026-08-01', to: '2026-08-31', departmentId: 'dept-1', employeeId: 'emp-9' },
      { 'dept-1': 'Production' },
    );
    expect(captions).toContainEqual({ label: 'Period', value: '2026-08-01 to 2026-08-31' });
    expect(captions).toContainEqual({ label: 'Department', value: 'Production' });
    expect(captions).toContainEqual({ label: 'Employee', value: 'emp-9' });
  });

  it('says "none" rather than printing an empty block', () => {
    expect(describeFilters({})).toEqual([{ label: 'Filters', value: 'none' }]);
  });
});

describe('the export request', () => {
  const valid = {
    reportKey: 'attendance-register',
    filters: { from: '2026-08-01', to: '2026-08-31' },
  };

  it('accepts a bounded period and defaults the format', () => {
    const parsed = exportRequestSchema.parse(valid);
    expect(parsed.format).toBe('CSV');
  });

  it('refuses a period that ends before it starts', () => {
    const result = exportRequestSchema.safeParse({
      ...valid,
      filters: { from: '2026-08-31', to: '2026-08-01' },
    });
    expect(result.success).toBe(false);
  });

  it(`refuses a period longer than ${String(MAX_EXPORT_RANGE_DAYS)} days`, () => {
    expect(
      exportRequestSchema.safeParse({
        ...valid,
        filters: { from: '2020-01-01', to: '2026-01-01' },
      }).success,
    ).toBe(false);
  });

  it('requires a period at all, unlike the on-screen filter', () => {
    expect(exportRequestSchema.safeParse({ ...valid, filters: {} }).success).toBe(false);
    expect(reportRowQuerySchema.safeParse({}).success).toBe(true);
  });

  it('refuses a format nothing can write yet', () => {
    // XLSX is declared in the contract and is not offerable, so a client
    // cannot ask for a file this build would produce as CSV under an .xlsx
    // name.
    expect(exportRequestSchema.safeParse({ ...valid, format: 'XLSX' }).success).toBe(false);
  });

  it('refuses an unknown report', () => {
    expect(exportRequestSchema.safeParse({ ...valid, reportKey: 'payroll-input' }).success).toBe(
      false,
    );
    expect(isReportKey('payroll-input')).toBe(false);
  });
});

describe('period arithmetic', () => {
  it('counts both ends of the range', () => {
    expect(rangeLengthInDays('2026-08-01', '2026-08-01')).toBe(1);
    expect(rangeLengthInDays('2026-08-01', '2026-08-31')).toBe(31);
    // Across a leap day, which a naive month-difference gets wrong.
    expect(rangeLengthInDays('2024-02-28', '2024-03-01')).toBe(3);
  });

  it('returns null for a date it cannot read', () => {
    expect(rangeLengthInDays('not-a-date', '2026-08-31')).toBeNull();
  });
});

describe('the produced filename', () => {
  it('is sortable, has no spaces, and carries the format', () => {
    expect(exportFileName('attendance-register', new Date('2026-08-13T09:30:00.000Z'), 'CSV')).toBe(
      'attendance-register-2026-08-13-0930.csv',
    );
  });
});

describe('a saved view', () => {
  it('defaults its config so an empty view is still usable', () => {
    const parsed = savedViewInputSchema.parse({
      reportKey: 'punch-audit',
      name: '  Last week  ',
      config: {},
    });
    expect(parsed.name).toBe('Last week');
    expect(parsed.isShared).toBe(false);
    expect(parsed.config).toEqual({ filters: {}, columns: [] });
  });

  it('refuses a nameless view', () => {
    expect(
      savedViewInputSchema.safeParse({ reportKey: 'punch-audit', name: '   ', config: {} }).success,
    ).toBe(false);
  });
});
