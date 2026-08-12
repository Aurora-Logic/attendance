import { z } from 'zod';

import {
  ATTENDANCE_STATUSES,
  HALF_DAY_PARTS,
  PUNCH_SOURCES,
  PUNCH_TYPES,
  PUNCH_WINDOW_BEHAVIOURS,
  type AttendanceStatus,
  type HalfDayPart,
  type PunchSource,
  type PunchType,
  type PunchWindowBehaviour,
} from '@vyuha/shared';

/**
 * What the punch screen needs to know before anybody presses anything
 * (REQ-D-13): the server's clock, today's shift and its window, the current
 * status, and the last punch.
 *
 * `serverTime` is the only clock this screen trusts. REQ-D-05 says client time
 * is never used for a policy decision, and the practical consequence is that
 * the ticking display is driven by the server instant plus elapsed time, not
 * by `new Date()`.
 */

export interface TodayShift {
  name: string;
  /** Wall-clock `HH:mm`. */
  scheduledIn: string;
  scheduledOut: string;
  /** REQ-C-01 grace window, already resolved to wall clock by the server. */
  windowStart: string;
  windowEnd: string;
  crossesMidnight: boolean;
}

export interface LastPunch {
  type: PunchType;
  /** ISO instant. */
  at: string;
  source: PunchSource;
}

export interface TodayStatus {
  /** ISO instant, authoritative (REQ-D-04). */
  serverTime: string;
  /** Date-only `YYYY-MM-DD` for the attendance day this punch belongs to. */
  date: string;
  employee: { id: string; name: string; employeeCode: string };
  /** Null on a weekly off or a holiday, when no shift is scheduled. */
  shift: TodayShift | null;
  status: AttendanceStatus;
  /** REQ-D-01: punches alternate, so the server decides which one is next. */
  nextPunchType: PunchType;
  lastPunch: LastPunch | null;
  /** REQ-D-06: whether the current moment is inside the shift's grace window. */
  withinWindow: boolean;
  windowBehaviour: PunchWindowBehaviour;
  /** REQ-D-07: the half-day choice is offered at IN and nowhere else. */
  halfDayAllowed: boolean;
  /** REQ-M-03: the consent notice is shown until it has been accepted once. */
  consentAccepted: boolean;
  /** Stated in the consent notice, per REQ-M-03. */
  photoRetentionMonths: number;
}

export const todayStatusSchema: z.ZodType<TodayStatus> = z.object({
  serverTime: z.string(),
  date: z.string(),
  employee: z.object({ id: z.string(), name: z.string(), employeeCode: z.string() }),
  shift: z
    .object({
      name: z.string(),
      scheduledIn: z.string(),
      scheduledOut: z.string(),
      windowStart: z.string(),
      windowEnd: z.string(),
      crossesMidnight: z.boolean(),
    })
    .nullable(),
  status: z.enum(ATTENDANCE_STATUSES),
  nextPunchType: z.enum(PUNCH_TYPES),
  lastPunch: z
    .object({
      type: z.enum(PUNCH_TYPES),
      at: z.string(),
      source: z.enum(PUNCH_SOURCES),
    })
    .nullable(),
  withinWindow: z.boolean(),
  windowBehaviour: z.enum(PUNCH_WINDOW_BEHAVIOURS),
  halfDayAllowed: z.boolean(),
  consentAccepted: z.boolean(),
  photoRetentionMonths: z.number().int(),
});

/** What the server sends back after accepting a punch (technical design §7). */
export interface PunchResult {
  id: string;
  type: PunchType;
  /** ISO instant, stamped by the server. */
  at: string;
  status: AttendanceStatus;
  flags: string[];
  /**
   * The 256px thumbnail of the stamped photo (REQ-D-03a). Lists and
   * confirmations load this and never the full image.
   */
  photoThumbUrl: string | null;
}

export const punchResultSchema: z.ZodType<PunchResult> = z.object({
  id: z.string(),
  type: z.enum(PUNCH_TYPES),
  at: z.string(),
  status: z.enum(ATTENDANCE_STATUSES),
  flags: z.array(z.string()),
  photoThumbUrl: z.string().nullable(),
});

/** The multipart payload of `POST /punches`. */
export interface PunchDraft {
  type: PunchType;
  photo: Blob;
  /** REQ-D-11: the same key on every retry, so a retry cannot double-punch. */
  idempotencyKey: string;
  /** REQ-D-04: recorded, never used for a policy decision. */
  clientTime: string;
  coords: { latitude: number; longitude: number; accuracyM: number } | null;
  /** REQ-D-07, IN only. */
  halfDay: HalfDayPart | null;
  /** REQ-D-06, REQ-D-08a: mandatory out of window, or with no location. */
  reason: string | null;
}

export type { HalfDayPart, PunchType };
export { HALF_DAY_PARTS };
