import { ApiError } from '@/lib/api/client';

import { creditBlockSchema, type CreditBlock } from './types';

/** The CREDIT_BLOCKED refusal's position, parsed rather than cast; a shape that moved renders the plain error instead. */
export function creditBlockOf(error: unknown): CreditBlock | null {
  if (!(error instanceof ApiError) || error.code !== 'CREDIT_BLOCKED') return null;
  const parsed = creditBlockSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}
