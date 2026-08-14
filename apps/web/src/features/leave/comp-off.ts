import type { CompOffCredit } from './types';

/**
 * REQ-G-11, the parts that are arithmetic rather than markup.
 *
 * "Credits expire 30 days after the earned date… the expiry job notifies the
 * employee and their manager at 7 days and again at 2 days before a credit
 * lapses." The job sends those notices; this file is what the screen uses to
 * say the same thing while the person is looking at it. An invisible credit is
 * a lost one, and a list of dates with no sense of urgency is invisible.
 *
 * The two thresholds are the job's, quoted rather than re-chosen, so a change
 * to the policy moves one constant instead of drifting the screen away from
 * the notification.
 */

/** The days before expiry at which REQ-G-11's job notifies. */
export const COMP_OFF_WARNING_DAYS = { soon: 7, critical: 2 } as const;

export const COMP_OFF_STATES = ['ACTIVE', 'LAPSED', 'CONSUMED'] as const;
export type CompOffState = (typeof COMP_OFF_STATES)[number];

export const COMP_OFF_STATE_LABELS: Record<CompOffState, string> = {
  ACTIVE: 'Available',
  CONSUMED: 'Used',
  LAPSED: 'Expired',
};

export type CompOffUrgency = 'CONSUMED' | 'LAPSED' | 'CRITICAL' | 'SOON' | 'ACTIVE';

/**
 * Whole calendar days between two `YYYY-MM-DD` dates.
 *
 * Built from `Date.UTC` on the parsed parts rather than from `new Date(string)`
 * arithmetic: both ends are dates rather than instants (NFR-05), and a local
 * subtraction across a daylight-saving boundary is off by an hour, which
 * rounds a 2-day credit to 1 and moves it into the wrong urgency band.
 */
export function daysBetween(from: string, to: string): number {
  // Matched rather than split. A split-and-Number pass accepts "not-a-date"
  // — three NaNs are three defined values — and Date.UTC then returns NaN, so
  // this function answers NaN days and the credit lands in no urgency band at
  // all. A wrong answer with no error is the failure mode that costs most.
  const parse = (value: string): number => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (match === null) throw new RangeError(`Expected a YYYY-MM-DD date, received "${value}".`);
    const [, year = '', month = '', day = ''] = match;
    const monthIndex = Number(month);
    const dayOfMonth = Number(day);
    if (monthIndex < 1 || monthIndex > 12 || dayOfMonth < 1 || dayOfMonth > 31) {
      throw new RangeError(`Expected a real calendar date, received "${value}".`);
    }
    return Date.UTC(Number(year), monthIndex - 1, dayOfMonth);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * How loudly a credit should ask to be used.
 *
 * A consumed or lapsed credit is settled and says so; nothing else matters
 * about it. A live one is banded on the job's own thresholds, and one whose
 * expiry has passed while the job has not yet run is CRITICAL rather than
 * LAPSED — the server has not lapsed it, so the screen must not claim it has.
 */
export function compOffUrgency(credit: CompOffCredit, today: string): CompOffUrgency {
  if (credit.consumedByLeaveRequestId !== null) return 'CONSUMED';
  if (credit.lapsedAt !== null) return 'LAPSED';

  const remaining = daysBetween(today, credit.expiresOn);
  if (remaining <= COMP_OFF_WARNING_DAYS.critical) return 'CRITICAL';
  if (remaining <= COMP_OFF_WARNING_DAYS.soon) return 'SOON';
  return 'ACTIVE';
}

/** The sentence under a credit, saying what happens to it and when. */
export function expiryNote(credit: CompOffCredit, today: string): string {
  if (credit.consumedByLeaveRequestId !== null) return 'Used against a leave application.';
  if (credit.lapsedAt !== null) return 'Expired before it was used.';

  const remaining = daysBetween(today, credit.expiresOn);
  if (remaining < 0) return 'Past its expiry date.';
  if (remaining === 0) return 'Expires today.';
  if (remaining === 1) return 'Expires tomorrow.';
  return `Expires in ${String(remaining)} days.`;
}

/**
 * The live credits worth interrupting somebody about, soonest first.
 *
 * Sorted by expiry rather than by earned date: the question this list answers
 * is "which of these am I about to lose", and the oldest earned credit is not
 * reliably the first to go once a grant has carried its own expiry override.
 */
export function expiringSoon(
  credits: readonly CompOffCredit[],
  today: string,
): readonly CompOffCredit[] {
  return credits
    .filter((credit) => {
      const urgency = compOffUrgency(credit, today);
      return urgency === 'SOON' || urgency === 'CRITICAL';
    })
    .toSorted((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

/** Days still available, so the band can lead with a number rather than a count of rows. */
export function availableDays(credits: readonly CompOffCredit[]): number {
  const total = credits
    .filter((credit) => credit.consumedByLeaveRequestId === null && credit.lapsedAt === null)
    .reduce((sum, credit) => sum + credit.days, 0);
  // Half days make this fractional; two decimals is the stored scale.
  return Math.round(total * 100) / 100;
}
