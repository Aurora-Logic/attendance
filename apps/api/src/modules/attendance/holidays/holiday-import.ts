import {
  HOLIDAY_IMPORT_ACTIONS,
  type HolidayImportAction,
  type HolidayImportRow,
  type HolidayImportRowResult,
} from '@vyuha/shared';

/**
 * REQ-H-04's bulk import, decided before anything is written.
 *
 * Pure: given the sheet and what the calendar already holds, it says what each
 * row would do. `/validate` returns the plan and stops; `/commit` returns the
 * same plan and then executes it. One function behind both is the only way the
 * preview can be trusted -- a separate "now actually do it" path would be free
 * to reach a different answer, and the reader would have approved the other one.
 */

export interface ExistingHoliday {
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly name: string;
  readonly restricted: boolean;
}

export interface PlannedImportRow extends HolidayImportRowResult {
  /** Set for UPDATE, so the caller writes to the row the plan looked at. */
  readonly existingId?: string;
}

export interface HolidayImportPlan {
  readonly rows: readonly PlannedImportRow[];
  readonly counts: Readonly<Record<HolidayImportAction, number>>;
}

export interface PlanImportInput {
  readonly rows: readonly HolidayImportRow[];
  readonly existing: readonly ExistingHoliday[];
  /** The calendar's year. A row outside it is a mis-filed sheet, not a holiday. */
  readonly year: number;
  readonly overwriteExisting: boolean;
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

export function planHolidayImport(input: PlanImportInput): HolidayImportPlan {
  const existingByDate = new Map(input.existing.map((holiday) => [holiday.date, holiday]));
  // Within one sheet a date may appear once. The first occurrence wins rather
  // than the last, so a re-run of the same file reports the same actions: "last
  // one wins" would make the outcome depend on row order for no stated reason.
  const seen = new Set<string>();
  const rows: PlannedImportRow[] = [];

  input.rows.forEach((row, index) => {
    const position = index + 1;
    const base = { row: position, date: row.date, name: row.name, restricted: row.restricted };

    if (yearOf(row.date) !== input.year) {
      rows.push({
        ...base,
        action: 'ERROR',
        message: `This calendar is for ${String(input.year)}; the row is dated ${row.date}.`,
      });
      return;
    }

    if (seen.has(row.date)) {
      rows.push({
        ...base,
        action: 'ERROR',
        message: 'The sheet lists this date more than once.',
      });
      return;
    }
    seen.add(row.date);

    const existing = existingByDate.get(row.date);
    if (existing === undefined) {
      rows.push({ ...base, action: 'CREATE' });
      return;
    }

    if (existing.name === row.name && existing.restricted === row.restricted) {
      rows.push({ ...base, action: 'UNCHANGED' });
      return;
    }

    if (!input.overwriteExisting) {
      rows.push({
        ...base,
        action: 'SKIPPED',
        message: `Already in this calendar as "${existing.name}". Turn on overwrite to replace it.`,
      });
      return;
    }

    rows.push({ ...base, action: 'UPDATE', existingId: existing.id });
  });

  return { rows, counts: countActions(rows) };
}

/**
 * Every action is present with a zero rather than only the ones that occurred.
 * A client reading `counts.ERROR` must not have to distinguish "none" from
 * "the key is missing", which is the shape that produces `undefined > 0`.
 */
export function countActions(
  rows: readonly HolidayImportRowResult[],
): Record<HolidayImportAction, number> {
  const counts = Object.fromEntries(
    HOLIDAY_IMPORT_ACTIONS.map((action) => [action, 0]),
  ) as Record<HolidayImportAction, number>;
  for (const row of rows) counts[row.action] += 1;
  return counts;
}

/** The dates a committed plan touches, for REQ-H-04's recompute. */
export function affectedDates(plan: HolidayImportPlan): string[] {
  const dates = new Set<string>();
  for (const row of plan.rows) {
    if (row.action === 'CREATE' || row.action === 'UPDATE') dates.add(row.date);
  }
  return [...dates].sort();
}
