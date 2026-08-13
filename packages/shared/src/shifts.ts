import { z } from 'zod';

import { pageQuerySchema } from './pagination.js';

/**
 * Shift masters, weekly-off patterns and rosters (REQ-C-01 to REQ-C-06).
 *
 * Owned by one slice. The barrel already exports this file, so the slice
 * that fills it in never has to touch index.ts and cannot race another.
 *
 * Here rather than in the API for the reason `org.ts` gives: the server parses
 * every request with these schemas and the roster screen builds its forms from
 * the same types, so the two cannot drift into a field one end sends and the
 * other silently discards.
 */

// ------------------------------------------------------------------ shifts

/**
 * The nine numbers from REQ-C-01's table, nested rather than flattened onto
 * the shift.
 *
 * They are one thing -- the rule set that turns punches into a day -- and
 * flattening them would make a shift a bag of eighteen fields where half are
 * identity and half are arithmetic, with no natural grouping for the form that
 * edits them.
 */
export interface ShiftPolicy {
  /** Earliest an IN punch is accepted before scheduled in. */
  readonly graceInBefore: number;
  /** Latest an IN punch is accepted after scheduled in. */
  readonly graceInAfter: number;
  /** Past this, the day is flagged Late. */
  readonly lateAfter: number;
  /** Earliest an OUT punch is accepted before scheduled out. */
  readonly graceOutBefore: number;
  /** Latest an OUT punch is accepted after scheduled out. */
  readonly graceOutAfter: number;
  /** Leaving earlier than this flags Early exit. */
  readonly earlyExitBefore: number;
  /** Below this the day is Absent. */
  readonly minHalfDayMinutes: number;
  /** Below this, but above half day, the day is Half day. */
  readonly minFullDayMinutes: number;
  /** Minutes past scheduled out that start counting as overtime. */
  readonly otAfterMinutes: number;
}

export interface ShiftSummary {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  /**
   * Wall-clock `HH:mm`, not an instant. A shift starts at 09:00 in the
   * office's timezone whatever the date; turning that into an instant needs
   * the date and is the day engine's job.
   */
  readonly scheduledIn: string;
  readonly scheduledOut: string;
  readonly breakMinutes: number;
  /** REQ-C-02: the day is attributed to the shift start date, not the OUT date. */
  readonly crossesMidnight: boolean;
  readonly isActive: boolean;
  readonly policy: ShiftPolicy;
}

/** REQ-C-01's stated defaults, so the create form and the server agree. */
export const SHIFT_POLICY_DEFAULTS: ShiftPolicy = {
  graceInBefore: 30,
  graceInAfter: 10,
  lateAfter: 10,
  graceOutBefore: 10,
  graceOutAfter: 120,
  earlyExitBefore: 10,
  minHalfDayMinutes: 240,
  minFullDayMinutes: 480,
  otAfterMinutes: 30,
};

/** The labels and help text the edit form prints, beside the contract they describe. */
export const SHIFT_POLICY_FIELDS: readonly {
  readonly key: keyof ShiftPolicy;
  readonly label: string;
  readonly help: string;
}[] = [
  {
    key: 'graceInBefore',
    label: 'Grace in, before',
    help: 'Earliest an IN punch is accepted before scheduled in.',
  },
  {
    key: 'graceInAfter',
    label: 'Grace in, after',
    help: 'Latest an IN punch is accepted after scheduled in.',
  },
  { key: 'lateAfter', label: 'Late after', help: 'Past this, the day is flagged Late.' },
  {
    key: 'graceOutBefore',
    label: 'Grace out, before',
    help: 'Earliest an OUT punch is accepted before scheduled out.',
  },
  {
    key: 'graceOutAfter',
    label: 'Grace out, after',
    help: 'Latest an OUT punch is accepted after scheduled out.',
  },
  {
    key: 'earlyExitBefore',
    label: 'Early exit before',
    help: 'Leaving earlier than this flags Early exit.',
  },
  {
    key: 'minHalfDayMinutes',
    label: 'Minimum half day',
    help: 'Below this the day is Absent.',
  },
  {
    key: 'minFullDayMinutes',
    label: 'Minimum full day',
    help: 'Below this, but above half day, the day is Half day.',
  },
  {
    key: 'otAfterMinutes',
    label: 'Overtime after',
    help: 'Minutes past scheduled out that start counting as overtime.',
  },
];

/**
 * `HH:mm`, 24-hour.
 *
 * Seconds are rejected rather than truncated. The column is a `time`, so
 * Postgres would happily keep `09:00:30`, and a shift boundary half a minute
 * off the hour is invisible in every screen that prints `HH:mm` while still
 * deciding whether somebody was late.
 */
const clockField = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'must be a 24-hour HH:mm time');

/** The same rules as the other masters (`org.ts`): printed on every report. */
const codeField = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u,
    'may contain letters, digits, dot, underscore, slash and hyphen',
  );

const nameField = z.string().trim().min(1).max(120);

/**
 * A whole number of minutes inside one day.
 *
 * The upper bound is not decoration: these are added to and subtracted from a
 * shift boundary, and a grace window of a year would accept a punch from any
 * date at all.
 */
const minutesField = z.number().int().min(0).max(1440);

export const shiftPolicySchema = z.object({
  graceInBefore: minutesField,
  graceInAfter: minutesField,
  lateAfter: minutesField,
  graceOutBefore: minutesField,
  graceOutAfter: minutesField,
  earlyExitBefore: minutesField,
  minHalfDayMinutes: minutesField,
  minFullDayMinutes: minutesField,
  otAfterMinutes: minutesField,
});

/**
 * A half-day threshold above the full-day threshold makes HALF_DAY
 * unreachable, and the mistake is invisible until somebody reads a month of
 * wrong musters -- REQ-E-02 resolves PRESENT before HALF_DAY, so the engine
 * cannot detect it either. Postgres enforces the same rule
 * (`shifts_day_thresholds_ordered`); this one exists so the form can say which
 * field is wrong instead of surfacing a constraint name.
 */
function assertThresholdsOrdered(
  policy: { minHalfDayMinutes?: number | undefined; minFullDayMinutes?: number | undefined } | undefined,
  ctx: z.RefinementCtx,
): void {
  if (policy === undefined) return;
  const { minHalfDayMinutes, minFullDayMinutes } = policy;
  if (minHalfDayMinutes === undefined || minFullDayMinutes === undefined) return;
  if (minHalfDayMinutes <= minFullDayMinutes) return;
  ctx.addIssue({
    code: 'custom',
    path: ['policy', 'minHalfDayMinutes'],
    message: 'must not be greater than the minimum full day, or Half day can never be reached',
  });
}

/**
 * A shift that ends before it starts is a night shift, and REQ-C-02 attributes
 * a night shift to its start date -- which only happens when the flag is set.
 * Without this the day engine computes a negative-length window and every
 * punch on that shift is judged against nonsense.
 */
function assertScheduleOrdered(
  value: {
    scheduledIn?: string | undefined;
    scheduledOut?: string | undefined;
    crossesMidnight?: boolean | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const { scheduledIn, scheduledOut } = value;
  if (scheduledIn === undefined || scheduledOut === undefined) return;
  if (value.crossesMidnight === true) return;
  if (scheduledOut > scheduledIn) return;
  ctx.addIssue({
    code: 'custom',
    path: ['scheduledOut'],
    message:
      scheduledOut === scheduledIn
        ? 'must differ from scheduled in'
        : 'is before scheduled in; tick "crosses midnight" for a night shift',
  });
}

const shiftShape = {
  name: nameField,
  code: codeField,
  scheduledIn: clockField,
  scheduledOut: clockField,
  breakMinutes: minutesField,
  crossesMidnight: z.boolean(),
  isActive: z.boolean(),
  policy: shiftPolicySchema,
};

/**
 * `crossesMidnight`, `isActive` and `policy` default rather than being
 * required: REQ-C-01 states a default for every policy field, and a create
 * form that made the caller restate all nine would be nine chances to fat-finger
 * a threshold the engine then applies to everybody on that shift.
 */
export const createShiftSchema = z
  .object({
    ...shiftShape,
    crossesMidnight: z.boolean().default(false),
    isActive: z.boolean().default(true),
    policy: shiftPolicySchema.partial().default({}),
  })
  .superRefine((value, ctx) => {
    assertScheduleOrdered(value, ctx);
    assertThresholdsOrdered({ ...SHIFT_POLICY_DEFAULTS, ...value.policy }, ctx);
  });

export type CreateShiftInput = z.infer<typeof createShiftSchema>;

/**
 * Partial, and the schedule check therefore runs on whatever arrived. A PATCH
 * that moves only `scheduledOut` past midnight cannot be judged from the body
 * alone, so the service re-checks the merged row before writing -- this catches
 * the cases the body already settles.
 */
export const updateShiftSchema = z
  .object({ ...shiftShape, policy: shiftPolicySchema.partial() })
  .partial()
  .superRefine((value, ctx) => {
    assertScheduleOrdered(value, ctx);
    assertThresholdsOrdered(value.policy, ctx);
  });

export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

export const SHIFT_SORT_FIELDS = ['name', 'code', 'scheduledIn'] as const;
export const DEFAULT_SHIFT_SORT = 'name';

export const shiftListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
  sort: z.string().max(200).optional(),
  /**
   * Deactivated shifts are hidden by default. They cannot be deleted while an
   * attendance day or a roster row points at them (REQ-M-04, and the foreign
   * keys are RESTRICT), so the list would otherwise fill with history.
   */
  includeInactive: z.stringbool().default(false),
});

export type ShiftListQuery = z.infer<typeof shiftListQuerySchema>;

// --------------------------------------------------------- weekly offs

/**
 * REQ-C-03, and 05-decisions: "Admin ticks the off days, alternate-Saturday
 * rule as a toggle, per-person override available. Nothing hardcoded."
 *
 * This is the same shape the day engine validates on read
 * (`weeklyOffConfigSchema` in `weekly-off.ts`); `weekly-off-parity.test.ts`
 * fails if the two ever disagree about what is acceptable.
 */
export const weeklyOffPatternConfigSchema = z
  .object({
    /** ISO-8601 weekdays that are always off. 1 = Monday, 7 = Sunday. */
    weekdays: z.array(z.number().int().min(1).max(7)).max(7),
    /**
     * Which occurrences of Saturday in the month are off, 1-5. REQ-C-03's
     * "alternate Saturdays (2nd/4th)" is `[2, 4]`. Absent or empty means the
     * rule is off, which is not the same as every Saturday being off -- that
     * is `weekdays: [6]`.
     */
    saturdaysOfMonth: z.array(z.number().int().min(1).max(5)).max(5).optional(),
  })
  .strict();

export type WeeklyOffPatternConfig = z.infer<typeof weeklyOffPatternConfigSchema>;

export interface WeeklyOffPatternSummary {
  readonly id: string;
  readonly name: string;
  readonly config: WeeklyOffPatternConfig;
  /** How many employees name this pattern directly (REQ-C-03's employee level). */
  readonly employeeCount: number;
}

export const createWeeklyOffPatternSchema = z.object({
  name: nameField,
  config: weeklyOffPatternConfigSchema,
});

export type CreateWeeklyOffPatternInput = z.infer<typeof createWeeklyOffPatternSchema>;

export const updateWeeklyOffPatternSchema = z
  .object({ name: nameField, config: weeklyOffPatternConfigSchema })
  .partial();

export type UpdateWeeklyOffPatternInput = z.infer<typeof updateWeeklyOffPatternSchema>;

export const weeklyOffPatternListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
});

export type WeeklyOffPatternListQuery = z.infer<typeof weeklyOffPatternListQuerySchema>;

/** ISO-8601 weekday names, indexed by the numbers stored in `weekdays`. */
export const ISO_WEEKDAY_LABELS: Readonly<Record<number, string>> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

/** One line describing a pattern, so the table and the form cannot word it differently. */
export function describeWeeklyOffPattern(config: WeeklyOffPatternConfig): string {
  const days = [...config.weekdays]
    .sort((left, right) => left - right)
    .map((day) => ISO_WEEKDAY_LABELS[day] ?? String(day));

  const saturdays = config.saturdaysOfMonth ?? [];
  if (saturdays.length > 0) {
    const ordinals = [...saturdays].sort((left, right) => left - right).map(ordinal).join(', ');
    days.push(`${ordinals} Saturday`);
  }

  return days.length === 0 ? 'No weekly off' : days.join(', ');
}

function ordinal(value: number): string {
  if (value === 1) return '1st';
  if (value === 2) return '2nd';
  if (value === 3) return '3rd';
  return `${String(value)}th`;
}

// ----------------------------------------------------------------- roster

export interface RosterEmployeeRef {
  readonly id: string;
  readonly name: string;
  readonly employeeCode: string;
}

export interface RosterShiftRef {
  readonly id: string;
  readonly name: string;
  readonly code: string;
}

export interface RosterAssignment {
  readonly id: string;
  readonly employee: RosterEmployeeRef;
  readonly shift: RosterShiftRef;
  /** Date-only `YYYY-MM-DD`, inclusive. */
  readonly from: string;
  /** Null means open-ended, until a later assignment supersedes it. */
  readonly to: string | null;
  readonly department: string | null;
}

const dateField = z.iso.date();

export const createRosterAssignmentSchema = z
  .object({
    employeeId: z.uuid(),
    shiftId: z.uuid(),
    from: dateField,
    /** Null is the normal case for a standing assignment. */
    to: dateField.nullish(),
  })
  .refine((value) => value.to == null || value.to >= value.from, {
    path: ['to'],
    message: 'must not be before the start date',
  });

export type CreateRosterAssignmentInput = z.infer<typeof createRosterAssignmentSchema>;

/**
 * The employee is not editable. Moving an assignment to a different person is
 * two facts changing at once -- one roster ends, another begins -- and doing it
 * as an update would silently rewrite history for both of them.
 */
export const updateRosterAssignmentSchema = z
  .object({ shiftId: z.uuid(), from: dateField, to: dateField.nullable() })
  .partial()
  .refine((value) => value.to == null || value.from === undefined || value.to >= value.from, {
    path: ['to'],
    message: 'must not be before the start date',
  });

export type UpdateRosterAssignmentInput = z.infer<typeof updateRosterAssignmentSchema>;

export const ROSTER_SORT_FIELDS = ['employeeCode', 'name', 'from'] as const;
export const DEFAULT_ROSTER_SORT = 'employeeCode';

export const rosterListQuerySchema = pageQuerySchema
  .extend({
    /** The period the list covers. An assignment is kept if it overlaps it. */
    from: dateField,
    to: dateField,
    employeeId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    locationId: z.uuid().optional(),
    shiftId: z.uuid().optional(),
    q: z.string().trim().min(1).max(80).optional(),
    sort: z.string().max(200).optional(),
  })
  .refine((value) => value.to >= value.from, {
    path: ['to'],
    message: 'must not be before the start of the period',
  });

export type RosterListQuery = z.infer<typeof rosterListQuerySchema>;

// ------------------------------------------------------------ bulk roster

/**
 * REQ-C-05: "pick a department/location + date range + shift, preview the
 * affected employee-days, confirm."
 *
 * `preview` is the whole point of the requirement, so it is the default: a
 * caller that forgets the field gets the harmless answer rather than several
 * hundred roster rows.
 */
export const bulkRosterAssignmentSchema = z
  .object({
    shiftId: z.uuid(),
    from: dateField,
    to: dateField,
    departmentId: z.uuid().optional(),
    locationId: z.uuid().optional(),
    /** Narrows the department/location selection to named people. */
    employeeIds: z.array(z.uuid()).max(1000).optional(),
    preview: z.boolean().default(true),
  })
  .refine((value) => value.to >= value.from, {
    path: ['to'],
    message: 'must not be before the start date',
  })
  .refine(
    (value) =>
      value.departmentId !== undefined ||
      value.locationId !== undefined ||
      (value.employeeIds !== undefined && value.employeeIds.length > 0),
    {
      path: ['departmentId'],
      // An unfiltered bulk assign would roster the entire organisation from a
      // form where nothing was chosen, which is the one mistake this endpoint
      // must not make easy.
      message: 'pick a department, a location, or at least one employee',
    },
  );

export type BulkRosterAssignmentInput = z.infer<typeof bulkRosterAssignmentSchema>;

/** Why one employee in the selection cannot be assigned this range. */
export interface RosterConflict {
  readonly assignmentId: string;
  readonly shift: RosterShiftRef;
  readonly from: string;
  readonly to: string | null;
}

export interface RosterBulkTarget {
  readonly employee: RosterEmployeeRef;
  readonly department: string | null;
  /** Null when the range is free and the assignment would be written. */
  readonly conflict: RosterConflict | null;
}

export interface RosterBulkPreview {
  readonly shift: RosterShiftRef;
  readonly from: string;
  readonly to: string;
  /** Calendar days in the range, inclusive at both ends. */
  readonly days: number;
  readonly assignable: number;
  readonly blocked: number;
  /** `assignable * days` -- what REQ-C-05 calls the affected employee-days. */
  readonly employeeDays: number;
  readonly targets: readonly RosterBulkTarget[];
  /** True for the dry run; false once the rows were written. */
  readonly preview: boolean;
  /** Rows written. Zero on a preview. */
  readonly created: number;
  /** Attendance days recomputed afterwards (REQ-C-06). Zero on a preview. */
  readonly recomputed: number;
}

/**
 * The ceiling on a single bulk commit, counted in employee-days that already
 * have a computed attendance row.
 *
 * REQ-C-06 makes a roster change recompute the days it touches, and the engine
 * computes one employee-day per round trip. Five hundred people moved across a
 * closed quarter is tens of thousands of recomputes inside one HTTP request:
 * it would not finish, and the half of it that did would be indistinguishable
 * from a success. Refusing with the number is the honest answer.
 */
export const MAX_BULK_RECOMPUTE_EMPLOYEE_DAYS = 2000;
