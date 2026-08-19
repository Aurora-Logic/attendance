import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { documentSettingsSchema, type DocumentSettings } from '@vyuha/shared';

import { apiRequest } from '@/lib/api/client';
import { parseOrThrow } from '@/lib/api/parse';

const KEY = ['documents', 'settings'] as const;

/** The printed page's identity and designs — every document screen reads it, the design rail writes it. */
export function useDocumentSettings(options: { enabled?: boolean } = {}): UseQueryResult<DocumentSettings, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: KEY,
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/documents/settings', { signal });
      return parseOrThrow(documentSettingsSchema, body, 'document settings');
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveDocumentSettings(): UseMutationResult<DocumentSettings, Error, DocumentSettings> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const response = await apiRequest<unknown>('/documents/settings', { method: 'PUT', body: input });
      return parseOrThrow(documentSettingsSchema, response, 'document settings');
    },
    onSuccess: (saved) => {
      client.setQueryData(KEY, saved);
    },
  });
}
