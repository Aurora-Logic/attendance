import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/client';

import { isUnbuiltEndpoint } from './api';

/**
 * The sample-data shim stands in for one thing only: an endpoint that does not
 * exist yet. Every other failure is a real answer and belongs in the screen's
 * error state.
 *
 * `NETWORK_ERROR` is the one that matters most and is the one that was wrong.
 * It means no server was reached at all, which on this product is not an
 * unfinished endpoint - it is a phone at a gate with no signal, the case the
 * whole offline queue exists for. Treating it as "not built yet" made a
 * development offline reload paint invented attendance over the truth: against
 * a database holding an OUT at 14:30 the strip read "Status Present, Last
 * punch Out 18:00", and the fixture's `consentAccepted: false` re-showed the
 * photo notice to somebody whose acceptance was on record. Production folded
 * the branch away, so the only build that could rehearse the offline path was
 * the only build that lied about it.
 */

const apiError = (code: ConstructorParameters<typeof ApiError>[0]['code'], status: number) =>
  new ApiError({ code, message: 'x', status });

describe('isUnbuiltEndpoint', () => {
  it('accepts a 404, which is the endpoint genuinely not being there', () => {
    expect(isUnbuiltEndpoint(apiError('NOT_FOUND', 404))).toBe(true);
  });

  it('refuses a network error, so an offline reload reaches the error state', () => {
    expect(isUnbuiltEndpoint(apiError('NETWORK_ERROR', 0))).toBe(false);
  });

  it.each([
    ['TOKEN_EXPIRED', 401],
    ['FORBIDDEN', 403],
    ['VALIDATION_FAILED', 422],
    ['INTERNAL_ERROR', 500],
  ] as const)('refuses %s, which is the server answering', (code, status) => {
    expect(isUnbuiltEndpoint(apiError(code, status))).toBe(false);
  });

  it('refuses anything that is not an ApiError at all', () => {
    expect(isUnbuiltEndpoint(new Error('boom'))).toBe(false);
    expect(isUnbuiltEndpoint(null)).toBe(false);
  });
});
