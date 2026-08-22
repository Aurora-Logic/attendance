import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { HELP_TOPICS, type HelpCard, type HelpCardsResponse } from '@vyuha/shared';
import { z } from 'zod';

import { ApiError, apiRequest } from '@/lib/api/client';

/**
 * REQ-AJ-01 (proposed): the corpus, fetched once and kept.
 *
 * The whole permitted set arrives in one response and is searched in the
 * browser. Three things follow from that and all three are the point: an
 * answer appears as the letter is typed rather than a round-trip later, no
 * request carries what somebody asked, and the panel keeps working with no
 * network once the set is in hand — which matters most on the punch screen,
 * the one place people stand in a doorway with one bar of signal.
 *
 * Fetched lazily, on first open. Most people never ask for help, and a corpus
 * they will not read has no business on the critical path of every sign-in.
 */

export const HELP_QUERY_ROOT = ['help'] as const;

/**
 * A deploy is the only thing that changes the corpus, and a session does not
 * outlive one. So nothing re-fetches it: no interval, no refetch on focus.
 */
const CORPUS_STALE_MS = Infinity;

const helpCardSchema = z.object({
  id: z.string(),
  question: z.string(),
  aliases: z.array(z.string()).readonly(),
  answer: z.string(),
  route: z.string().nullable(),
  permission: z.string().nullable(),
  tourStep: z.string().nullable(),
  errorCodes: z.array(z.string()).readonly(),
  topic: z.enum(HELP_TOPICS),
}) satisfies z.ZodType<unknown>;

const helpCardsResponseSchema = z.object({
  cards: z.array(helpCardSchema).readonly(),
});

function parsed(body: unknown): HelpCardsResponse {
  const result = helpCardsResponseSchema.safeParse(body);
  if (!result.success) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'The help answers came back in a shape this panel cannot read.',
      status: 0,
      details: { issues: z.treeifyError(result.error) },
    });
  }
  // The schema widens `permission` and `errorCodes` to strings rather than
  // repeating two unions the server already validated against; the cast puts
  // the contract's types back on a value that has been checked for shape.
  return result.data as HelpCardsResponse;
}

export function useHelpCards(enabled: boolean): UseQueryResult<readonly HelpCard[], Error> {
  return useQuery({
    enabled,
    queryKey: [...HELP_QUERY_ROOT, 'cards'],
    queryFn: async ({ signal }) =>
      parsed(await apiRequest<unknown>('/help/cards', { signal })).cards,
    staleTime: CORPUS_STALE_MS,
    refetchOnWindowFocus: false,
  });
}
