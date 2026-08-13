import { z } from 'zod';

import type {
  Paginated,
  RosterAssignment,
  RosterBulkPreview,
  ShiftPolicy as SharedShiftPolicy,
  ShiftSummary,
  WeeklyOffPatternConfig,
  WeeklyOffPatternSummary,
} from '@vyuha/shared';

/**
 * Shift masters, weekly-off patterns and rosters (REQ-C-01 … REQ-C-05) as this
 * client reads them.
 *
 * Every type here is *derived* from the contract in `@vyuha/shared` rather than
 * restated. A hand-written copy is a copy that can drift, and the way it drifts
 * is silent: the server adds a field, this file does not, the Zod schema below
 * strips it, and the screen renders a shift that is missing a policy the day
 * engine is applying. Deriving makes that a compile error instead.
 *
 * The Zod schemas are still written out, because the derivation is a
 * *type*-level guarantee and a response is a runtime value. The
 * `z.ZodType<...>` annotation on each is what ties the two together: a field
 * added to the contract fails to compile here until the schema parses it.
 */

export type ShiftPolicy = SharedShiftPolicy;

/**
 * The contract minus `isActive`.
 *
 * Deactivating a shift is a real operation -- the API supports it, and the list
 * hides an inactive shift by default so this screen never receives one -- but
 * putting the toggle on this form is REQ-B-09a's Admin-CRUD work rather than
 * REQ-C-01's, and a switch that retires a shift belongs beside the confirm
 * dialog that requirement asks for. Written as an `Omit` rather than a fresh
 * interface so adding a field to the contract still fails to compile here.
 */
export type Shift = Omit<ShiftSummary, 'isActive'>;

export type RosterEntry = RosterAssignment;
export type WeeklyOffPattern = WeeklyOffPatternSummary;
export type WeeklyOffConfig = WeeklyOffPatternConfig;
export type BulkRosterResult = RosterBulkPreview;

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

const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const shiftsResponseSchema: z.ZodType<Paginated<Shift>> = z.object({
  data: z.array(shiftSchema),
  meta: pageMetaSchema,
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
  meta: pageMetaSchema,
});

const weeklyOffConfigSchema: z.ZodType<WeeklyOffConfig> = z.object({
  weekdays: z.array(z.number().int()),
  saturdaysOfMonth: z.array(z.number().int()).optional(),
});

export const weeklyOffPatternSchema: z.ZodType<WeeklyOffPattern> = z.object({
  id: z.string(),
  name: z.string(),
  config: weeklyOffConfigSchema,
  employeeCount: z.number().int(),
});

export const weeklyOffPatternsResponseSchema: z.ZodType<Paginated<WeeklyOffPattern>> = z.object({
  data: z.array(weeklyOffPatternSchema),
  meta: pageMetaSchema,
});

const rosterShiftRefSchema = z.object({ id: z.string(), name: z.string(), code: z.string() });

export const bulkRosterResultSchema: z.ZodType<BulkRosterResult> = z.object({
  shift: rosterShiftRefSchema,
  from: z.string(),
  to: z.string(),
  days: z.number().int(),
  assignable: z.number().int(),
  blocked: z.number().int(),
  employeeDays: z.number().int(),
  targets: z.array(
    z.object({
      employee: z.object({ id: z.string(), name: z.string(), employeeCode: z.string() }),
      department: z.string().nullable(),
      conflict: z
        .object({
          assignmentId: z.string(),
          shift: rosterShiftRefSchema,
          from: z.string(),
          to: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
  preview: z.boolean(),
  created: z.number().int(),
  recomputed: z.number().int(),
});

/**
 * The people a roster row can name.
 *
 * Deliberately narrower than `EmployeeListItem`: the picker needs a name and a
 * code, and parsing the fifteen other fields would make this screen fail to
 * load because a field it never renders changed shape.
 */
export interface RosterCandidate {
  id: string;
  name: string;
  employeeCode: string;
  department: string | null;
}

export const rosterCandidatesResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      employeeCode: z.string(),
      firstName: z.string(),
      lastName: z.string().nullable(),
      department: z.object({ id: z.string(), name: z.string() }).nullable(),
    }),
  ),
  meta: pageMetaSchema,
});
