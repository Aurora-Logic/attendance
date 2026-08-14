import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { consentAcceptanceInputSchema } from '@vyuha/shared';

import {
  isUnbuiltEndpoint,
  loadSamples,
  parseOrThrow,
  type Sampled,
} from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';
import { postMultipart } from '@/lib/offline/multipart';

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

/**
 * The JSON half of the `POST /punches` multipart body.
 *
 * One `payload` part carrying JSON, plus one `photo` file part — not a flat
 * field per fact. `punch.dto.ts` on the server parses `payload` with
 * `punchSubmissionSchema` and there is no shape without it; the flat version
 * this used to send answered 400 on every punch.
 *
 * `source` is `WEB` and not `MOBILE`, deliberately. The server enforces the
 * office IP allowlist (REQ-D-09) on a `WEB` punch and the geofence (REQ-D-08)
 * on a `MOBILE` one, and the client is the wrong place to decide which control
 * it is subject to: a laptop claiming `MOBILE` would walk around the allowlist.
 * This is a browser, so it says so, and the stricter of the two applies. Which
 * signal a PWA installed on a phone should be judged by is a policy question
 * neither the PRD nor the technical design settles.
 */
function submissionPayload(draft: PunchDraft): string {
  return JSON.stringify({
    type: draft.type,
    clientTime: draft.clientTime,
    source: 'WEB',
    ...(draft.coords
      ? {
          latitude: draft.coords.latitude,
          longitude: draft.coords.longitude,
          gpsAccuracyM: draft.coords.accuracyM,
        }
      : {}),
    isHalfDay: draft.halfDay !== null,
    ...(draft.halfDay === null ? {} : { halfDayPart: draft.halfDay }),
    ...(draft.reason === null || draft.reason === '' ? {} : { reason: draft.reason }),
  });
}

/**
 * `POST /punches`, multipart (technical design §7).
 *
 * There is deliberately no sample fallback on this path. A read may be
 * invented and labelled; a write may not. Telling somebody their punch was
 * recorded when no server heard about it is the one failure this product
 * cannot have.
 */
export async function postPunch(draft: PunchDraft): Promise<PunchResult> {
  const form = new FormData();
  form.set('payload', submissionPayload(draft));
  form.set('photo', draft.photo, 'punch.jpg');

  return postMultipart(
    '/punches',
    form,
    (body) => parseOrThrow(punchResultSchema, body, 'punch confirmation'),
    // REQ-D-11: the same key on every retry of the same punch.
    { 'Idempotency-Key': draft.idempotencyKey },
  );
}

/**
 * `POST /me/consent` (REQ-M-03): records that this account accepted the
 * photo-and-location notice, so it stops reappearing on every visit.
 *
 * Errors are deliberately not surfaced as their own state on the screen. The
 * checkbox already gates the punch locally for this session; if the recording
 * failed -- typically because the device is offline -- the only consequence is
 * that the notice appears once more next time, which is the safe direction for
 * a required notice to fail in.
 */
export function useAcceptConsent(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiRequest<unknown>('/me/consent', {
        method: 'POST',
        body: consentAcceptanceInputSchema.parse({ consentKey: 'attendance.punch_capture' }),
      });
    },
    onSuccess: () => {
      // The context's `consentAccepted` just changed; the next read of
      // /me/today must say so rather than serve the stale gate.
      void queryClient.invalidateQueries({ queryKey: ['me', 'today'] });
    },
  });
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
