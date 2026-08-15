import { useState } from 'react';
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { parseOrThrow } from '@/features/attendance/api';
import { locationSchema } from '@/features/org-masters/types';
import { useLocationList } from '@/features/org-masters/use-masters';
import { apiRequest } from '@/lib/api/client';
import type { LocationSummary, Paginated } from '@vyuha/shared';

import {
  geofencePatchSchema,
  officeChangeOf,
  officeDraftOf,
  type GeofenceValues,
  type OfficeChange,
  type OfficeDraft,
} from './office-location';

/**
 * The Settings screen's view of the office geofence (REQ-D-08).
 *
 * The read is `useLocationList`, the hook Organisation → Locations already
 * uses, rather than a second query over the same route: one cache entry means
 * a centre saved here repaints there and the other way round, and it keeps
 * this screen out of the business of paginating a master list.
 *
 * The write is the same `PATCH /locations/:id` the location sheet posts to, so
 * the audit entry, the RBAC check and the "both halves or neither" rule are
 * the server's, once, for both doors onto this value.
 */

export interface GeofenceWrite extends GeofenceValues {
  readonly locationId: string;
}

export function useSaveGeofence(): UseMutationResult<LocationSummary, Error, GeofenceWrite> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ locationId, ...values }: GeofenceWrite) => {
      const body = await apiRequest<unknown>(`/locations/${locationId}`, {
        method: 'PATCH',
        // Parsed against the server's own schema before it leaves, so a bound
        // that moves upstream fails here rather than as a 400 the reader has
        // to interpret.
        body: geofencePatchSchema.parse(values),
      });
      return parseOrThrow(locationSchema, body, 'saved location');
    },
    onSuccess: () => {
      // This panel, the masters screen, and the punch screen's own statement
      // of whether a geofence is in force and how wide it is.
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      void queryClient.invalidateQueries({ queryKey: ['me', 'today'] });
    },
  });
}

export interface OfficeGeofence {
  readonly query: UseQueryResult<Paginated<LocationSummary>, Error>;
  /** The page of locations on screen; empty until the query resolves. */
  readonly locations: readonly LocationSummary[];
  /** How many exist in total, which can exceed the page above. */
  readonly total: number;
  /** The one being edited: the only one, or whichever was picked. */
  readonly location: LocationSummary | null;
  readonly draft: OfficeDraft | null;
  readonly change: OfficeChange;
  /** What Save should send, or null when there is nothing to send. */
  readonly write: GeofenceWrite | null;
  readonly select: (locationId: string) => void;
  readonly edit: (next: Partial<Omit<OfficeDraft, 'locationId'>>) => void;
  /** Back to the last thing the server said. */
  readonly reset: () => void;
}

/**
 * One location's geofence, held as edits over the server's row rather than as
 * a copy of it.
 *
 * `edited` is null until somebody types, and the draft is derived from the
 * fetched row until then. That is what makes a refetch — or a save — repaint
 * without an effect to reseed the form, and it is why switching location
 * cannot leave the previous location's coordinates on screen for a frame.
 */
export function useOfficeGeofence(): OfficeGeofence {
  const query = useLocationList({ q: '', page: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edited, setEdited] = useState<OfficeDraft | null>(null);

  const locations = query.data?.data ?? [];
  const location =
    locations.find((row) => row.id === selectedId) ?? locations.at(0) ?? null;

  const draft =
    location === null
      ? null
      : edited !== null && edited.locationId === location.id
        ? edited
        : officeDraftOf(location);

  const change: OfficeChange =
    draft === null || location === null ? { kind: 'clean' } : officeChangeOf(draft, location);

  return {
    query,
    locations,
    total: query.data?.meta.total ?? 0,
    location,
    draft,
    change,
    write:
      change.kind === 'dirty' && location !== null
        ? { locationId: location.id, ...change.values }
        : null,
    select: (locationId: string) => {
      setSelectedId(locationId);
      // Edits belong to the location they were typed against, never to the
      // next one.
      setEdited(null);
    },
    edit: (next) => {
      if (draft === null) return;
      setEdited({ ...draft, ...next });
    },
    reset: () => {
      setEdited(null);
    },
  };
}
