import { format } from 'date-fns';

/**
 * The two calendar helpers the leave screens still need for themselves.
 *
 * What used to live here — `countLeaveDays`, and a `DEFAULT_WEEKLY_OFF_DAYS`
 * set that assumed Sunday — has been deleted rather than kept as a fallback.
 * REQ-G-06 promises the employee the number of days their application will
 * consume, and only the server can know it: the weekly-off pattern belongs to
 * the roster (REQ-C-03), the holidays to the employee's calendar (REQ-H-02),
 * and the sandwich rule to the leave type (REQ-G-07). A second implementation
 * here could only ever be a guess that the submission then contradicts, and
 * "the form said two days and it took four" is the worst way to learn that.
 *
 * `GET /leave/preview` runs the same `evaluate()` the application does. See
 * `usePreviewLeave` in `use-leave.ts`.
 */

/** `yyyy-MM-dd`, the key holidays and leave dates are compared on (NFR-05). */
export function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** "1 day", "2.5 days" — never "1 days". */
export function formatDays(value: number): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${text} ${value === 1 ? 'day' : 'days'}`;
}
