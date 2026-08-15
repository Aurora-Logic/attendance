import { describe, expect, it } from 'vitest';

import { INVITATION_PATH, PASSWORD_RESET_PATH, tokenLink } from './web-links.js';

/**
 * The endpoint test can only ever exercise the `WEB_BASE_URL` the suite happens
 * to run with, which has no trailing slash -- so it would pass just as happily
 * against the naive concatenation this replaced. This is the test that can
 * actually fail for that bug.
 */
describe('tokenLink', () => {
  const token = 'GOvcdE1DAKMB1Fc-HDJ4TEISAECOM0qZwziLNOvzJ-o';

  it('builds the invitation and reset links the web app routes on', () => {
    expect(tokenLink('http://localhost:5173', INVITATION_PATH, token)).toBe(
      `http://localhost:5173/accept-invitation/${token}`,
    );
    expect(tokenLink('http://localhost:5173', PASSWORD_RESET_PATH, token)).toBe(
      `http://localhost:5173/reset-password/${token}`,
    );
  });

  it('survives a base URL configured with a trailing slash', () => {
    // `//accept-invitation/<token>` matches no route the web app declares, so
    // this is the difference between an invitation and a 404 for everybody.
    for (const base of ['https://vyuha.example/', 'https://vyuha.example///']) {
      const link = tokenLink(base, INVITATION_PATH, token);
      expect(link).toBe(`https://vyuha.example/accept-invitation/${token}`);
      expect(new URL(link).pathname).toBe(`/accept-invitation/${token}`);
    }
  });

  it('keeps a base URL that carries a path prefix', () => {
    // A deployment behind `https://host/vyuha` is legal, and its links have to
    // stay under that prefix rather than being rewritten to the root.
    expect(tokenLink('https://host/vyuha/', PASSWORD_RESET_PATH, token)).toBe(
      `https://host/vyuha/reset-password/${token}`,
    );
  });
});
