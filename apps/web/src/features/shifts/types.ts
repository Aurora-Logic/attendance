import { z } from 'zod';

import type { Paginated } from '@vyuha/shared';

/**
 * Shift masters and rosters (REQ-C-01, REQ-C-04) as this client reads them.
 *
 * The nine policy fields are nested under `policy` rather than flattened onto
 * the shift, because they are one thing: the rule set that turns punches into
 * a day. Flattening them would make a shift a bag of eighteen fields where
 * half are identity and half are arithmetic, and the edit form would have no
 * natural grouping to follow.
 */

export interface ShiftPolicy {
  /** Earliest an IN punch is accepted before scheduled in. */
  graceInBefore: number;
  /** Latest an IN punch is accepted after scheduled in. */
  graceInAfter: number;
  /** Past this, the day is flagged Late. */
  lateAfter: number;
  graceOutBefore: number;
  graceOutAfter: number;
  /** Leaving earlier than this flags Early exit. */
  earlyExitBefore: number;
  /** Below this the day is Absent. */
  minHalfDayMinutes: number;
  /** Below this, but above half day, the day is Half day. */
  minFullDayMinutes: number;
  /** Minutes past scheduled out that start counting as overtime. */
  otAfterMinutes: number;
}

export interface Shift {
  id: string;
  name: string;
  code: string;
  /** Wall-clock `HH:mm`. */
  scheduledIn: string;
  scheduledOut: string;
  breakMinutes: number;
  /** REQ-C-02: a night shift is attributed to its start date. */
  crossesMidnight: boolean;
  policy: ShiftPolicy;
}

export interface RosterEntry {
  id: string;
  employee: { id: string; name: string; employeeCode: string };
  shift: { id: string; name: string; code: string };
  /** Date-only `YYYY-MM-DD`. */
  from: string;
  /** Null means open-ended, until a later assignment supersedes it. */
  to: string | null;
  department: string | null;
}

const shiftPolicySchema: z.ZodType<ShiftPolicy> = z.object({
  graceInBefore: z.number(),
  graceInAfter: z.number(),
  lateAfter: z.number(),
  graceOutBefore: z.number(),
  graceOutAfter: z.number(),
  earlyExitBefore: z.number(),
  minHalfDayMinutes: z.number(),
  minFullDayMinutes: z.number(),
  otAfterMinutes: z.number(),
});

export const shiftSchema: z.ZodType<Shift> = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  scheduledIn: z.string(),
  scheduledOut: z.string(),
  breakMinutes: z.number(),
  crossesMidnight: z.boolean(),
  policy: shiftPolicySchema,
});

export const shiftsResponseSchema: z.ZodType<Paginated<Shift>> = z.object({
  data: z.array(shiftSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

export const rosterEntrySchema: z.ZodType<RosterEntry> = z.object({
  id: z.string(),
  employee: z.object({ id: z.string(), name: z.string(), employeeCode: z.string() }),
  shift: z.object({ id: z.string(), name: z.string(), code: z.string() }),
  from: z.string(),
  to: z.string().nullable(),
  department: z.string().nullable(),
});

export const rostersResponseSchema: z.ZodType<Paginated<RosterEntry>> = z.object({
  data: z.array(rosterEntrySchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

/**
 * REQ-C-01 defaults, and the labels the edit form uses. Kept beside the
 * contract so a new policy field cannot be added to one without the other.
 */
export const POLICY_FIELDS: {
  key: keyof ShiftPolicy;
  label: string;
  help: string;
  default: number;
}[] = [
  {
    key: 'graceInBefore',
    label: 'Grace in, before',
    help: 'Earliest an IN punch is accepted before scheduled in.',
    default: 30,
  },
  {
    key: 'graceInAfter',
    label: 'Grace in, after',
    help: 'Latest an IN punch is accepted after scheduled in.',
    default: 10,
  },
  {
    key: 'lateAfter',
    label: 'Late after',
    help: 'Past this, the day is flagged Late.',
    default: 10,
  },
  {
    key: 'graceOutBefore',
    label: 'Grace out, before',
    help: 'Earliest an OUT punch is accepted before scheduled out.',
    default: 10,
  },
  {
    key: 'graceOutAfter',
    label: 'Grace out, after',
    help: 'Latest an OUT punch is accepted after scheduled out.',
    default: 120,
  },
  {
    key: 'earlyExitBefore',
    label: 'Early exit before',
    help: 'Leaving earlier than this flags Early exit.',
    default: 10,
  },
  {
    key: 'minHalfDayMinutes',
    label: 'Minimum half day',
    help: 'Below this the day is Absent.',
    default: 240,
  },
  {
    key: 'minFullDayMinutes',
    label: 'Minimum full day',
    help: 'Below this, but above half day, the day is Half day.',
    default: 480,
  },
  {
    key: 'otAfterMinutes',
    label: 'Overtime after',
    help: 'Minutes past scheduled out that start counting as overtime.',
    default: 30,
  },
];
