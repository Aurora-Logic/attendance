import {
  canViewOvertime,
  type AttendanceDayDetail,
  type AttendanceDaySummary,
} from '@vyuha/shared';

import type { Principal } from '../../../platform/rbac/principal.js';

/**
 * Field-level visibility on an attendance day.
 *
 * REQ-E-05 puts overtime on the day row, and the day row is served to the
 * person it is about as well as to the people who manage them. Overtime is a
 * management figure, so a viewer holding only `attendance.view.self` is sent a
 * row without it.
 *
 * The key word is *sent*. Hiding the column in React would leave the number in
 * the JSON for anyone who opens the network tab, which is decoration rather
 * than a permission (CLAUDE.md §4: "RBAC enforced server-side ... and reflected
 * in the UI"). Everything here runs on the way out of the service layer, so the
 * field never reaches the wire.
 *
 * Which key grants it is decided once, in `@vyuha/shared`, so the server's
 * omission and the client's hidden column cannot drift apart. Note the
 * consequence recorded there: a manager holds the team key and therefore sees
 * overtime on every row in their scope, their own included. That is correct.
 */

export function overtimeVisibleTo(principal: Principal): boolean {
  return canViewOvertime(principal.permissions);
}

/**
 * The key is removed, not nulled. `otMinutes: null` is still a value the row
 * carries, and every client that reads it as "no overtime" would be wrong in
 * precisely the case this exists for.
 */
export function dayForViewer(
  day: AttendanceDaySummary,
  canSeeOvertime: boolean,
): AttendanceDaySummary {
  if (canSeeOvertime) return day;
  const { otMinutes: _withheld, ...visible } = day;
  return visible;
}

export function dayDetailForViewer(
  day: AttendanceDayDetail,
  canSeeOvertime: boolean,
): AttendanceDayDetail {
  if (canSeeOvertime) return day;
  // Built from the summary projection rather than repeating the omission, so a
  // field added to the withheld set is withheld on both shapes at once.
  return { ...dayForViewer(day, false), punches: day.punches };
}
