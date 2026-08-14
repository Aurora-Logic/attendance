import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';

import { withDevFixture } from './dev-fixture-fallback';

/**
 * The same rule the attendance shim is held to, tested through the wrapper
 * rather than through the predicate, so the DEV gate is exercised too.
 *
 * Vitest runs with `import.meta.env.DEV` true, which is the build where the
 * fallback is live - so this is the build in which a network error could serve
 * fixtures, and the only one in which the mistake was visible.
 */

const envelope = { data: [{ id: 'real' }], meta: { total: 1 } };

const failing = (error: Error) => () => Promise.reject(error);

describe('withDevFixture', () => {
  it('passes the real answer straight through, marked as real', async () => {
    const result = await withDevFixture(
      () => Promise.resolve(envelope),
      (fixtures) => fixtures.leaveTypesFixture() as unknown as typeof envelope,
    );
    expect(result).toEqual({ ...envelope, sample: false });
  });

  it('stands in for a 404, which is the endpoint genuinely not being there', async () => {
    const result = await withDevFixture(
      failing(new ApiError({ code: 'NOT_FOUND', message: 'no such route', status: 404 })),
      (fixtures) => fixtures.leaveTypesFixture() as unknown as typeof envelope,
    );
    expect(result.sample).toBe(true);
  });

  it('rethrows a network error, so an offline reload shows the error state', async () => {
    const cause = new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server.',
      status: 0,
    });

    await expect(
      withDevFixture(
        failing(cause),
        (fixtures) => fixtures.leaveTypesFixture() as unknown as typeof envelope,
      ),
    ).rejects.toBe(cause);
  });

  it('rethrows a refusal, so a permission bug is not papered over with rows', async () => {
    const cause = new ApiError({ code: 'FORBIDDEN', message: 'not yours', status: 403 });

    await expect(
      withDevFixture(
        failing(cause),
        (fixtures) => fixtures.leaveTypesFixture() as unknown as typeof envelope,
      ),
    ).rejects.toBe(cause);
  });
});
