import { useState } from 'react';
import {
  BuildingsIcon,
  CameraIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  LockKeyIcon,
  MapPinAreaIcon,
  FileTextIcon,
  MoonIcon,
  PaperPlaneTiltIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SampleDataNotice } from '@/features/attendance/sample-data-notice';
import {
  RecordHistoryButton,
  RecordHistorySheet,
} from '@/features/audit/record-history-sheet';
import { ApiError } from '@/lib/api/client';
import { useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { DEVICE_BINDING_MODES, PERMISSIONS, PUNCH_WINDOW_BEHAVIOURS } from '@vyuha/shared';

import { AccessWindowPanel } from './access-window-panel';
import { DocumentsPanel } from './documents-panel';
import { OfficeLocationPanel } from './office-location-panel';
import { PolicyChoiceField, PolicyNumberField } from './policy-fields';
import {
  DATE_FORMATS,
  DEVICE_BINDING_LABELS,
  GEOFENCE_BEHAVIOURS,
  GEOFENCE_LABELS,
  MONTH_LABELS,
  PUNCH_WINDOW_LABELS,
  TIMEZONE_OPTIONS,
  WEEKDAY_LABELS,
  type AttendancePolicy,
  type OrgProfile,
  type OrgSettings,
  type PhotoPolicy,
  type SettingsPatch,
} from './types';
import { useAccessWindowDraft, useSaveAccessWindow } from './use-access-window';
import { useOfficeGeofence, useSaveGeofence } from './use-office-location';
import { useSaveSettings, useSettings, useTestEmail } from './use-settings';

/**
 * REQ-L-01 to REQ-L-05 / PRD §5 screen 16, plus the office geofence (REQ-D-08).
 *
 * One Save for the whole screen rather than one per tab. The draft is held for
 * all four settings groups and the request carries only the groups that
 * changed, so saving the timezone cannot blank the punch policy and the reader
 * never has to work out which of four buttons applies to the field they just
 * edited.
 *
 * The office location tab is the one thing here that is not a settings row:
 * the geofence centre lives on a `locations` record, so Save sends a second
 * request to a second endpoint. That stays behind the same button — two Save
 * buttons on one screen is exactly what the paragraph above exists to avoid —
 * but the two requests are independent, and the screen reports which of them
 * landed rather than assuming both did. The access window (12 REQ-AB-02) is
 * the third such row: its own route, the same Save.
 */

const KB = 1024;

interface Draft {
  organisation: OrgProfile;
  attendance: AttendancePolicy;
  photo: PhotoPolicy;
}

function draftOf(settings: OrgSettings): Draft {
  return {
    organisation: settings.organisation,
    attendance: settings.attendance,
    photo: settings.photo,
  };
}

function sameGroup(left: unknown, right: unknown): boolean {
  // Every group is a flat object of strings and numbers, so serialised
  // equality is exactly the equality that decides whether to send it.
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Only the groups that moved. An unchanged group left out of the body is what
 * makes "absent means unchanged" safe on the server.
 */
function patchOf(draft: Draft, saved: OrgSettings): SettingsPatch {
  const patch: SettingsPatch = {};

  if (!sameGroup(draft.organisation, saved.organisation)) {
    patch.organisation = {
      name: draft.organisation.name,
      legalName: draft.organisation.legalName,
      timezone: draft.organisation.timezone,
      dateFormat: draft.organisation.dateFormat,
      weekStart: draft.organisation.weekStart,
      leaveYearStartMonth: draft.organisation.leaveYearStartMonth,
    };
  }
  if (!sameGroup(draft.attendance, saved.attendance)) patch.attendance = draft.attendance;
  if (!sameGroup(draft.photo, saved.photo)) patch.photo = draft.photo;

  return patch;
}

function FormSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading settings" className="border p-4">
      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} aria-hidden className="flex flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-3 w-56" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const canManage = usePermission(PERMISSIONS.SETTINGS_MANAGE);
  const query = useSettings({ enabled: canManage });
  const saved = query.data?.value ?? null;

  return (
    <>
      <PageHeader description="Organisation profile, attendance policy, photo retention, outbound email and the sign-in window." />

      {canManage ? (
        <div className="flex flex-col gap-4">
          {query.data?.sample ? <SampleDataNotice what="settings" /> : null}

          {query.isPending ? <FormSkeleton /> : null}

          {query.isError ? (
            <QueryErrorAlert
              error={query.error}
              subject="settings"
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : null}

          {saved ? <SettingsForm key={saved.organisation.id} saved={saved} /> : null}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot change organisation settings</EmptyTitle>
            <EmptyDescription>
              This screen needs the settings.manage permission. Ask an administrator to grant it,
              or ask them to make the change for you.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
  );
}

function SettingsForm({ saved }: { saved: OrgSettings }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [historyOpen, setHistoryOpen] = useState(false);
  const save = useSaveSettings();
  const office = useOfficeGeofence();
  const saveOffice = useSaveGeofence();
  const accessWindow = useAccessWindowDraft();
  const saveWindow = useSaveAccessWindow();
  // REQ-M-02 and REQ-L-05. Settings are the one record where the diff matters
  // more than the current value: "what is the retention now" is on the screen,
  // and "who shortened it, and when" is the question a purged photo raises.
  const canReadTrail = usePermission(PERMISSIONS.AUDIT_VIEW);

  const patch = patchOf(draft, saved);
  const officeWrite = office.write;
  const windowWrite = accessWindow.write;
  const changedSections = Object.keys(patch).length + (officeWrite === null ? 0 : 1) + (windowWrite === null ? 0 : 1);
  const dirty = changedSections > 0;
  const saving = save.isPending || saveOffice.isPending || saveWindow.isPending;
  // An office draft the panel refuses to send is not "saved", and the status
  // line would be lying if it said so.
  const officeBlocked = office.change.kind === 'invalid';

  function submit() {
    if (!dirty || saving) return;

    const settingsPatch = Object.keys(patch).length > 0 ? patch : null;

    void (async () => {
      // allSettled, not all: a refused geofence must not throw away an edited
      // timezone that the server already accepted, and one rejection must not
      // leave the other promise unhandled.
      const [settingsResult, officeResult, windowResult] = await Promise.allSettled([
        settingsPatch === null ? Promise.resolve(null) : save.mutateAsync(settingsPatch),
        officeWrite === null ? Promise.resolve(null) : saveOffice.mutateAsync(officeWrite),
        windowWrite === null ? Promise.resolve(null) : saveWindow.mutateAsync(windowWrite),
      ]);

      const savedSettings = settingsResult.status === 'fulfilled' && settingsResult.value !== null;
      const savedOffice = officeResult.status === 'fulfilled' && officeResult.value !== null;
      const savedWindow = windowResult.status === 'fulfilled' && windowResult.value !== null;

      if (settingsResult.status === 'fulfilled' && settingsResult.value !== null) {
        setDraft(draftOf(settingsResult.value));
      }
      // The panels derive their fields from the fetched row, so dropping the
      // edits is what makes the server's answer the thing on screen.
      if (savedOffice) office.reset();
      if (savedWindow) accessWindow.reset();

      // PRD §6.6: the toast repeats the action the button named — and names
      // only what actually saved. A failure is rendered above the fields it
      // did not save, not in a corner the reader has already looked away from.
      const savedNames = [savedSettings ? 'Settings' : null, savedOffice ? 'office location' : null, savedWindow ? 'access window' : null].filter((name): name is string => name !== null);
      if (savedNames.length > 0) {
        const first = savedNames[0] ?? 'Settings';
        const title = savedNames.length === 1 ? `${first.charAt(0).toUpperCase()}${first.slice(1)} saved` : `${first.charAt(0).toUpperCase()}${first.slice(1)} and ${savedNames.slice(1).join(' and ')} saved`;
        toast.add({
          type: 'success',
          title,
          description: 'The change is recorded in the audit log.',
        });
      }
    })();
  }

  // PRD §6.4: Ctrl+A is Accept / Save, and it fires from inside a field.
  useShortcut({
    id: 'settings.save',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'screen',
    allowInInput: true,
    when: () => dirty && !saving,
    run: submit,
  });

  function patchOrganisation(next: Partial<OrgProfile>) {
    setDraft((current) => ({ ...current, organisation: { ...current.organisation, ...next } }));
  }
  function patchAttendance(next: Partial<AttendancePolicy>) {
    setDraft((current) => ({ ...current, attendance: { ...current.attendance, ...next } }));
  }
  function patchPhoto(next: Partial<PhotoPolicy>) {
    setDraft((current) => ({ ...current, photo: { ...current.photo, ...next } }));
  }

  return (
    <div className="flex flex-col gap-4">
      {saved.unreadableKeys.length > 0 ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>Some stored settings could not be read</AlertTitle>
          <AlertDescription>
            The default is shown instead for {saved.unreadableKeys.join(', ')}. Saving this screen
            replaces the stored value with a valid one.
          </AlertDescription>
        </Alert>
      ) : null}

      {save.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>
            {save.error instanceof ApiError &&
            (save.error.code === 'NETWORK_ERROR' || save.error.status === 404)
              ? 'Not saved: the settings endpoint is not connected yet'
              : 'Could not save these settings'}
          </AlertTitle>
          <AlertDescription>
            {save.error instanceof ApiError && save.error.code === 'VALIDATION_FAILED'
              ? save.error.message
              : 'Your edits are still here. Nothing was sent to the server, so nothing changed.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Toolbar row (PRD §6.2). The primary action sits here rather than in
          each tab, because one Save covers the whole draft. */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-xs" aria-live="polite">
          {dirty
            ? `Unsaved changes in ${String(changedSections)} section${changedSections === 1 ? '' : 's'}.`
            : officeBlocked
              ? 'Nothing to save.'
              : 'Everything on this screen is saved.'}
          {officeBlocked ? ' The office location has a problem to fix first.' : ''}
        </p>
        {canReadTrail ? (
          <RecordHistoryButton
            onClick={() => {
              setHistoryOpen(true);
            }}
          />
        ) : null}
        {dirty || officeBlocked ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(draftOf(saved));
              office.reset();
              accessWindow.reset();
              save.reset();
              saveOffice.reset();
              saveWindow.reset();
            }}
          >
            Discard changes
          </Button>
        ) : null}
        <Button size="sm" disabled={!dirty || saving} onClick={submit}>
          {saving ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ACTION_ICONS.save data-icon="inline-start" />
          )}
          {saving ? 'Saving' : 'Save'}
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
      </div>

      <Tabs defaultValue="organisation" className="gap-4">
        {/* Scrolls rather than stretching the page.
            Four labelled tabs do not fit in 360px, and a TabsList that
            overflows widens the document -- which then drags the fixed bottom
            navigation out with it, because a fixed element at width 100% follows
            the document, not the viewport. The visible symptom was 32px of
            horizontal scroll on the whole screen, a long way from its cause.
            A scrolling tab strip is the standard mobile answer; wrapping to two
            rows would push the content down on every phone. */}
        <TabsList className="no-scrollbar max-w-full overflow-x-auto">
          <TabsTrigger value="organisation" className="px-3">
            <BuildingsIcon data-icon="inline-start" />
            Organisation
          </TabsTrigger>
          <TabsTrigger value="office" className="px-3">
            <MapPinAreaIcon data-icon="inline-start" />
            Office location
          </TabsTrigger>
          <TabsTrigger value="attendance" className="px-3">
            <ClockIcon data-icon="inline-start" />
            Attendance
          </TabsTrigger>
          <TabsTrigger value="photos" className="px-3">
            <CameraIcon data-icon="inline-start" />
            Photos
          </TabsTrigger>
          <TabsTrigger value="email" className="px-3">
            <EnvelopeSimpleIcon data-icon="inline-start" />
            Email
          </TabsTrigger>
          <TabsTrigger value="access" className="px-3">
            <MoonIcon data-icon="inline-start" />
            Access window
          </TabsTrigger>
          <TabsTrigger value="documents" className="px-3">
            <FileTextIcon data-icon="inline-start" />
            Documents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organisation">
          <div className="flex flex-col gap-4 border p-4">
            <SectionHeading
              title="Organisation profile"
              note="REQ-L-01. These decide how every date on every screen and export is written."
            />
            <FieldGroup className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="org-name">Name</FieldLabel>
                <Input
                  id="org-name"
                  className="pointer-coarse:h-11"
                  value={draft.organisation.name}
                  onChange={(event) => {
                    patchOrganisation({ name: event.target.value });
                  }}
                />
                <FieldDescription>Shown in the header and on every export.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="org-legal-name">Legal name</FieldLabel>
                <Input
                  id="org-legal-name"
                  className="pointer-coarse:h-11"
                  value={draft.organisation.legalName ?? ''}
                  onChange={(event) => {
                    const next = event.target.value.trim();
                    patchOrganisation({ legalName: next.length === 0 ? null : event.target.value });
                  }}
                />
                <FieldDescription>
                  The registered entity name, if it differs. Leave empty to use the name above.
                </FieldDescription>
              </Field>

              <PolicyChoiceField
                id="org-timezone"
                label="Timezone"
                value={draft.organisation.timezone}
                options={TIMEZONE_OPTIONS.map((zone) => ({ value: zone, label: zone }))}
                help="Every attendance date is decided in this zone unless a location overrides it."
                onValueChange={(next) => {
                  patchOrganisation({ timezone: next });
                }}
              />

              <PolicyChoiceField
                id="org-date-format"
                label="Date format"
                value={draft.organisation.dateFormat}
                options={DATE_FORMATS.map((value) => ({ value, label: value }))}
                help="How dates are written on screen and in exports."
                onValueChange={(next) => {
                  patchOrganisation({ dateFormat: next });
                }}
              />

              <PolicyChoiceField
                id="org-week-start"
                label="Week starts on"
                value={String(draft.organisation.weekStart)}
                options={WEEKDAY_LABELS.map((day) => ({
                  value: String(day.value),
                  label: day.label,
                }))}
                help="The first column of every calendar and the first day of a weekly-off pattern."
                onValueChange={(next) => {
                  patchOrganisation({ weekStart: Number(next) });
                }}
              />

              <PolicyChoiceField
                id="org-leave-year"
                label="Leave year starts in"
                value={String(draft.organisation.leaveYearStartMonth)}
                options={MONTH_LABELS.map((month) => ({
                  value: String(month.value),
                  label: month.label,
                }))}
                help="REQ-G-04. Accruals, carry-forward and lapse are all measured from here."
                onValueChange={(next) => {
                  patchOrganisation({ leaveYearStartMonth: Number(next) });
                }}
              />
            </FieldGroup>
          </div>
        </TabsContent>

        <TabsContent value="office">
          <OfficeLocationPanel
            office={office}
            behaviour={{
              value: draft.attendance.geofenceBehaviour,
              enforcedBy: saved.enforcement.attendance.geofenceBehaviour,
            }}
            saveError={saveOffice.error}
          />
        </TabsContent>

        <TabsContent value="attendance">
          <div className="flex flex-col gap-4 border p-4">
            <SectionHeading
              title="Attendance policy"
              note="REQ-L-02. Changing a value here alters behaviour without a redeploy."
            />
            <FieldGroup className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <PolicyChoiceField
                id="policy-punch-window"
                label="Punch outside the shift window"
                value={draft.attendance.punchWindowBehaviour}
                options={PUNCH_WINDOW_BEHAVIOURS.map((value) => ({
                  value,
                  label: PUNCH_WINDOW_LABELS[value],
                }))}
                enforcedBy={saved.enforcement.attendance.punchWindowBehaviour}
                onValueChange={(next) => {
                  patchAttendance({ punchWindowBehaviour: next });
                }}
              />

              <PolicyChoiceField
                id="policy-geofence"
                label="Punch outside the location radius"
                value={draft.attendance.geofenceBehaviour}
                options={GEOFENCE_BEHAVIOURS.map((value) => ({
                  value,
                  label: GEOFENCE_LABELS[value],
                }))}
                enforcedBy={saved.enforcement.attendance.geofenceBehaviour}
                onValueChange={(next) => {
                  patchAttendance({ geofenceBehaviour: next });
                }}
              >
                <FieldDescription>
                  The centre and radius are on the Office location tab, per location. Punch
                  currently blocks outside the radius whatever this says.
                </FieldDescription>
              </PolicyChoiceField>

              <PolicyChoiceField
                id="policy-device-binding"
                label="Punch from an unrecognised device"
                value={draft.attendance.deviceBindingMode}
                options={DEVICE_BINDING_MODES.map((value) => ({
                  value,
                  label: DEVICE_BINDING_LABELS[value],
                }))}
                enforcedBy={saved.enforcement.attendance.deviceBindingMode}
                onValueChange={(next) => {
                  patchAttendance({ deviceBindingMode: next });
                }}
              />

              <FieldSeparator className="md:col-span-2 xl:col-span-3" />

              <PolicyNumberField
                id="policy-max-work"
                label="Maximum worked time in a day"
                unit="minutes"
                help="Worked minutes are capped here, so a missing OUT punch cannot produce a 30-hour day."
                min={60}
                max={1440}
                value={draft.attendance.maxWorkMinutes}
                enforcedBy={saved.enforcement.attendance.maxWorkMinutes}
                onValueChange={(next) => {
                  patchAttendance({ maxWorkMinutes: next });
                }}
              />

              <PolicyNumberField
                id="policy-regularization-window"
                label="Regularization window"
                unit="days back"
                help="How far back an employee may raise a correction."
                min={1}
                max={90}
                value={draft.attendance.regularizationWindowDays}
                enforcedBy={saved.enforcement.attendance.regularizationWindowDays}
                onValueChange={(next) => {
                  patchAttendance({ regularizationWindowDays: next });
                }}
              />

              <PolicyNumberField
                id="policy-regularization-count"
                label="Regularizations allowed"
                unit="per month"
                help="Zero switches regularization off without removing the permission from a role."
                min={0}
                max={31}
                value={draft.attendance.regularizationMaxPerMonth}
                enforcedBy={saved.enforcement.attendance.regularizationMaxPerMonth}
                onValueChange={(next) => {
                  patchAttendance({ regularizationMaxPerMonth: next });
                }}
              />

              <PolicyNumberField
                id="policy-escalation"
                label="Escalate an untouched approval after"
                unit="days"
                help="An approval nobody has actioned moves to HR."
                min={1}
                max={30}
                value={draft.attendance.autoEscalationDays}
                enforcedBy={saved.enforcement.attendance.autoEscalationDays}
                onValueChange={(next) => {
                  patchAttendance({ autoEscalationDays: next });
                }}
              />
            </FieldGroup>
          </div>
        </TabsContent>

        <TabsContent value="photos">
          <div className="flex flex-col gap-4 border p-4">
            <SectionHeading
              title="Punch photos"
              note="REQ-L-03. Retention decides how long a face is kept, so it is a privacy setting as much as a storage one."
            />

            {draft.photo.retentionMonths !== saved.photo.retentionMonths ? (
              <Alert variant={draft.photo.retentionMonths < saved.photo.retentionMonths ? 'destructive' : 'default'}>
                <WarningCircleIcon />
                <AlertTitle>
                  {draft.photo.retentionMonths < saved.photo.retentionMonths
                    ? 'Shortening retention removes photos permanently'
                    : 'Retention is being extended'}
                </AlertTitle>
                <AlertDescription>
                  {draft.photo.retentionMonths < saved.photo.retentionMonths
                    ? `From ${String(saved.photo.retentionMonths)} months to ${String(draft.photo.retentionMonths)}. The purge job deletes the object and the thumbnail; a purged photo cannot be recovered, and any dispute that relied on it will have no evidence.`
                    : `From ${String(saved.photo.retentionMonths)} months to ${String(draft.photo.retentionMonths)}. Photos already past their old window may already have been purged.`}
                </AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup className="grid gap-5 md:grid-cols-2">
              <PolicyNumberField
                id="photo-retention"
                label="Keep punch photos for"
                unit="months"
                help="The consent notice shown at the first punch quotes this number."
                // The server's floor: a regularization window can reach 90
                // days, and a shorter retention would purge a photo while its
                // punch is still disputable.
                min={3}
                max={120}
                value={draft.photo.retentionMonths}
                enforcedBy={saved.enforcement.photo.retentionMonths}
                onValueChange={(next) => {
                  patchPhoto({ retentionMonths: next });
                }}
              />

              <PolicyNumberField
                id="photo-min-bytes"
                label="Smallest stored photo"
                unit="KB"
                help="Below this the burnt-in stamp stops being legible."
                min={1}
                max={2048}
                value={Math.round(draft.photo.minBytes / KB)}
                enforcedBy={saved.enforcement.photo.minBytes}
                onValueChange={(next) => {
                  patchPhoto({ minBytes: next * KB });
                }}
              />

              <PolicyNumberField
                id="photo-max-bytes"
                label="Largest stored photo"
                unit="KB"
                help="Above this the image is re-encoded at a lower quality band."
                min={1}
                max={2048}
                value={Math.round(draft.photo.maxBytes / KB)}
                enforcedBy={saved.enforcement.photo.maxBytes}
                onValueChange={(next) => {
                  patchPhoto({ maxBytes: next * KB });
                }}
              />

              {draft.photo.minBytes > draft.photo.maxBytes ? (
                <Alert variant="destructive">
                  <WarningCircleIcon />
                  <AlertTitle>The size band is inverted</AlertTitle>
                  <AlertDescription>
                    The smallest photo cannot be larger than the largest. The server refuses this,
                    so Save will fail until one of the two moves.
                  </AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </div>
        </TabsContent>

        <TabsContent value="email">
          <EmailTab settings={saved} />
        </TabsContent>

        <TabsContent value="access">
          <AccessWindowPanel window={accessWindow} saveError={saveWindow.error} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel />
        </TabsContent>
      </Tabs>

      <RecordHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entityType="settings"
        // The organisation row is what every settings write audits against,
        // including the logo (REQ-L-01), so one id covers all four tabs.
        entityId={saved.organisation.id}
        title="Organisation settings"
        description="Every settings change, with the values before and after (REQ-L-05)."
      />
    </div>
  );
}

/**
 * REQ-L-04.
 *
 * Read-only, and that is the honest rendering: SMTP is deployment
 * configuration, not a row in a table, so an editable form here would be a set
 * of fields that silently do nothing. What the screen can do is show what the
 * server is actually configured with, and prove it works.
 */
function EmailTab({ settings }: { settings: OrgSettings }) {
  const test = useTestEmail();

  return (
    <div className="flex flex-col gap-4 border p-4">
      <SectionHeading
        title="Outbound email"
        note="REQ-L-04. Read from the server's own configuration; change it where the service is deployed."
      />

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Transport</dt>
        <dd className="font-medium">
          {settings.email.transport === 'smtp'
            ? 'SMTP'
            : 'Log only, nothing is delivered'}
        </dd>

        <dt className="text-muted-foreground">Host</dt>
        <dd className="font-medium tabular-nums">
          {settings.email.host}:{settings.email.port}
        </dd>

        <dt className="text-muted-foreground">TLS</dt>
        <dd className="font-medium">{settings.email.secure ? 'On' : 'Off'}</dd>

        <dt className="text-muted-foreground">From</dt>
        <dd className="font-medium break-all">{settings.email.from}</dd>

        <dt className="text-muted-foreground">Credentials</dt>
        <dd className="font-medium">
          {settings.email.credentialsConfigured ? 'Configured' : 'None set'}
        </dd>
      </dl>

      {settings.email.transport === 'log' ? (
        <Alert>
          <EnvelopeSimpleIcon />
          <AlertTitle>Mail is off, and that is the default</AlertTitle>
          <AlertDescription>
            The server writes messages to its log instead of sending them. Invitations and password
            resets are unaffected: both hand their link back on screen, for you to send however you
            like. What is not delivered is everything else — reminders and approval notices. Set the
            transport to SMTP to turn those on.
          </AlertDescription>
        </Alert>
      ) : null}

      {test.isSuccess ? (
        <Alert>
          <EnvelopeSimpleIcon />
          <AlertTitle>Test message sent to {test.data.sentTo}</AlertTitle>
          <AlertDescription>
            {test.data.transport === 'smtp'
              ? 'The mail server accepted it. If it does not arrive, the problem is downstream of this application.'
              : 'The transport is set to log, so the message was written to the server log rather than delivered.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {test.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>
            {test.error instanceof ApiError &&
            (test.error.code === 'NETWORK_ERROR' || test.error.status === 404)
              ? 'The test-send endpoint is not connected yet'
              : 'The message could not be sent'}
          </AlertTitle>
          <AlertDescription>
            {test.error instanceof ApiError && test.error.status !== 404
              ? test.error.message
              : 'Nothing was delivered. Check the transport settings above.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <div>
        <Button
          variant="outline"
          disabled={test.isPending}
          onClick={() => {
            test.mutate();
          }}
        >
          {test.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PaperPlaneTiltIcon data-icon="inline-start" />
          )}
          {test.isPending ? 'Sending' : 'Send a test message'}
        </Button>
        <p className="text-muted-foreground mt-2 text-xs">
          The message goes to your own address and nowhere else. A test send that accepted any
          recipient would be a mail relay behind an admin login.
        </p>
      </div>
    </div>
  );
}
