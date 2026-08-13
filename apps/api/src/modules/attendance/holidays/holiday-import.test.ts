import { describe, expect, it } from 'vitest';

import { affectedDates, planHolidayImport, type ExistingHoliday } from './holiday-import.js';

/**
 * REQ-H-04's planner, which is the whole of the import's judgement. `/validate`
 * shows what it decided and `/commit` executes it, so every rule the reader is
 * shown before importing a year is one of the cases below.
 */

const EXISTING: ExistingHoliday[] = [
  { id: 'h-republic', date: '2026-01-26', name: 'Republic Day', restricted: false },
  { id: 'h-holi', date: '2026-03-04', name: 'Holi', restricted: true },
];

function plan(
  rows: { date: string; name: string; restricted?: boolean }[],
  options: { existing?: ExistingHoliday[]; overwriteExisting?: boolean; year?: number } = {},
) {
  return planHolidayImport({
    rows: rows.map((row) => ({ ...row, restricted: row.restricted ?? false })),
    existing: options.existing ?? EXISTING,
    year: options.year ?? 2026,
    overwriteExisting: options.overwriteExisting ?? false,
  });
}

describe('planHolidayImport (REQ-H-04)', () => {
  it('creates a date the calendar does not have', () => {
    const result = plan([{ date: '2026-08-15', name: 'Independence Day' }]);
    expect(result.rows[0]).toEqual({
      row: 1,
      date: '2026-08-15',
      name: 'Independence Day',
      restricted: false,
      action: 'CREATE',
    });
    expect(result.counts.CREATE).toBe(1);
  });

  it('reports a row identical to what is already there as UNCHANGED, not a write', () => {
    const result = plan([{ date: '2026-01-26', name: 'Republic Day' }]);
    expect(result.rows[0]?.action).toBe('UNCHANGED');
    expect(affectedDates(result)).toEqual([]);
  });

  it('skips a clash by default rather than overwriting an edit somebody made', () => {
    const result = plan([{ date: '2026-01-26', name: 'Republic Day (holiday)' }]);
    expect(result.rows[0]?.action).toBe('SKIPPED');
    expect(result.rows[0]?.message).toContain('Republic Day');
  });

  it('overwrites the clash when asked, and names the row it will write to', () => {
    const result = plan([{ date: '2026-01-26', name: 'Republic Day (holiday)' }], {
      overwriteExisting: true,
    });
    expect(result.rows[0]?.action).toBe('UPDATE');
    expect(result.rows[0]?.existingId).toBe('h-republic');
  });

  it('treats a changed restricted flag as a change even when the name matches', () => {
    const same = plan([{ date: '2026-03-04', name: 'Holi', restricted: true }]);
    expect(same.rows[0]?.action).toBe('UNCHANGED');

    const flipped = plan([{ date: '2026-03-04', name: 'Holi', restricted: false }], {
      overwriteExisting: true,
    });
    expect(flipped.rows[0]?.action).toBe('UPDATE');
  });

  it('rejects a row dated outside the calendar year', () => {
    const result = plan([{ date: '2025-12-25', name: 'Christmas' }]);
    expect(result.rows[0]?.action).toBe('ERROR');
    expect(result.rows[0]?.message).toContain('2026');
  });

  it('rejects the second copy of a date inside one sheet, keeping the first', () => {
    const result = plan([
      { date: '2026-08-15', name: 'Independence Day' },
      { date: '2026-08-15', name: 'Independence Day (again)' },
    ]);
    expect(result.rows.map((row) => row.action)).toEqual(['CREATE', 'ERROR']);
    expect(result.rows[1]?.message).toContain('more than once');
  });

  it('numbers rows from 1 so the message names the line the reader is looking at', () => {
    const result = plan([
      { date: '2026-08-15', name: 'Independence Day' },
      { date: '2020-01-01', name: 'Wrong year' },
    ]);
    expect(result.rows[1]?.row).toBe(2);
  });

  it('counts every action, including the ones that did not occur', () => {
    const result = plan([{ date: '2026-08-15', name: 'Independence Day' }]);
    expect(result.counts).toEqual({ CREATE: 1, UPDATE: 0, UNCHANGED: 0, SKIPPED: 0, ERROR: 0 });
  });

  it('reports only the dates a commit would move, deduplicated and sorted', () => {
    const result = plan(
      [
        { date: '2026-08-15', name: 'Independence Day' },
        { date: '2026-01-26', name: 'Republic Day (holiday)' },
        { date: '2026-03-04', name: 'Holi', restricted: true },
      ],
      { overwriteExisting: true },
    );
    expect(affectedDates(result)).toEqual(['2026-01-26', '2026-08-15']);
  });

  it('plans nothing for an empty sheet rather than throwing', () => {
    const result = plan([]);
    expect(result.rows).toEqual([]);
    expect(result.counts.CREATE).toBe(0);
  });
});
