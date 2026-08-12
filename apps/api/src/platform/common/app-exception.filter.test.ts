import { ForbiddenException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ERROR_CODES, type ApiErrorBody } from '@vyuha/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AppExceptionFilter } from './app-exception.filter.js';
import { AppError } from './errors.js';

/**
 * Technical design §6. The property that matters most here is negative: an
 * error the application did not anticipate must not put its message, its SQL,
 * or its stack into a response body, and must put all three into the log.
 */

const REQUEST_ID = '019ff400-0000-7000-8000-000000000001';

interface Captured {
  status: number | null;
  body: ApiErrorBody | null;
  headers: Record<string, string>;
}

function makeHost(overrides: { headersSent?: boolean } = {}): {
  host: ArgumentsHost;
  captured: Captured;
} {
  const captured: Captured = { status: null, body: null, headers: {} };

  const res = {
    headersSent: overrides.headersSent ?? false,
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
    },
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(payload: ApiErrorBody) {
      captured.body = payload;
      return res;
    },
  };

  const req = { id: REQUEST_ID, method: 'POST', originalUrl: '/api/v1/punches', url: '/api/v1/punches' };

  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;

  return { host, captured };
}

function run(exception: unknown, overrides?: { headersSent?: boolean }): Captured {
  const { host, captured } = makeHost(overrides);
  new AppExceptionFilter().catch(exception, host);
  return captured;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppExceptionFilter', () => {
  it('reports an unknown error as INTERNAL_ERROR without leaking its message', () => {
    const secret = 'connect ECONNREFUSED postgres://vyuha:hunter2@10.0.0.4:5432';
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const captured = run(new Error(secret));

    expect(captured.status).toBe(500);
    expect(captured.body?.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(captured.body?.error.requestId).toBe(REQUEST_ID);

    // The whole body, not just the message field: a leak through `details`
    // would be just as bad and this catches it.
    const serialised = JSON.stringify(captured.body);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('at Object');

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('logs the original message and stack in full', () => {
    const original = 'relation "punches" does not exist';
    const logged: unknown[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(...args);
    });

    run(new Error(original));

    const entry = logged[0];
    expect(entry).toMatchObject({
      status: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      where: 'POST /api/v1/punches',
      reason: original,
    });

    const err: unknown =
      typeof entry === 'object' && entry !== null && 'err' in entry ? entry.err : undefined;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(original);
    expect(String((err as Error).stack)).toContain(original);
  });

  it('records a non-Error throw under `thrown` rather than pretending it is an error', () => {
    const logged: unknown[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(...args);
    });

    run('a bare string was thrown');

    expect(logged[0]).toMatchObject({
      reason: 'a bare string was thrown',
      thrown: { thrown: 'string' },
    });
  });

  it('does not fall over when something other than an Error is thrown', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const captured = run({ weird: true, nested: { deeper: 1 } });

    expect(captured.status).toBe(500);
    expect(captured.body?.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(JSON.stringify(captured.body)).not.toContain('weird');
  });

  it('survives a thrown value that cannot be serialised', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => run(circular)).not.toThrow();
  });

  it('passes an AppError through with its code, status, and details', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const captured = run(
      new AppError(ERROR_CODES.PUNCH_OUTSIDE_WINDOW, 'Punch window closed at 09:40.', {
        details: { windowEnd: '2026-08-11T04:10:00Z' },
      }),
    );

    expect(captured.status).toBe(422);
    expect(captured.body?.error.code).toBe(ERROR_CODES.PUNCH_OUTSIDE_WINDOW);
    expect(captured.body?.error.message).toBe('Punch window closed at 09:40.');
    expect(captured.body?.error.details).toEqual({ windowEnd: '2026-08-11T04:10:00Z' });
  });

  it('maps a ZodError to VALIDATION_FAILED with per-field details', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const schema = z.object({ employeeId: z.string(), minutes: z.number().int() });
    const parsed = schema.safeParse({ employeeId: 42, minutes: 1.5 });
    expect(parsed.success).toBe(false);

    const captured = run(parsed.success ? new Error('unreachable') : parsed.error);

    expect(captured.status).toBe(400);
    expect(captured.body?.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);

    const fields = captured.body?.error.details?.fields;
    expect(Array.isArray(fields)).toBe(true);
    expect(JSON.stringify(fields)).toContain('employeeId');
    expect(JSON.stringify(fields)).toContain('minutes');
  });

  it('maps a framework HttpException to the matching error code', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const captured = run(new ForbiddenException('Not your record.'));

    expect(captured.status).toBe(403);
    expect(captured.body?.error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(captured.body?.error.message).toBe('Not your record.');
  });

  it('withholds the message of a 5xx HttpException too', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const captured = run(
      new HttpException('upstream tally connector at 10.0.0.9 refused', HttpStatus.BAD_GATEWAY),
    );

    expect(captured.status).toBe(502);
    expect(captured.body?.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(JSON.stringify(captured.body)).not.toContain('10.0.0.9');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('echoes the request id on the response header as well as in the body', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const captured = run(AppError.notFound('Employee', 'abc'));

    expect(captured.headers['x-request-id']).toBe(REQUEST_ID);
    expect(captured.body?.error.requestId).toBe(REQUEST_ID);
  });

  it('writes nothing when the response has already been flushed', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const captured = run(new Error('too late'), { headersSent: true });

    expect(captured.status).toBeNull();
    expect(captured.body).toBeNull();
  });
});
