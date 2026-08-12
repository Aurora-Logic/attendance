import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import {
  isUnbuiltEndpoint,
  loadSamples,
  parseOrThrow,
  type Sampled,
} from '@/features/attendance/api';
import { ApiError, apiRequest, getAccessToken } from '@/lib/api/client';
import { ERROR_CODES } from '@vyuha/shared';

import {
  punchResultSchema,
  todayStatusSchema,
  type PunchDraft,
  type PunchResult,
  type TodayStatus,
} from './types';
import type { ClockAnchor } from './use-server-clock';

export interface TodaySnapshot extends Sampled<TodayStatus> {
  /**
   * When the answer arrived, and how far the device clock was from it.
   *
   * Sampled here rather than in the component because reading a clock during
   * render is impure, and because the honest moment to measure the difference
   * is the moment the server's answer landed - not several renders later.
   */
  anchor: ClockAnchor;
}

function anchorFor(status: TodayStatus): ClockAnchor {
  const serverEpoch = Date.parse(status.serverTime);
  const receivedAt = performance.now();
  // A server that sends an unparseable timestamp is a contract break, but it
  // is not worth blanking the whole screen over: the device clock at least
  // keeps the display moving, and the skew reads as zero rather than as a
  // wild number that would trip the REQ-D-05 warning for the wrong reason.
  if (Number.isNaN(serverEpoch)) return { serverEpoch: Date.now(), receivedAt, skewMs: 0 };
  return { serverEpoch, receivedAt, skewMs: serverEpoch - Date.now() };
}

/** `GET /me/today` (REQ-D-13): the clock, the shift, the status, the last punch. */
export function useToday(): UseQueryResult<TodaySnapshot, Error> {
  return useQuery({
    queryKey: ['me', 'today'],
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>('/me/today', { signal });
        const value = parseOrThrow(todayStatusSchema, body, "today's status");
        return { value, sample: false, anchor: anchorFor(value) };
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          const samples = await loadSamples();
          if (samples) {
            const value = samples.sampleTodayStatus();
            return { value, sample: true, anchor: anchorFor(value) };
          }
        }
        throw error;
      }
    },
    // The screen shows a ticking clock anchored to this answer, so a stale
    // anchor is a wrong clock. Short staleness, and a refetch on reconnect
    // because the offline queue drains on the same event.
    staleTime: 15_000,
    refetchOnReconnect: true,
  });
}

const BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

/**
 * The API's error envelope (technical design §6), parsed rather than trusted.
 *
 * The code is checked against the shared enum instead of accepted as any
 * string, because the whole point of the envelope is that the client maps
 * codes to messages; an unrecognised code should fall through to the generic
 * message rather than be cast into the union and quietly miss every branch.
 */
const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

/**
 * `POST /punches`, multipart (technical design §7).
 *
 * This does not go through `apiRequest`, which speaks JSON only and would
 * `JSON.stringify` a FormData into `{}`. Everything else about the call is
 * kept identical to it - the same bearer token, the same `credentials:
 * 'include'` for the refresh cookie, the same `ApiError` shape - so the
 * screen's error handling does not have to know there are two senders. When
 * `apiRequest` grows multipart support this collapses into it.
 *
 * There is deliberately no sample fallback on this path. A read may be
 * invented and labelled; a write may not. Telling somebody their punch was
 * recorded when no server heard about it is the one failure this product
 * cannot have.
 */
export async function postPunch(draft: PunchDraft): Promise<PunchResult> {
  const form = new FormData();
  form.set('type', draft.type);
  form.set('clientTime', draft.clientTime);
  form.set('photo', draft.photo, 'punch.jpg');
  if (draft.coords) {
    form.set('latitude', String(draft.coords.latitude));
    form.set('longitude', String(draft.coords.longitude));
    form.set('accuracyM', String(draft.coords.accuracyM));
  }
  if (draft.halfDay) form.set('halfDay', draft.halfDay);
  if (draft.reason) form.set('reason', draft.reason);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    // REQ-D-11: the same key on every retry of the same punch.
    'Idempotency-Key': draft.idempotencyKey,
  };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // Content-Type is left unset on purpose: fetch writes it, with the multipart
  // boundary, and setting it by hand produces a body the server cannot parse.

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/punches`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    });
  } catch (cause) {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server.',
      status: 0,
      ...(cause instanceof Error ? { details: { cause: cause.message } } : {}),
    });
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // A response that is not JSON is still a failure; it just cannot explain
      // itself. Reporting the status beats reporting a parse error.
      body = undefined;
    }
    const parsed = errorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError({
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        status: response.status,
        ...(parsed.data.error.requestId === undefined
          ? {}
          : { requestId: parsed.data.error.requestId }),
      });
    }
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: `The server returned ${String(response.status)}.`,
      status: response.status,
    });
  }

  return parseOrThrow(punchResultSchema, await response.json(), 'punch confirmation');
}

export function usePunch(): UseMutationResult<PunchResult, Error, PunchDraft> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postPunch,
    // No retry. REQ-D-11 makes a retry safe on the server, but a silent one
    // here would hide a slow upload behind a spinner that says nothing, and
    // the person is standing at a gate deciding whether to press again.
    retry: false,
    onSuccess: () => {
      // The punch changes what the next one may be, and it changes today's
      // derived day, so both are refetched rather than patched by hand.
      void queryClient.invalidateQueries({ queryKey: ['me', 'today'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}
