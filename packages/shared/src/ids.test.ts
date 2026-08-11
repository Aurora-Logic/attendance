import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7, uuidv7Timestamp } from './ids.js';

describe('uuidv7', () => {
  it('produces a well-formed UUID', () => {
    expect(isUuid(uuidv7())).toBe(true);
  });

  it('sets version 7 and the RFC 9562 variant', () => {
    for (let i = 0; i < 500; i++) {
      const id = uuidv7();
      expect(id[14]).toBe('7');
      expect('89ab').toContain(id[19]);
    }
  });

  it('encodes the timestamp it was given', () => {
    const at = Date.UTC(2026, 7, 11, 6, 30, 0);
    expect(uuidv7Timestamp(uuidv7(at))).toBe(at);
  });

  it('sorts lexicographically in time order', () => {
    // The reason for choosing v7 over v4: index locality on append-heavy
    // tables depends on this property holding.
    const ids = [
      uuidv7(Date.UTC(2026, 0, 1)),
      uuidv7(Date.UTC(2026, 5, 1)),
      uuidv7(Date.UTC(2026, 11, 31)),
    ];
    expect([...ids].sort()).toEqual(ids);
  });

  it('is unique across a tight loop at a single fixed millisecond', () => {
    const at = Date.UTC(2026, 7, 11);
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7(at)));
    expect(ids.size).toBe(10_000);
  });

  it('rejects a nonsense clock value rather than emitting a malformed id', () => {
    expect(() => uuidv7(Number.NaN)).toThrow(RangeError);
    expect(() => uuidv7(-1)).toThrow(RangeError);
  });

  it('returns null for a non-v7 uuid', () => {
    expect(uuidv7Timestamp('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(uuidv7Timestamp('not-a-uuid')).toBeNull();
  });
});
