import { ERROR_CODES } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { AppError, describeError, statusForCode, toErrorBody } from './errors.js';

describe('statusForCode', () => {
  it('gives every shared error code a status', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const status = statusForCode(code);
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });
});

describe('AppError', () => {
  it('takes its status from the code table', () => {
    expect(new AppError(ERROR_CODES.NOT_FOUND, 'gone').status).toBe(404);
    expect(new AppError(ERROR_CODES.PUNCH_OUTSIDE_WINDOW, 'closed').status).toBe(422);
  });

  it('keeps the cause for the log without putting it in the envelope', () => {
    const cause = new Error('duplicate key value violates unique constraint');
    const error = new AppError(ERROR_CODES.CONFLICT, 'That code is already in use.', { cause });

    expect(error.cause).toBe(cause);
    const body = toErrorBody(error.code, error.message, 'req-1', error.details);
    expect(JSON.stringify(body)).not.toContain('duplicate key');
  });
});

describe('describeError', () => {
  it('reads through an AggregateError with an empty message', () => {
    // What Node produces for a refused connect on a dual-stack host.
    const aggregate = new AggregateError([
      new Error('connect ECONNREFUSED ::1:56379'),
      new Error('connect ECONNREFUSED 127.0.0.1:56379'),
    ]);
    expect(aggregate.message).toBe('');

    expect(describeError(aggregate)).toBe(
      'connect ECONNREFUSED ::1:56379; connect ECONNREFUSED 127.0.0.1:56379',
    );
  });

  it('follows a cause chain, which is where drizzle hides the driver error', () => {
    const driver = new Error('connect ECONNREFUSED 127.0.0.1:55499');
    const wrapped = new Error('Failed query: select 1\nparams: ', { cause: driver });

    expect(describeError(wrapped)).toBe(
      'Failed query: select 1 params: : connect ECONNREFUSED 127.0.0.1:55499',
    );
  });

  it('does not loop forever on a circular cause', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Object.defineProperty(a, 'cause', { value: b });

    expect(() => describeError(a)).not.toThrow();
    expect(describeError(a)).toContain('...');
  });

  it('falls back to the name when there is no message', () => {
    expect(describeError(new RangeError())).toBe('RangeError');
  });

  it('handles a thrown non-error', () => {
    expect(describeError('just a string')).toBe('just a string');
    expect(describeError(null)).toBe('null');
  });
});
