import type { PeriodLocksResponse } from './types';

/**
 * Two months of lock history for a development build with no
 * `/attendance/locks` behind it.
 *
 * Fixed dates, no clock: a screen whose rows move on every render cannot be
 * reviewed twice. One live lock and one that was unlocked with a reason, which
 * is the pair the screen has to render differently -- a sample with only live
 * locks would leave the history rendering untested.
 */
export function samplePeriodLocks(): PeriodLocksResponse {
  const hr = { id: '00000000-0000-0000-0000-0000000000b1', name: 'Sample HR' };
  const admin = { id: '00000000-0000-0000-0000-0000000000b2', name: 'Sample Administrator' };

  return {
    data: [
      {
        id: 'sample-lock-2',
        locationId: null,
        locationName: null,
        year: 2026,
        month: 6,
        lockedAt: '2026-07-03T05:20:00.000Z',
        lockedBy: hr,
        unlockedAt: null,
        unlockedBy: null,
        reason: null,
      },
      {
        id: 'sample-lock-1',
        locationId: null,
        locationName: null,
        year: 2026,
        month: 5,
        lockedAt: '2026-06-02T04:10:00.000Z',
        lockedBy: hr,
        unlockedAt: '2026-06-09T11:45:00.000Z',
        unlockedBy: admin,
        reason: 'Two night-shift regularizations were approved after the month was closed.',
      },
    ],
  };
}
