import { z } from 'zod';

import { ApiError } from '@/lib/api/client';

/**
 * The temporary bridge between finished screens and unfinished endpoints.
 *
 * Every screen in this module calls its real endpoint through `apiRequest`.
 * When that call fails *because the endpoint does not exist yet* — and only
 * then — a development build serves a sample payload instead and marks the
 * result, so the screen can say out loud that it is not showing real data.
 *
 * Three properties this has to keep:
 *
 * 1. It is never silent. Every hook that can fall back returns `sample: true`
 *    with the data, and every screen that can receive it renders the notice.
 * 2. It cannot reach production. The dynamic import below sits inside
 *    `if (import.meta.env.DEV)`, which Vite replaces with `false` at build
 *    time, so rollup drops the branch and the chunk it references. A static
 *    import would not give that guarantee.
 * 3. Connecting the real endpoint is a deletion, not a rewrite. Remove the
 *    `catch` block from a hook and the screen is already wired.
 */

/** Data plus whether it came from the sample set rather than the server. */
export interface Sampled<T> {
  value: T;
  sample: boolean;
}

/**
 * True when the failure means "there is no such endpoint yet" rather than
 * "the endpoint refused". A 403, a 401 or a 500 are real answers from a real
 * server and must reach the screen's error state untouched — falling back on
 * those would paper over a permission bug with plausible-looking rows.
 *
 * A 404 and nothing else. `NETWORK_ERROR` used to count, and it is the one
 * code that must not: it means no server was reached at all, which is the
 * ordinary state of this app on a phone with no signal. On a development
 * offline reload the punch screen therefore showed invented attendance -
 * measured against a database holding an OUT at 14:30, the strip read "Status
 * Present, Last punch Out 18:00" - and the sample's `consentAccepted: false`
 * put the photo-and-location notice back in front of somebody whose
 * acceptance was already recorded. A production build folds the branch away,
 * so the one build where the offline path can be rehearsed was the one build
 * that lied about it.
 */
export function isUnbuiltEndpoint(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

type SampleModule = typeof import('@/lib/fixtures/attendance');

/**
 * The sample module in development, `null` in a production build.
 *
 * Callers must handle `null` by rethrowing, so a production build behaves as
 * though the fallback were already deleted.
 */
export async function loadSamples(): Promise<SampleModule | null> {
  if (!import.meta.env.DEV) return null;
  return import('@/lib/fixtures/attendance');
}

/**
 * Parses a response or turns the mismatch into the error the screen can show.
 *
 * A Zod failure here is a contract break, not a network problem, so it is
 * reported as one rather than as "could not reach the server".
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ApiError({
    code: 'INTERNAL_ERROR',
    message: `The ${what} came back in a shape this screen cannot read.`,
    status: 0,
    details: { issues: z.treeifyError(parsed.error) },
  });
}
