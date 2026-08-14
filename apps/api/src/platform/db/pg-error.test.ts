import { describe, expect, it } from 'vitest';

import { isUniqueViolation, uniqueViolationConstraint } from './pg-error.js';

/**
 * The shapes these helpers actually meet, rather than a hand-made object that
 * happens to satisfy them.
 *
 * Drizzle throws an error whose message is the SQL and whose `cause` is the
 * driver's error, so every field worth reading is one level down -- and it has
 * been two levels down in past versions. A helper that only looked at the
 * thrown object would return null for every real failure and every caller would
 * silently fall through to its generic branch, which is exactly how a
 * constraint violation became a 500.
 */

function drizzleWrapped(driver: Record<string, unknown>): Error {
  const wrapper = new Error('Failed query: insert into "users" ... params: a,b,c');
  (wrapper as { cause?: unknown }).cause = Object.assign(new Error('duplicate key value'), driver);
  return wrapper;
}

describe('isUniqueViolation', () => {
  it('finds 23505 through the cause chain', () => {
    expect(isUniqueViolation(drizzleWrapped({ code: '23505' }))).toBe(true);
  });

  it('does not claim a foreign key or a check violation', () => {
    expect(isUniqueViolation(drizzleWrapped({ code: '23503' }))).toBe(false);
    expect(isUniqueViolation(drizzleWrapped({ code: '23514' }))).toBe(false);
  });

  it('is false for anything that is not a database error', () => {
    expect(isUniqueViolation(new Error('nothing to do with pg'))).toBe(false);
    expect(isUniqueViolation('a string')).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('uniqueViolationConstraint', () => {
  it('names the index that refused the row', () => {
    const error = drizzleWrapped({ code: '23505', constraint: 'users_employee_uq' });
    expect(uniqueViolationConstraint(error)).toBe('users_employee_uq');
  });

  /**
   * The discrimination the invitation path depends on. `users` carries a unique
   * index on the employee link *and* one on lower(email); answering "that
   * employee already has a login" for an address collision would send an
   * administrator to the wrong field, and would say something about an address
   * that the email checks deliberately refuse to say.
   */
  it('distinguishes two indexes on the same table', () => {
    const byEmail = drizzleWrapped({ code: '23505', constraint: 'users_email_uq' });
    expect(uniqueViolationConstraint(byEmail)).not.toBe('users_employee_uq');
    expect(uniqueViolationConstraint(byEmail)).toBe('users_email_uq');
  });

  it('is null when the violation is not a unique one, whatever it names', () => {
    const foreignKey = drizzleWrapped({ code: '23503', constraint: 'users_employee_fk' });
    expect(uniqueViolationConstraint(foreignKey)).toBeNull();
  });

  it('is null for a unique violation that carried no constraint name', () => {
    expect(uniqueViolationConstraint(drizzleWrapped({ code: '23505' }))).toBeNull();
  });
});
