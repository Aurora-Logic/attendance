import { describe, expect, it } from 'vitest';

import { punchDayState } from './day-state';

/**
 * The screen said "No shift today" for three different situations. These tests
 * exist to keep them apart, so each case names the thing it is protecting.
 */
const base = {
  status: null,
  nextPunchType: null,
  hasShift: true,
  lastPunchAt: null,
} as const;

describe('what kind of day this is', () => {
  it('says holiday on a holiday', () => {
    const state = punchDayState({ ...base, status: 'HOLIDAY', hasShift: false });
    expect(state.kind).toBe('holiday');
    expect(state.canPunch).toBe(false);
    expect(state.title.toLowerCase()).toContain('holiday');
  });

  it('says weekly off, which is not the same as a holiday', () => {
    const state = punchDayState({ ...base, status: 'WEEKLY_OFF', hasShift: false });
    expect(state.kind).toBe('weekly-off');
    expect(state.canPunch).toBe(false);
  });

  it('says on leave rather than treating it as an ordinary day', () => {
    const state = punchDayState({ ...base, status: 'ON_LEAVE', hasShift: false });
    expect(state.kind).toBe('on-leave');
    expect(state.canPunch).toBe(false);
  });

  it('separates an unrostered working day from a day off', () => {
    // The case the single sentence hid: nothing is wrong on a holiday, and
    // something is wrong here.
    const state = punchDayState({ ...base, hasShift: false });
    expect(state.kind).toBe('no-shift');
    expect(state.detail).toContain('oversight');
  });

  it('is ready when a shift is rostered and nothing is punched', () => {
    const state = punchDayState({ ...base, nextPunchType: 'IN' });
    expect(state.kind).toBe('ready');
    expect(state.canPunch).toBe(true);
  });

  it('is in progress once somebody has punched in', () => {
    const state = punchDayState({ ...base, nextPunchType: 'OUT', lastPunchAt: '2026-08-15T04:00:00Z' });
    expect(state.kind).toBe('in-progress');
    expect(state.canPunch).toBe(true);
  });

  it('is done when the pair is complete', () => {
    // A rostered day with no next punch. Not the same as "cannot punch".
    const state = punchDayState({ ...base, nextPunchType: null, status: 'PRESENT' });
    expect(state.kind).toBe('done');
    expect(state.canPunch).toBe(false);
  });

  it('lets the day beat the roster: a holiday with a shift still reads as a holiday', () => {
    // A shift can be rostered across a holiday declared later. The day wins,
    // because the day engine already counts it as a paid holiday.
    const state = punchDayState({ ...base, status: 'HOLIDAY', hasShift: true, nextPunchType: 'IN' });
    expect(state.kind).toBe('holiday');
  });
});
