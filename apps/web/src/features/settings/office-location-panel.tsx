import { useState } from 'react';
import {
  BuildingsIcon,
  LockKeyIcon,
  MapPinAreaIcon,
  MapPinIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';

import { RecordPicker } from '@/components/shared/record-picker';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { formatCoordinate, parseMapsLink, type MapsLinkResult } from '@/features/org-masters/maps-link';
import { ApiError } from '@/lib/api/client';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS, type LocationSummary } from '@vyuha/shared';

import {
  DEFAULT_GEOFENCE_RADIUS_M,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  draftHasNoCentre,
  isGeofenced,
} from './office-location';
import { GEOFENCE_LABELS, type GeofenceBehaviour } from './types';
import type { OfficeDraft } from './office-location';
import type { OfficeGeofence } from './use-office-location';

/**
 * Where the office is (REQ-D-08), from Settings.
 *
 * It was only ever reachable at Organisation → Locations → Actions → Edit,
 * inside a form about names, codes and timezones. Three levels down is not
 * where anybody looks for "where is our office", and the value decides whether
 * an employee standing in the building is allowed to punch — so it gets a tab.
 *
 * A tab rather than a block inside Organisation because it edits a different
 * record: the organisation tab is a profile, this is a `locations` row, and
 * the two are saved through different routes. The Save is still the screen's
 * one Save, in the toolbar, because a reader must never have to work out which
 * of two buttons applies to the field they just edited.
 *
 * Everything the panel knows arrives through `OfficeGeofence`; the only state
 * it owns is the pasted link, which is a shortcut for filling two fields and
 * is never stored.
 */

const EMPTY_LINK: MapsLinkResult = { kind: 'empty' };

/** True while the two fields still hold exactly what the link was read as. */
function linkStillShown(
  parsed: Extract<MapsLinkResult, { kind: 'found' }>,
  draft: OfficeDraft,
): boolean {
  return (
    draft.latitude === formatCoordinate(parsed.latitude) &&
    draft.longitude === formatCoordinate(parsed.longitude)
  );
}

interface OfficeLocationPanelProps {
  office: OfficeGeofence;
  /** The Attendance tab's outcome setting, and whether anything reads it yet. */
  behaviour: { value: GeofenceBehaviour; enforcedBy: string | null | undefined };
  /** The last failure from saving this panel, if any. */
  saveError: unknown;
}

export function OfficeLocationPanel({ office, behaviour, saveError }: OfficeLocationPanelProps) {
  const [link, setLink] = useState('');
  const [parsed, setParsed] = useState<MapsLinkResult>(EMPTY_LINK);
  // The screen around this one already refuses anybody without it, so this is
  // the panel stating its own rule rather than inheriting one: a location row
  // carries the geofence, and writing it is an Admin control (OPEN-QUESTIONS
  // P1-1).
  const canManage = usePermission(PERMISSIONS.SETTINGS_MANAGE);

  const { query, locations, total, location, draft, change } = office;
  const noCentre = draft !== null && draftHasNoCentre(draft);

  function pasteLink(text: string) {
    setLink(text);
    const result = parseMapsLink(text);
    setParsed(result);
    // A short link carries no coordinates and a wrong read has to be
    // correctable, so the two number fields below are filled rather than
    // replaced by this one.
    if (result.kind === 'found') {
      office.edit({
        latitude: formatCoordinate(result.latitude),
        longitude: formatCoordinate(result.longitude),
      });
    }
  }

  return (
    <div className="flex flex-col gap-4 border p-4">
      <SectionHeading
        title="Office location"
        note="The centre and radius that decide where a punch from a phone is accepted."
      />

      {query.isPending ? <PanelSkeleton /> : null}

      {query.isError ? <LoadFailure error={query.error} onRetry={() => void query.refetch()} /> : null}

      {!query.isPending && !query.isError && location === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BuildingsIcon />
            </EmptyMedia>
            <EmptyTitle>There are no locations yet</EmptyTitle>
            <EmptyDescription>
              A geofence belongs to a place people work from. Add one under Organisation →
              Locations — it needs a name and a code — then set its centre here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {location !== null && draft !== null ? (
        <>
          <GeofenceStatus location={location} behaviour={behaviour} />

          {!canManage ? (
            <Alert>
              <LockKeyIcon />
              <AlertTitle>You can read this, but not change it</AlertTitle>
              <AlertDescription>
                Editing a location needs the settings.manage permission, because its centre decides
                from where a punch is accepted. Ask an administrator to make the change.
              </AlertDescription>
            </Alert>
          ) : null}

          {change.kind === 'invalid' ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>This will not be saved as it stands</AlertTitle>
              <AlertDescription>
                {change.message} Nothing on this tab is sent until it is fixed; the other tabs save
                as usual.
              </AlertDescription>
            </Alert>
          ) : null}

          {saveError ? <SaveFailure error={saveError} /> : null}

          <FieldGroup className="grid gap-5 md:grid-cols-2">
            {locations.length > 1 ? (
              <Field className="md:col-span-2">
                <FieldLabel htmlFor="office-location-pick">Location</FieldLabel>
                <RecordPicker
                  id="office-location-pick"
                  label="Location"
                  placeholder="Choose a location"
                  searchPlaceholder="Search locations"
                  emptyMessage="No location matches that."
                  disabled={!canManage}
                  icon={<BuildingsIcon className="text-muted-foreground shrink-0" />}
                  value={{ id: location.id, label: location.name, hint: location.code }}
                  options={locations.map((row) => ({
                    id: row.id,
                    label: row.name,
                    hint: row.code,
                  }))}
                  onValueChange={(next) => {
                    if (next === null) return;
                    office.select(next.id);
                    setLink('');
                    setParsed(EMPTY_LINK);
                  }}
                />
                <FieldDescription>
                  Each location has its own centre and radius.
                  {total > locations.length
                    ? ` Showing the first ${String(locations.length)} of ${String(total)}; the rest are under Organisation → Locations.`
                    : ''}
                </FieldDescription>
              </Field>
            ) : null}

            {/* The paste field comes first because it is how this gets filled
                in practice. Nobody types a latitude — they press Share in
                Google Maps and paste. */}
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="office-maps-link">Paste a Google Maps link</FieldLabel>
              <Input
                id="office-maps-link"
                placeholder="https://www.google.com/maps/@19.0759837,72.8776559,17z"
                disabled={!canManage}
                value={link}
                onChange={(event) => {
                  pasteLink(event.target.value);
                }}
              />
              <FieldDescription>
                It fills the two fields below. The link itself is not stored, so check the numbers
                before saving.
              </FieldDescription>
            </Field>

            {/* Only while the fields still hold what the link produced.
                Discarding the draft, or correcting a wrong read by hand, puts
                different numbers below this alert — and a read-back that no
                longer describes the fields it points at is worse than none. */}
            {parsed.kind === 'found' && linkStillShown(parsed, draft) ? (
              <Alert className="md:col-span-2">
                <MapPinIcon />
                <AlertTitle>Read from the link</AlertTitle>
                <AlertDescription>
                  {formatCoordinate(parsed.latitude)}, {formatCoordinate(parsed.longitude)} — check
                  it against the map before saving.
                </AlertDescription>
              </Alert>
            ) : null}

            {parsed.kind === 'short-link' || parsed.kind === 'unrecognised' ? (
              <Alert variant="destructive" className="md:col-span-2">
                <WarningCircleIcon />
                <AlertTitle>
                  {parsed.kind === 'short-link'
                    ? 'That link hides its coordinates'
                    : 'No coordinates in that'}
                </AlertTitle>
                <AlertDescription>{parsed.message}</AlertDescription>
              </Alert>
            ) : null}

            <Field>
              <FieldLabel htmlFor="office-latitude">Latitude</FieldLabel>
              <Input
                id="office-latitude"
                type="number"
                inputMode="decimal"
                step="any"
                min={-90}
                max={90}
                disabled={!canManage}
                className="tabular-nums"
                value={draft.latitude}
                onChange={(event) => {
                  office.edit({ latitude: event.target.value });
                }}
              />
              <FieldDescription>North–south. Between -90 and 90.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="office-longitude">Longitude</FieldLabel>
              <Input
                id="office-longitude"
                type="number"
                inputMode="decimal"
                step="any"
                min={-180}
                max={180}
                disabled={!canManage}
                className="tabular-nums"
                value={draft.longitude}
                onChange={(event) => {
                  office.edit({ longitude: event.target.value });
                }}
              />
              <FieldDescription>
                East–west. Both or neither: clearing both switches geofencing off.
              </FieldDescription>
            </Field>

            <Field className="md:col-span-2" data-disabled={noCentre ? '' : undefined}>
              <FieldLabel htmlFor="office-radius">Radius (metres)</FieldLabel>
              <Input
                id="office-radius"
                type="number"
                inputMode="numeric"
                min={MIN_RADIUS_M}
                max={MAX_RADIUS_M}
                // A radius does nothing without a centre, and a field that
                // accepts a number nothing will ever read is worse than one
                // that says so.
                disabled={!canManage || noCentre}
                className="tabular-nums md:max-w-xs"
                value={draft.radiusM}
                onChange={(event) => {
                  office.edit({ radiusM: event.target.value });
                }}
              />
              <FieldDescription>
                {noCentre
                  ? 'A radius does nothing until a centre is set above.'
                  : `Use about ${String(DEFAULT_GEOFENCE_RADIUS_M)} m. A phone indoors is routinely 30 to 50 metres out, and a tight circle plus a poor fix refuses a real employee standing in the office. The punch already allows for the accuracy the phone reports, so a generous radius is not a hole. Between ${MIN_RADIUS_M.toLocaleString('en-GB')} and ${MAX_RADIUS_M.toLocaleString('en-GB')}.`}
              </FieldDescription>
            </Field>
          </FieldGroup>

          <FieldSeparator />

          <AllowlistNote location={location} />
        </>
      ) : null}
    </div>
  );
}

/**
 * The sentence REQ-D-08 turns on, said rather than left to be inferred from an
 * empty field.
 *
 * It reads the saved row, not the draft: it answers "what happens if somebody
 * punches right now", and right now the server still has the old value.
 */
function GeofenceStatus({
  location,
  behaviour,
}: {
  location: LocationSummary;
  behaviour: { value: GeofenceBehaviour; enforcedBy: string | null | undefined };
}) {
  if (!isGeofenced(location)) {
    return (
      <Alert>
        <MapPinIcon />
        <AlertTitle>Geofencing is off for {location.name}</AlertTitle>
        <AlertDescription>
          No centre is set, so nothing checks where a punch comes from. A punch from a phone is
          accepted wherever the person is standing, and recorded with a flag saying the check was
          off. Paste a Google Maps link below to switch it on.
        </AlertDescription>
      </Alert>
    );
  }

  const outside =
    behaviour.enforcedBy === null || behaviour.enforcedBy === undefined
      ? 'A punch from further away is refused, after the accuracy the phone reports is subtracted from the distance — so a poor fix gets the benefit of the doubt. The "Punch outside the location radius" setting on the Attendance tab does not change that yet: the punch blocks whatever it says.'
      : `A punch from further away follows the "Punch outside the location radius" setting on the Attendance tab, currently "${GEOFENCE_LABELS[behaviour.value].toLowerCase()}", measured after the accuracy the phone reports is subtracted from the distance.`;

  return (
    <Alert>
      <MapPinAreaIcon />
      <AlertTitle>
        Geofencing is on for {location.name}: {String(location.geofenceRadiusM)} m around{' '}
        {location.geofenceLat === null ? '' : formatCoordinate(location.geofenceLat)},{' '}
        {location.geofenceLng === null ? '' : formatCoordinate(location.geofenceLng)}
      </AlertTitle>
      <AlertDescription>
        {outside} A punch with no location at all is accepted with a typed reason and flagged, and
        field staff are exempt.
      </AlertDescription>
    </Alert>
  );
}

/** REQ-D-09, stated and not editable here — see the panel's own comment. */
function AllowlistNote({ location }: { location: LocationSummary }) {
  const count = location.ipAllowlist.length;

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">Office IP allowlist</h3>
      <p className="text-muted-foreground max-w-prose text-xs">
        {count === 0
          ? `Not enforced. No addresses are listed for ${location.name}, so a punch from a browser is not restricted by network — it is accepted and flagged to say the check was off. Geofencing above is the control that decides where a punch may come from.`
          : `Enforced. ${String(count)} address${count === 1 ? '' : 'es'} listed, so a punch from a browser at ${location.name} is accepted only from ${count === 1 ? 'it' : 'them'}.`}{' '}
        It is set per location under Organisation → Locations, not here.
      </p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the office location">
      <div className="grid gap-5 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} aria-hidden className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Reading the list takes `employee.view` while writing takes `settings.manage`
 * (OPEN-QUESTIONS P1-1), so an administrator without the read key reaches this
 * tab and cannot load it. That is worth its own sentence: the shared error
 * alert would say the reader is out of scope, which is a different problem.
 */
function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const forbidden =
    error instanceof ApiError && (error.code === 'FORBIDDEN' || error.code === 'OUT_OF_SCOPE');

  if (!forbidden) return <QueryErrorAlert error={error} subject="locations" onRetry={onRetry} />;

  return (
    <Alert variant="destructive">
      <LockKeyIcon />
      <AlertTitle>The list of locations could not be read</AlertTitle>
      <AlertDescription>
        Reading locations needs the employee.view permission, which this account does not have —
        changing one needs settings.manage, which it does. Ask an administrator to add employee.view
        to your role, or set the geofence from Organisation → Locations.
      </AlertDescription>
    </Alert>
  );
}

function SaveFailure({ error }: { error: unknown }) {
  const api = error instanceof ApiError ? error : null;

  return (
    <Alert variant="destructive">
      <WarningCircleIcon />
      <AlertTitle>
        {api !== null && (api.code === 'NETWORK_ERROR' || api.status === 404)
          ? 'Not saved: the server could not be reached'
          : 'The office location was not saved'}
      </AlertTitle>
      <AlertDescription>
        {api !== null && api.code === 'VALIDATION_FAILED'
          ? api.message
          : 'Your edits are still here. The centre on the server is unchanged.'}
        {api?.requestId ? (
          <span className="mt-1 block font-mono text-[0.6875rem]">Request {api.requestId}</span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
