import { z } from 'zod';

import {
  ATTENDANCE_STATUSES,
  HALF_DAY_PARTS,
  PUNCH_SOURCES,
  PUNCH_TYPES,
  type AttendanceStatus,
  type HalfDayPart,
  type PunchSource,
  type PunchType,
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
  /** ISO instant; `formatClock` renders it in the org time zone. */
  scheduledIn: string;
  scheduledOut: string;
  /** REQ-C-01 grace window for the punch that is next, as instants. */
  windowStart: string;
  windowEnd: string;
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
  /**
   * Null when the signed-in account has no employee record. Such accounts
   * exist - an administrator created for the system itself - and they cannot
   * punch, so the screen has to say so rather than assume a person.
   */
  employee: { id: string; name: string; employeeCode: string; isFieldStaff: boolean } | null;
  /** Null on a weekly off or a holiday, when no shift is scheduled. */
  shift: TodayShift | null;
  /**
   * Null before the first punch of the day. The day row does not exist yet, so
   * there is no status to show - and showing ABSENT to somebody who is about to
   * punch in would be both wrong and alarming.
   */
  status: AttendanceStatus | null;
  /**
   * REQ-D-01: punches alternate, so the server decides which one is next. Null
   * when no punch is possible at all - no employee record, or a locked period.
   */
  nextPunchType: PunchType | null;
  lastPunch: LastPunch | null;
  /** REQ-D-06: whether the current moment is inside the shift's grace window. */
  withinWindow: boolean;
  /** REQ-D-07: the half-day choice is offered at IN and nowhere else. */
  halfDayAllowed: boolean;
  /** REQ-M-03: the consent notice is shown until it has been accepted once. */
  consentAccepted: boolean;
  /** REQ-L-03: months a punch photo is kept; the notice quotes it (REQ-M-03). */
  photoRetentionMonths: number;
  /** Set when punching is impossible right now, whatever the employee does. */
  blockedReason: { code: string; message: string } | null;
  /** REQ-D-06: true when the server will refuse this punch without a reason. */
}

/**
 * What `GET /me/today` actually sends.
 *
 * Pinned to `PunchContext` from the shared package, so a rename on the server
 * is a compile error here rather than "the today's status came back in a shape
 * this screen cannot read" on a live screen - which is exactly how this drift
 * was found. The two halves were written in parallel and never reconciled: the
 * screen expected `date`, `windowStart` and a non-null `status`; the server
 * sends `attendanceDate`, a pair of window objects, and the whole day row.
 *
 * `flags` on the nested records is loosened to `string[]` for the reason given
 * on the attendance day contract: flags are additive server-side and an
 * unknown one must not fail the page.
 */
const windowViewSchema = z.object({
  opensAt: z.string(),
  closesAt: z.string(),
  isOpenNow: z.boolean(),
});

const punchContextSchema = z.object({
  serverTime: z.string(),
  timezone: z.string(),
  attendanceDate: z.string(),
  employee: z
    .object({
      id: z.string(),
      name: z.string(),
      employeeCode: z.string(),
      isFieldStaff: z.boolean(),
    })
    .nullable(),
  canPunch: z.boolean(),
  nextPunchType: z.enum(PUNCH_TYPES).nullable(),
  shift: z
    .object({
      id: z.string(),
      name: z.string(),
      code: z.string(),
      scheduledIn: z.string(),
      scheduledOut: z.string(),
      breakMinutes: z.number(),
      inWindow: windowViewSchema,
      outWindow: windowViewSchema,
    })
    .nullable(),
  photoRequired: z.literal(true),
  geofence: z.object({
    enforced: z.boolean(),
    radiusM: z.number(),
    exempt: z.boolean(),
  }),
  ipAllowlist: z.object({ enforced: z.boolean(), allowed: z.boolean() }),
  lastPunch: z
    .object({
      type: z.enum(PUNCH_TYPES),
      serverTime: z.string(),
      source: z.enum(PUNCH_SOURCES),
    })
    .nullable(),
  day: z.object({ status: z.enum(ATTENDANCE_STATUSES) }).nullable(),
  consentAccepted: z.boolean(),
  photoRetentionMonths: z.number(),
  blockedReason: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export const todayStatusSchema = punchContextSchema.transform(
  (context): TodayStatus => ({
    serverTime: context.serverTime,
    date: context.attendanceDate,
    employee: context.employee,
    shift:
      context.shift === null
        ? null
        : {
            name: context.shift.name,
            scheduledIn: context.shift.scheduledIn,
            scheduledOut: context.shift.scheduledOut,
            // The window that matters is the one for the punch about to be
            // made. Showing the IN window while somebody is punching out would
            // tell them the wrong thing about whether they are late.
            ...(context.nextPunchType === 'OUT'
              ? {
                  windowStart: context.shift.outWindow.opensAt,
                  windowEnd: context.shift.outWindow.closesAt,
                }
              : {
                  windowStart: context.shift.inWindow.opensAt,
                  windowEnd: context.shift.inWindow.closesAt,
                }),
          },
    // No day row yet means no status yet, not ABSENT.
    status: context.day?.status ?? null,
    nextPunchType: context.nextPunchType,
    lastPunch:
      context.lastPunch === null
        ? null
        : {
            type: context.lastPunch.type,
            at: context.lastPunch.serverTime,
            source: context.lastPunch.source,
          },
    // The server states this per window rather than as one boolean, so read
    // the one belonging to the next punch. No shift means no window to be
    // inside of.
    withinWindow:
      context.shift === null
        ? false
        : context.nextPunchType === 'OUT'
          ? context.shift.outWindow.isOpenNow
          : context.shift.inWindow.isOpenNow,
    // REQ-D-07 offers the half-day choice at IN and nowhere else. There is no
    // server-side policy switch for it (OPEN-QUESTIONS P1-3), so this states
    // the requirement rather than inventing a setting.
    halfDayAllowed: context.nextPunchType === 'IN',
    // REQ-M-03: the server records acceptance against the user
    // (POST /me/consent), so this is its answer rather than a hardcoded
    // "not accepted" -- the notice stops reappearing once accepted, and
    // still gates the first punch until then.
    consentAccepted: context.consentAccepted,
    photoRetentionMonths: context.photoRetentionMonths,
    blockedReason: context.blockedReason,
  }),
);

/** What the server sends back after accepting a punch (technical design §7). */
export interface PunchResult {
  id: string;
  type: PunchType;
  /** ISO instant, stamped by the server. */
  at: string;
  /**
   * Null when the day engine did not run, which is what happens on a locked
   * period (REQ-E-09). The punch is still recorded; there is simply no derived
   * status yet, and inventing one would be worse than showing none.
   */
  status: AttendanceStatus | null;
  flags: string[];
  /**
   * The 256px thumbnail of the stamped photo (REQ-D-03a). Lists and
   * confirmations load this and never the full image.
   *
   * Always null on this path: the receipt carries a file id, and turning one
   * into something an `img` can load means a second call for a signed URL
   * (NFR-09). The confirmation falls back to the frame the camera produced,
   * which is the same picture without the server's stamp.
   */
  photoThumbUrl: string | null;
  /** REQ-D-11: true when the key had been used before and no second punch was made. */
  replayed: boolean;
}

/**
 * `PunchReceipt` as the server actually sends it, mapped to what the screen
 * shows.
 *
 * Pinned to the server's shape rather than to a convenient one, for the same
 * reason `todayStatusSchema` above is: the two halves had drifted and neither
 * end had been run against the other. The screen was posting flat multipart
 * fields to an endpoint that wants one JSON `payload` part, and parsing the
 * reply as a bare punch when it is a receipt wrapping one — so every online
 * punch answered 400 and every one that had somehow succeeded would have
 * failed to render.
 *
 * `flags` stays `string[]`: flags are additive server-side and an unknown one
 * must not fail the confirmation of a punch that was accepted.
 */
const punchReceiptSchema = z.object({
  punch: z.object({
    id: z.string(),
    type: z.enum(PUNCH_TYPES),
    serverTime: z.string(),
    flags: z.array(z.string()),
  }),
  day: z.object({ status: z.enum(ATTENDANCE_STATUSES) }).nullable(),
  replayed: z.boolean(),
});

export const punchResultSchema: z.ZodType<PunchResult, unknown> = punchReceiptSchema.transform(
  (receipt): PunchResult => ({
    id: receipt.punch.id,
    type: receipt.punch.type,
    at: receipt.punch.serverTime,
    status: receipt.day?.status ?? null,
    flags: receipt.punch.flags,
    photoThumbUrl: null,
    replayed: receipt.replayed,
  }),
);

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
  /**
   * REQ-M-03: the notice has been accepted -- either the tick on this screen
   * or the server's own record said so. Travels with the punch (and with a
   * queued punch) because the server refuses a photo punch without it, and an
   * offline first punch has no other way to carry its acceptance to sync time.
   */
  consentAccepted: boolean;
}

export type { HalfDayPart, PunchType };
export { HALF_DAY_PARTS };
