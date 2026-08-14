import { describe, expect, it } from 'vitest';

import { isPoolConnectionTimeout, isUniqueViolation, uniqueViolationConstraint } from './pg-error.js';

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

describe('isPoolConnectionTimeout', () => {
  /**
   * The exact string node-postgres raises, and the exact wrapper Drizzle puts
   * around it. Both were copied from a live failure: ten pool connections held
   * on a table lock, `GET /me/today` answering after 5.07s. The verbatim
   * message is the whole signal -- there is no SQLSTATE, because Postgres was
   * never reached -- so this test is what notices if a pg upgrade rewords it.
   */
  const DRIVER_MESSAGE = 'timeout exceeded when trying to connect';

  it('finds the pool timeout through the cause chain Drizzle adds', () => {
    const wrapper = new Error('Failed query: select 1 params: ');
    (wrapper as { cause?: unknown }).cause = new Error(DRIVER_MESSAGE);
    expect(isPoolConnectionTimeout(wrapper)).toBe(true);
  });

  it('finds it when the driver error is thrown bare', () => {
    expect(isPoolConnectionTimeout(new Error(DRIVER_MESSAGE))).toBe(true);
  });

  /**
   * The negative half is the one that matters. Everything reaching the filter
   * unrecognised is answered 500 and told to stop; widening this predicate by
   * accident would start telling clients to retry genuine bugs for ever.
   */
  it('does not claim an ordinary connection refusal or a query error', () => {
    expect(isPoolConnectionTimeout(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(false);
    expect(isPoolConnectionTimeout(drizzleWrapped({ code: '23505' }))).toBe(false);
    expect(isPoolConnectionTimeout(new Error('statement timeout'))).toBe(false);
  });

  it('is false for anything that is not an error', () => {
    expect(isPoolConnectionTimeout(null)).toBe(false);
    expect(isPoolConnectionTimeout(DRIVER_MESSAGE)).toBe(false);
  });
});
