import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { GO_TO_QUERY_MIN_LENGTH } from '@vyuha/shared';
import { z } from 'zod';

import { parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

/**
 * `/go-to?q=` for the palette (REQ-O-05). The server owns which records exist
 * and who may see them; this hook owns not asking too often.
 */

const goToRecordSchema = z.object({
  // `type` stays an open string: the server may learn a record type before
  // this bundle redeploys, and the palette drops what it cannot route rather
  // than refusing the whole answer.
  type: z.string(),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  code: z.string().nullable(),
});

const goToResponseSchema = z.object({
  query: z.string(),
  records: z.array(goToRecordSchema),
});

export type GoToResults = z.infer<typeof goToResponseSchema>;

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === debounced) return undefined;
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, debounced, delayMs]);
  return debounced;
}

export function useGoToRecords(rawTerm: string): UseQueryResult<GoToResults, Error> {
  // 250ms: under the threshold where the palette feels laggy, over the rate a
  // fast typist emits keystrokes, so a query goes out per pause, not per key.
  const term = useDebouncedValue(rawTerm.trim(), 250);

  return useQuery({
    enabled: term.length >= GO_TO_QUERY_MIN_LENGTH,
    queryKey: ['go-to', term],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/go-to?q=${encodeURIComponent(term)}`, { signal });
      return parseOrThrow(goToResponseSchema, body, 'Go To records');
    },
    // Between keystrokes the previous answer stays up instead of the list
    // flashing empty — stale-but-visible loses to the next answer in ~100ms.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
