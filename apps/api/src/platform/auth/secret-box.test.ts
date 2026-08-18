import { describe, expect, it } from 'vitest';

import { openSecret, sealSecret } from './secret-box.js';

describe('secret box', () => {
  const root = 'a-root-secret-that-is-long-enough-for-tests';

  it('round-trips, and two seals of one secret differ (fresh iv)', () => {
    const a = sealSecret('whsec_abc', root, 'webhook');
    const b = sealSecret('whsec_abc', root, 'webhook');
    expect(a).not.toBe(b);
    expect(openSecret(a, root, 'webhook')).toBe('whsec_abc');
    expect(openSecret(b, root, 'webhook')).toBe('whsec_abc');
  });

  it('refuses a wrong root, a wrong purpose, and a flipped byte — never garbles', () => {
    const sealed = sealSecret('whsec_abc', root, 'webhook');
    expect(() => openSecret(sealed, 'another-root', 'webhook')).toThrow();
    expect(() => openSecret(sealed, root, 'other-purpose')).toThrow();
    const [v, body] = sealed.split('.');
    const bytes = Buffer.from(body ?? '', 'base64url');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0x01;
    expect(() => openSecret(`${v ?? ''}.${bytes.toString('base64url')}`, root, 'webhook')).toThrow();
  });

  it('names an unknown format instead of guessing', () => {
    expect(() => openSecret('v9.zzzz', root, 'webhook')).toThrow(/unknown format/u);
    expect(() => openSecret('garbage', root, 'webhook')).toThrow();
  });
});
