import { z } from 'zod';

import { ApiError } from './client';

/**
 * Validates a response body against its screen-side contract, throwing the
 * same `ApiError` shape a failed request produces so error surfaces have one
 * kind of thing to render.
 *
 * In `lib/` rather than a feature: the app shell (Go To, branding) parses
 * responses too, and the shell importing a feature is the web-side version
 * of platform importing modules — the coupling the API's boundary lint
 * refuses and the web must refuse by convention until it grows one.
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
