import type { AttendanceStatus, PunchType } from '@vyuha/shared';

/**
 * What kind of day this is, said in one word before anything else is drawn.
 *
 * The screen used to answer "is there a shift?" with "No shift today", which
 * is the same sentence for a public holiday, somebody's weekly off, and a
 * roster nobody filled in. Those are three different situations: two are
 * correct and need no action, and the third is a mistake somebody has to fix.
 *
 * Derived rather than stored. `/me/today` already carries the day's status and
 * whether a shift is rostered, so a second source would only be a second thing
 * to keep in step.
 */
export type PunchDayKind =
  | 'holiday'
  | 'weekly-off'
  | 'on-leave'
  | 'no-shift'
  | 'ready'
  | 'in-progress'
  | 'done';

export interface PunchDayState {
  readonly kind: PunchDayKind;
  readonly title: string;
  readonly detail: string;
  /** False when the day itself is the reason not to punch, rather than a fault. */
  readonly canPunch: boolean;
}

export function punchDayState(input: {
  status: AttendanceStatus | null;
  nextPunchType: PunchType | null;
  hasShift: boolean;
  lastPunchAt: string | null;
}): PunchDayState {
  const { status, nextPunchType, hasShift, lastPunchAt } = input;

  // The day's own character comes first. Somebody opening this on a holiday
  // wants to be told it is a holiday, not shown a disabled button.
  if (status === 'HOLIDAY') {
    return {
      kind: 'holiday',
      title: 'Today is a holiday',
      detail: 'Nothing to punch. It is already counted as a paid day.',
      canPunch: false,
    };
  }

  if (status === 'WEEKLY_OFF') {
    return {
      kind: 'weekly-off',
      title: 'Today is your weekly off',
      detail: 'Nothing to punch. Working today needs a roster change first.',
      canPunch: false,
    };
  }

  if (status === 'ON_LEAVE') {
    return {
      kind: 'on-leave',
      title: 'You are on leave today',
      detail: 'Your leave is approved for today, so no punch is expected.',
      canPunch: false,
    };
  }

  // A working day with nobody rostered is the one that is somebody's mistake,
  // and it is the case the old single sentence hid.
  if (!hasShift) {
    return {
      kind: 'no-shift',
      title: 'No shift is rostered for you today',
      detail:
        'This is a working day with no shift assigned, which is usually an oversight. Ask HR to roster you before punching.',
      canPunch: false,
    };
  }

  if (nextPunchType === 'IN') {
    return {
      kind: 'ready',
      title: 'Ready to punch in',
      detail: 'A live photo is taken with every punch.',
      canPunch: true,
    };
  }

  if (nextPunchType === 'OUT') {
    return {
      kind: 'in-progress',
      title: 'You are punched in',
      detail: lastPunchAt === null ? 'Punch out when you leave.' : 'Punch out when you leave.',
      canPunch: true,
    };
  }

  // No next punch on a rostered working day means the pair is complete.
  return {
    kind: 'done',
    title: 'Done for today',
    detail: 'Both punches are recorded. Nothing further is needed.',
    canPunch: false,
  };
}
