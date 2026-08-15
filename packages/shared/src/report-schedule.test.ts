import { describe, expect, it } from 'vitest';

import { describeSchedule, isScheduleDue, scheduleWindow } from './reports.js';

/**
 * The two decisions a scheduled export rests on, tested apart from everything
 * that runs them (REQ-J-05).
 *
 * Both are pure and both are about dates, which is where this feature can be
 * wrong in a way nobody notices: a window off by one exports the wrong day
 * every day, and a due check that ignores the last run fires the same schedule
 * on every sweep. Neither produces an error -- one produces a plausible file
 * and the other produces ninety-six of them.
 */

describe('the period one run covers', () => {
  /*
   * Every window ends yesterday. A schedule running at 06:00 that included
   * today would export a few hours of punches and present them as a day.
   */
  it('gives a daily run yesterday, not today', () => {
    expect(scheduleWindow('DAILY', '2026-08-15')).toEqual({ from: '2026-08-14', to: '2026-08-14' });
  });

  it('gives a weekly run the seven complete days up to yesterday', () => {
    // Seven days inclusive: the 8th through the 14th, not the 9th.
    expect(scheduleWindow('WEEKLY', '2026-08-15')).toEqual({ from: '2026-08-08', to: '2026-08-14' });
  });

  it('gives a monthly run on the 1st the month that has just ended', () => {
    // The case a monthly schedule exists for, and the one an "end of this
    // month" window would get wrong by producing an empty file.
    expect(scheduleWindow('MONTHLY', '2026-09-01')).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('gives a monthly run mid-month the month containing yesterday', () => {
    expect(scheduleWindow('MONTHLY', '2026-08-15')).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('crosses a year boundary without inventing a month', () => {
    expect(scheduleWindow('MONTHLY', '2027-01-01')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(scheduleWindow('DAILY', '2027-01-01')).toEqual({
      from: '2026-12-31',
      to: '2026-12-31',
    });
  });

  it('gets February right in a leap year and in an ordinary one', () => {
    // 2028 is a leap year; 2027 is not. A month length table that forgot this
    // would drop the 29th from every leap February export.
    expect(scheduleWindow('MONTHLY', '2028-03-01').to).toBe('2028-02-29');
    expect(scheduleWindow('MONTHLY', '2027-03-01').to).toBe('2027-02-28');
  });

  it('steps back across a month boundary for a daily run', () => {
    expect(scheduleWindow('DAILY', '2026-08-01')).toEqual({ from: '2026-07-31', to: '2026-07-31' });
  });

  it('spans two months for a weekly run that straddles one', () => {
    expect(scheduleWindow('WEEKLY', '2026-08-03')).toEqual({ from: '2026-07-27', to: '2026-08-02' });
  });
});

describe('whether a schedule is due', () => {
  const daily = {
    cadence: 'DAILY' as const,
    hour: 6,
    minute: 0,
    isActive: true,
    lastRunOn: null as string | null,
  };
  const at = (hour: number, minute: number, date = '2026-08-15') => ({
    date,
    hour,
    minute,
    weekday: 6,
    dayOfMonth: 15,
  });

  it('is not due before its minute', () => {
    expect(isScheduleDue(daily, at(5, 45))).toBe(false);
  });

  it('is due at its minute', () => {
    expect(isScheduleDue(daily, at(6, 0))).toBe(true);
  });

  /*
   * The sweep runs every fifteen minutes. Without the last-run date this
   * schedule would fire again at 06:15 and at every sweep until midnight --
   * seventy-one extra files, each of them a valid-looking export.
   */
  it('does not fire twice on the same day', () => {
    expect(isScheduleDue({ ...daily, lastRunOn: '2026-08-15' }, at(6, 15))).toBe(false);
    expect(isScheduleDue({ ...daily, lastRunOn: '2026-08-14' }, at(6, 15))).toBe(true);
  });

  it('still runs late rather than skipping the day', () => {
    // The server was down at 06:00. A report that arrives at 09:00 is worth
    // having; a day with no report and no error is not.
    expect(isScheduleDue(daily, at(9, 30))).toBe(true);
  });

  it('never fires while paused', () => {
    expect(isScheduleDue({ ...daily, isActive: false }, at(23, 59))).toBe(false);
  });

  it('runs a weekly schedule only on its weekday', () => {
    const weekly = { ...daily, cadence: 'WEEKLY' as const, weekday: 1 };
    // 2026-08-15 is a Saturday, ISO weekday 6.
    expect(isScheduleDue(weekly, at(9, 0))).toBe(false);
    expect(isScheduleDue(weekly, { ...at(9, 0), weekday: 1 })).toBe(true);
  });

  it('runs a monthly schedule only on its day of the month', () => {
    const monthly = { ...daily, cadence: 'MONTHLY' as const, dayOfMonth: 1 };
    expect(isScheduleDue(monthly, at(9, 0))).toBe(false);
    expect(isScheduleDue(monthly, { ...at(9, 0), dayOfMonth: 1 })).toBe(true);
  });
});

describe('the sentence the screen shows', () => {
  it('describes each cadence in the words the form used', () => {
    expect(describeSchedule({ cadence: 'DAILY', hour: 6, minute: 0 })).toBe('Every day at 06:00');
    expect(describeSchedule({ cadence: 'WEEKLY', hour: 7, minute: 30, weekday: 1 })).toBe(
      'Every Monday at 07:30',
    );
    expect(describeSchedule({ cadence: 'MONTHLY', hour: 5, minute: 5, dayOfMonth: 1 })).toBe(
      'On day 1 of each month at 05:05',
    );
  });
});
