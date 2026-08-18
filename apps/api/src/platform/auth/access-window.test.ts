import { describe, expect, it } from 'vitest';

import { evaluateWindow } from './access-window.service.js';

const window = { enabled: true, closesAt: '19:30', reopensAt: '09:00', days: [1, 2, 3, 4, 5, 6] };
const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);

describe('the access window (12 Area AB)', () => {
  it('is open in the working day, closed after 19:30 and before 09:00, on the organisation clock', () => {
    // 2026-08-18 is a Tuesday. 14:30 UTC = 20:00 IST.
    expect(evaluateWindow(window, IST, at('2026-08-18T09:00:00Z')).closed).toBe(false); // 14:30 IST
    expect(evaluateWindow(window, IST, at('2026-08-18T14:30:00Z'))).toEqual({ closed: true, reopensAt: '09:00 tomorrow' });
    expect(evaluateWindow(window, IST, at('2026-08-19T02:00:00Z'))).toEqual({ closed: true, reopensAt: '09:00' }); // 07:30 IST Wed
    expect(evaluateWindow(window, IST, at('2026-08-19T03:30:00Z')).closed).toBe(false); // 09:00 IST
  });

  it('a day the window does not apply to stays open, and the morning after such a day stays open too', () => {
    // Sunday 23 Aug: not in days. 20:00 IST Sunday open; Monday 07:30 IST open (yesterday was Sunday).
    expect(evaluateWindow(window, IST, at('2026-08-23T14:30:00Z')).closed).toBe(false);
    expect(evaluateWindow(window, IST, at('2026-08-24T02:00:00Z')).closed).toBe(false);
    // Saturday 20:00 IST closed; Sunday 07:30 IST still closed (Saturday applied).
    expect(evaluateWindow(window, IST, at('2026-08-22T14:30:00Z')).closed).toBe(true);
    expect(evaluateWindow(window, IST, at('2026-08-23T02:00:00Z')).closed).toBe(true);
  });

  it('disabled means never closed', () => {
    expect(evaluateWindow({ ...window, enabled: false }, IST, at('2026-08-18T14:30:00Z')).closed).toBe(false);
  });
});
