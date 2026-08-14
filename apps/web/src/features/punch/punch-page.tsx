import { useEffect, useMemo, useState } from 'react';
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CloudSlashIcon,
  FingerprintIcon,
  MapPinIcon,
  GpsSlashIcon,
  SignInIcon,
  SignOutIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { format } from 'date-fns';

import { Form } from '@/components/shared/form';
import { PageHeader } from '@/components/shared/page-header';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatClock, formatWindow } from '@/features/attendance/format';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SampleDataNotice } from '@/features/attendance/sample-data-notice';
import { AttendanceFlags, AttendanceStatusBadge } from '@/features/attendance/status-badge';
import { ApiError } from '@/lib/api/client';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { useShortcut } from '@/lib/keyboard/registry';
import { OFFLINE_QUEUE_MAX_AGE_HOURS, type QueuedPunch } from '@/lib/offline/punch-queue';
import { cn } from '@/lib/utils';

import { CameraPanel } from './camera-panel';
import { QueuePanel } from './queue-panel';
import { HALF_DAY_PARTS, type HalfDayPart, type PunchDraft, type PunchResult } from './types';
import { useCamera } from './use-camera';
import { POOR_ACCURACY_M, useGeolocation } from './use-geolocation';
import { useOnline } from './use-online';
import { useAcceptConsent, usePunch, useToday } from './use-punch';
import { usePunchQueue } from './use-punch-queue';
import { CLOCK_SKEW_LIMIT_MS, useServerClock } from './use-server-clock';

/**
 * REQ-D-01…D-13 / PRD §5 screen 3 — the one screen in this product that is
 * mobile-first and primary (PRD §6.5).
 *
 * The shape follows the order somebody standing at a gate needs it in: what
 * time is it and what am I expected to do, then the camera, then the two
 * things that might need typing, then one large action at the bottom where a
 * thumb already rests. Everything above the action is readable without
 * scrolling on a 360px screen; everything that needs a decision is between the
 * preview and the button.
 *
 * The single hardest rule on this screen: there is no file input, anywhere,
 * for any reason (REQ-D-02). See `camera-panel.tsx`.
 */

/** Long enough that "asdf" does not pass, short enough to type at a gate. */
const MIN_REASON_LENGTH = 10;

function StatusStrip({
  now,
  date,
  shiftName,
  window,
  statusSlot,
  lastPunch,
}: {
  now: Date | null;
  date: string;
  shiftName: string;
  window: string;
  statusSlot: React.ReactNode;
  lastPunch: string;
}) {
  return (
    // One bordered surface divided by rules, not four cards (CLAUDE.md §3
    // rule 3). The clock is the largest thing on the screen because it is the
    // thing being checked against.
    <div className="border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-3 py-3">
        <p className="text-3xl leading-none font-semibold tabular-nums" aria-live="off">
          {now ? format(now, 'HH:mm:ss') : '--:--:--'}
        </p>
        <p className="text-muted-foreground text-xs tabular-nums">{formatDate(date)}</p>
      </div>
      <dl className="divide-border grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0">
        {[
          ['Shift', shiftName],
          ['Window', window],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 px-3 py-2">
            <dt className="text-muted-foreground text-[0.6875rem]">{label}</dt>
            <dd className="text-xs font-medium tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex flex-col gap-1 px-3 py-2">
          <dt className="text-muted-foreground text-[0.6875rem]">Status</dt>
          <dd>{statusSlot}</dd>
        </div>
        <div className="flex flex-col gap-0.5 px-3 py-2">
          <dt className="text-muted-foreground text-[0.6875rem]">Last punch</dt>
          <dd className="text-xs font-medium tabular-nums">{lastPunch}</dd>
        </div>
      </dl>
    </div>
  );
}

function PunchSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading today" className="flex flex-col gap-4">
      <div aria-hidden className="flex flex-col gap-3 border p-3">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-8" />
          ))}
        </div>
      </div>
      <Skeleton aria-hidden className="aspect-4/3 w-full" />
      <Skeleton aria-hidden className="h-14 w-full" />
    </div>
  );
}

/** The confirmation, after the server has accepted the punch (REQ-D-13). */
function Confirmation({
  result,
  photoUrl,
  recorded,
  onAgain,
}: {
  result: PunchResult;
  photoUrl: string | null;
  /**
   * False when the server never saw this punch. The confirmation is still
   * rendered so the flow is reviewable before the endpoint exists, and it says
   * so in the largest words on the block rather than in a footnote.
   */
  recorded: boolean;
  onAgain: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 border p-4">
      <div className="flex items-start gap-3">
        {recorded ? (
          <CheckCircleIcon
            aria-hidden
            className="size-6 shrink-0 text-[color-mix(in_oklch,var(--success),var(--foreground)_20%)] dark:text-success"
          />
        ) : (
          <WarningCircleIcon aria-hidden className="text-destructive size-6 shrink-0" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">
            {recorded
              ? `Punched ${result.type === 'IN' ? 'in' : 'out'} at ${formatClock(result.at)}`
              : 'Not recorded'}
          </p>
          <p className="text-muted-foreground text-xs">
            {recorded
              ? result.replayed
                ? 'This punch had already been recorded, so nothing was added. The stamped photo is stored against the original.'
                : 'The stamped photo is stored against this punch.'
              : 'The punch endpoint is not connected yet, so nothing was sent and nothing was saved. This is what the confirmation will look like.'}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        {photoUrl ? (
          // The frame the camera produced, not the server's stamped copy: the
          // receipt carries a file id rather than a URL, and fetching a signed
          // one (NFR-09) would be a second round trip for the same picture.
          <img
            src={photoUrl}
            alt="The photo taken with this punch"
            className="size-24 shrink-0 border object-cover"
          />
        ) : null}
        <dl className="flex min-w-0 flex-col gap-1 text-xs">
          {/* Absent on a locked period, where the day engine did not run. */}
          {result.status ? (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Day status</dt>
              <dd>
                <AttendanceStatusBadge status={result.status} />
              </dd>
            </div>
          ) : null}
          {result.flags.length > 0 ? (
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Flags</dt>
              <dd>
                <AttendanceFlags flags={result.flags} />
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <Button variant="outline" className="self-start" onClick={onAgain}>
        <ArrowClockwiseIcon data-icon="inline-start" />
        Back to the punch screen
      </Button>
    </div>
  );
}

/**
 * The counterpart to `Confirmation`, for a punch that reached this device and
 * no further (REQ-D-10).
 *
 * Same shape, deliberately different words and a different mark. Technical
 * design §8: "Never let someone believe a queued punch is confirmed" — so this
 * says "not recorded yet" where the other says "Punched in", and there is no
 * tick anywhere on it.
 */
function QueuedNotice({
  entry,
  photoUrl,
  onAgain,
}: {
  entry: QueuedPunch;
  photoUrl: string | null;
  onAgain: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 border p-4">
      <div className="flex items-start gap-3">
        <CloudSlashIcon aria-hidden className="text-muted-foreground size-6 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">
            {entry.type === 'IN' ? 'Punch in' : 'Punch out'} queued at{' '}
            {formatClock(entry.clientTime)} — not recorded yet
          </p>
          <p className="text-muted-foreground text-xs">
            It is saved on this device with its photo and will survive closing the app. It becomes a
            real punch only when the server accepts it, which happens automatically when you are
            back online. Sync within {String(OFFLINE_QUEUE_MAX_AGE_HOURS)} hours or it will need a
            regularization instead.
          </p>
        </div>
      </div>

      {photoUrl ? (
        <img
          src={photoUrl}
          alt="The photo taken with this punch"
          className="size-24 shrink-0 border object-cover"
        />
      ) : null}

      <Button variant="outline" className="self-start" onClick={onAgain}>
        <ArrowClockwiseIcon data-icon="inline-start" />
        Back to the punch screen
      </Button>
    </div>
  );
}

export function PunchPage() {
  const query = useToday();
  const today = query.data?.value;
  const now = useServerClock(query.data?.anchor ?? null);
  const camera = useCamera();
  const location = useGeolocation();
  const online = useOnline();
  const punch = usePunch();

  const [halfDay, setHalfDay] = useState<HalfDayPart | null>(null);
  const [reason, setReason] = useState('');
  const [consented, setConsented] = useState(false);
  const acceptConsent = useAcceptConsent();
  const [result, setResult] = useState<PunchResult | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(true);
  /** The punch just written to the offline queue, if the last attempt was one. */
  const [queued, setQueued] = useState<QueuedPunch | null>(null);
  /** Set only when the device itself refused to store the punch. */
  const [queueError, setQueueError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const outbox = usePunchQueue();

  // Revoking on replacement rather than on unmount: a second punch in the same
  // session would otherwise leak the first blob for the life of the tab.
  useEffect(() => {
    if (!photoUrl) return undefined;
    return () => {
      URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const outsideWindow = today ? !today.withinWindow : false;
  const blockedByWindow = outsideWindow && today?.windowBehaviour === 'BLOCK';
  const locationMissing =
    location.state === 'denied' ||
    location.state === 'unavailable' ||
    location.state === 'timed-out';

  // REQ-D-06 and REQ-D-08a are the two places a typed reason is mandatory.
  const reasonRequired =
    (outsideWindow && today?.windowBehaviour === 'ALLOW_WITH_REASON') || locationMissing;
  const reasonOk = !reasonRequired || reason.trim().length >= MIN_REASON_LENGTH;

  // REQ-M-03: the notice is shown on the first punch and acceptance recorded.
  const consentNeeded = today ? !today.consentAccepted : false;
  const consentOk = !consentNeeded || consented;

  const canPunch =
    today !== undefined &&
    camera.state === 'ready' &&
    !blockedByWindow &&
    reasonOk &&
    consentOk &&
    !punch.isPending;

  const skewMs = query.data?.anchor.skewMs ?? 0;
  const skewed = Math.abs(skewMs) > CLOCK_SKEW_LIMIT_MS;

  async function submit(): Promise<void> {
    if (!today || !canPunch) return;

    const photo = await camera.capture();
    if (!photo) {
      setCaptureError(
        'The camera did not produce a frame. Wait for the preview to appear, then try again.',
      );
      return;
    }
    setCaptureError(null);

    // Null means the server is not offering a punch at all - a locked period,
    // or an account with no employee record. `canPunch` already covers it, but
    // the type has to be narrowed here rather than asserted away, because the
    // draft is what gets sent.
    if (today.nextPunchType === null) return;

    const draft: PunchDraft = {
      type: today.nextPunchType,
      photo,
      // REQ-D-11: generated once per attempt, so a retry of this same punch
      // cannot create a second one.
      idempotencyKey: crypto.randomUUID(),
      clientTime: new Date().toISOString(),
      coords: location.coords,
      halfDay: today.nextPunchType === 'IN' ? halfDay : null,
      reason: reason.trim() || null,
    };

    if (!online) {
      // Queued, and said so. Technical design §8: never let somebody believe a
      // queued punch is confirmed.
      await queueOffline(draft);
      return;
    }

    punch.mutate(draft, {
      onSuccess: (accepted) => {
        setResult(accepted);
        setRecorded(true);
        setPhotoUrl(accepted.photoThumbUrl ?? URL.createObjectURL(photo));
        setReason('');
        setHalfDay(null);
      },
      onError: (error) => {
        // The server was never reached, so nobody knows whether this punch
        // exists. It goes in the queue rather than being lost: the key was
        // generated once and travels with it, so if the request did in fact
        // land, the drain gets `replayed` back and no second punch is made
        // (REQ-D-11). A refusal is different - the server answered - and falls
        // through to the error state below.
        if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
          void queueOffline(draft);
        }
      },
    });
  }

  async function queueOffline(draft: PunchDraft): Promise<void> {
    try {
      const entry = await outbox.queue(draft);
      setQueued(entry);
      setPhotoUrl(URL.createObjectURL(draft.photo));
      setQueueError(null);
      setReason('');
      setHalfDay(null);
    } catch (cause) {
      // The device refused to store it, which means the punch is genuinely
      // gone. That is the one outcome this screen must never round off into a
      // reassuring message.
      setQueueError(
        cause instanceof Error
          ? `This punch could not be saved on the device: ${cause.message}`
          : 'This punch could not be saved on the device.',
      );
    }
  }

  // PRD §6.4: Ctrl+A accepts. On this screen the accepted thing is the punch.
  useShortcut({
    id: 'punch.accept',
    keys: 'ctrl+a',
    label: 'Punch',
    scope: 'screen',
    allowInInput: true,
    when: () => canPunch,
    run: () => {
      void submit();
    },
  });

  const shiftWindow = useMemo(() => {
    if (!today?.shift) return EMPTY_VALUE;
    return formatWindow(today.shift.windowStart, today.shift.windowEnd);
  }, [today]);

  /**
   * Rendered in every branch below, including the ones that cannot show a
   * punch screen at all.
   *
   * This screen has three early returns - loading, unreachable server, and
   * "you cannot punch here" - and the queue used to live past all of them. The
   * consequence was exactly backwards: reload while offline and `GET /me/today`
   * fails, so the person saw "could not reach the server" and no sign
   * whatsoever of the punch sitting on their device. The one moment the queue
   * matters most is the one moment it was invisible.
   */
  const queuePanel = (
    <QueuePanel
      waiting={outbox.waiting}
      refused={outbox.refused}
      unreadable={outbox.unreadable}
      draining={outbox.draining}
      lastResult={outbox.lastResult}
      lastAttemptAt={outbox.lastAttemptAt}
      online={online}
      onRetry={outbox.retry}
      onDismiss={outbox.dismiss}
    />
  );

  if (query.isPending) {
    return (
      <>
        <PageHeader description="Punch in and out. A live photo is required every time." />
        {queuePanel}
        <PunchSkeleton />
      </>
    );
  }

  if (query.isError || !today) {
    return (
      <>
        <PageHeader description="Punch in and out. A live photo is required every time." />
        {queuePanel}
        <QueryErrorAlert
          error={query.error}
          subject="today's punch status"
          onRetry={() => {
            void query.refetch();
          }}
        />
      </>
    );
  }

  // The server decides whether punching is possible at all, and it says so in
  // three ways: no employee record behind the account, no next punch type, or
  // an explicit blockedReason. None of them were read, so an account with no
  // employee saw a live clock, an empty shift, a reason field demanding an
  // explanation for a window that does not exist, and a button labelled
  // "Punch out" - because `nextPunchType === 'IN'` is false when the value is
  // null, and the label falls through to the other branch. A screen that
  // cannot do the thing it is for has to say so instead of offering it.
  const blocked =
    today.blockedReason ??
    (today.employee === null
      ? {
          code: 'NO_EMPLOYEE_RECORD',
          message:
            'This sign-in is not linked to an employee record, so there is nobody to punch for. An administrator can link it from the employee register.',
        }
      : today.nextPunchType === null
        ? {
            code: 'PUNCH_UNAVAILABLE',
            message: 'Punching is not available right now.',
          }
        : null);

  if (blocked) {
    return (
      <>
        <PageHeader description="Punch in and out. A live photo is required every time." />
        {queuePanel}
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>You cannot punch here</AlertTitle>
          <AlertDescription>{blocked.message}</AlertDescription>
        </Alert>
      </>
    );
  }

  const punchingIn = today.nextPunchType === 'IN';

  return (
    <>
      <PageHeader description="Punch in and out. A live photo is required every time." />

      <div className="flex flex-col gap-4">
        {query.data?.sample ? <SampleDataNotice what="punch status" /> : null}

        <StatusStrip
          now={now}
          date={today.date}
          shiftName={today.shift?.name ?? 'No shift today'}
          window={shiftWindow}
          statusSlot={today.status ? <AttendanceStatusBadge status={today.status} /> : null}
          lastPunch={
            today.lastPunch
              ? `${today.lastPunch.type === 'IN' ? 'In' : 'Out'} ${formatClock(today.lastPunch.at)}`
              : 'None today'
          }
        />

        {skewed ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>This device's clock is wrong</AlertTitle>
            <AlertDescription>
              It differs from the server by more than five minutes. The punch will still be
              recorded against the server time and flagged for review (REQ-D-05).
            </AlertDescription>
          </Alert>
        ) : null}

        {!online ? (
          <Alert>
            <CloudSlashIcon />
            <AlertTitle>You are offline</AlertTitle>
            <AlertDescription>
              A punch taken now is queued in this tab and sent when the connection returns. Keep
              this screen open until it does — a queued punch is not a recorded punch.
            </AlertDescription>
          </Alert>
        ) : null}

        {queueError ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>The punch was not saved anywhere</AlertTitle>
            <AlertDescription>
              {queueError} The server never saw it and this device could not keep it, so it is gone.
              Punch again, and raise a regularization if the window has closed.
            </AlertDescription>
          </Alert>
        ) : null}

        {queuePanel}

        {queued ? (
          <QueuedNotice
            entry={queued}
            photoUrl={photoUrl}
            onAgain={() => {
              setQueued(null);
              setPhotoUrl(null);
            }}
          />
        ) : result ? (
          <Confirmation
            result={result}
            photoUrl={photoUrl}
            recorded={recorded}
            onAgain={() => {
              setResult(null);
              setPhotoUrl(null);
            }}
          />
        ) : (
          <>
            {/* Camera left, decisions right, from lg. Below that they stack in
                the order the person needs them: see yourself, then answer
                whatever is being asked, then press the button. */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <CameraPanel camera={camera} />

              <Form onSubmit={() => { void submit(); }} className="flex flex-col gap-4">
                <FieldGroup>
                  {/* REQ-D-08: the client reports, the server decides. */}
                  <div className="flex items-start gap-2 text-xs">
                    {locationMissing ? (
                      <GpsSlashIcon aria-hidden className="text-destructive mt-0.5 size-4 shrink-0" />
                    ) : (
                      <MapPinIcon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    )}
                    <p className="text-muted-foreground min-w-0">
                      {location.state === 'locating' ? 'Finding your location' : null}
                      {location.state === 'ready' && location.coords
                        ? `Location found, accurate to ${String(Math.round(location.coords.accuracyM))}m.${
                            location.coords.accuracyM > POOR_ACCURACY_M
                              ? ' That is a weak fix, so the punch may be flagged for review.'
                              : ''
                          }`
                        : null}
                      {location.state === 'denied'
                        ? 'Location is blocked. The punch is still allowed, with a reason, and is flagged for approval.'
                        : null}
                      {location.state === 'unavailable'
                        ? 'This device cannot report a location. The punch is still allowed, with a reason.'
                        : null}
                      {location.state === 'timed-out'
                        ? 'Locating timed out. The punch is still allowed, with a reason.'
                        : null}
                    </p>
                    {locationMissing || location.state === 'timed-out' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto shrink-0"
                        onClick={location.retry}
                      >
                        Retry
                      </Button>
                    ) : null}
                  </div>

                  <Separator />

                  {/* REQ-D-07: offered at IN only, because a half day is
                      declared when the day starts, not when it ends. */}
                  {punchingIn && today.halfDayAllowed ? (
                    <>
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="punch-half-day">Mark this as a half day</FieldLabel>
                        <Switch
                          id="punch-half-day"
                          // 18.4px plus Base UI's 8px ::after inset is a 34px
                          // tap target. 28px plus the same inset is 44, which
                          // is also roughly the size a phone OS draws a switch.
                          //
                          // Important, because the component sizes itself with
                          // `data-[size=default]:h-[18.4px]` — a two-class
                          // selector that outranks a plain utility, so without
                          // the `!` this had no effect at all and measured 34px.
                          className="pointer-coarse:h-7! pointer-coarse:w-12!"
                          checked={halfDay !== null}
                          onCheckedChange={(next: boolean) => {
                            setHalfDay(next ? 'FIRST_HALF' : null);
                          }}
                        />
                      </Field>

                      {halfDay !== null ? (
                        <Field>
                          <FieldLabel>Which half</FieldLabel>
                          <ToggleGroup
                            variant="outline"
                            className="w-full"
                            value={[halfDay]}
                            onValueChange={(value) => {
                              // Base UI hands back an empty array when the
                              // pressed item is pressed again. There is no
                              // "neither half", so the deselect is ignored.
                              const next = value[0];
                              if (next) setHalfDay(next as HalfDayPart);
                            }}
                          >
                            {HALF_DAY_PARTS.map((part) => (
                              <ToggleGroupItem key={part} value={part} className="min-h-11 flex-1">
                                {part === 'FIRST_HALF' ? 'First half' : 'Second half'}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                          <FieldDescription>
                            This overrides the hours-based result for the day.
                          </FieldDescription>
                        </Field>
                      ) : null}
                    </>
                  ) : null}

                  {/* REQ-D-06 / REQ-D-08a. Shown only when it is actually
                      required, so it never reads as an optional note box. */}
                  {reasonRequired ? (
                    <Field data-invalid={reasonOk ? undefined : true}>
                      <FieldLabel htmlFor="punch-reason">
                        {outsideWindow ? 'Why are you punching outside the window?' : 'Why is your location unavailable?'}
                      </FieldLabel>
                      <Textarea
                        id="punch-reason"
                        aria-invalid={reasonOk ? undefined : true}
                        placeholder="A sentence is enough."
                        value={reason}
                        onChange={(event) => {
                          setReason(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          // PRD §6.4: Esc clears the field it is typed in.
                          if (event.key === 'Escape' && reason.length > 0) {
                            event.preventDefault();
                            event.stopPropagation();
                            setReason('');
                          }
                        }}
                      />
                      <FieldDescription>
                        {outsideWindow && today.shift
                          ? `The window for ${today.shift.name} is ${shiftWindow}. `
                          : ''}
                        This is required, goes to your manager for approval, and needs at least{' '}
                        {MIN_REASON_LENGTH} characters.
                      </FieldDescription>
                    </Field>
                  ) : null}

                  {/* REQ-M-03. Ticking is the acceptance and is recorded
                      against the account (POST /me/consent), so the notice
                      appears once per person rather than once per visit. If
                      the recording fails -- an offline first punch -- the tick
                      still gates this session and the notice simply reappears
                      next time, which is the safe direction for a required
                      notice to fail in. Unticking is not a withdrawal
                      mechanism, so nothing is sent for it. */}
                  {consentNeeded ? (
                    <Field orientation="horizontal">
                      <Checkbox
                        id="punch-consent"
                        // Same arithmetic as the switch above: 28px plus the
                        // 8px ::after inset clears the 44px floor.
                        className="pointer-coarse:size-7"
                        checked={consented}
                        onCheckedChange={(next: boolean) => {
                          setConsented(next);
                          if (next && !acceptConsent.isPending) acceptConsent.mutate();
                        }}
                      />
                      {/* The retention period is stated because the server now
                          enforces it: `photoRetentionMonths` is the same row
                          the pipeline stamps `files.expires_at` from, so this
                          sentence can no longer promise a number nothing keeps
                          (the pre-P1-4 failure). */}
                      <FieldLabel htmlFor="punch-consent" className="font-normal">
                        I understand that each punch stores a photo of me and my location, kept
                        for {today.photoRetentionMonths} months and then deleted.
                      </FieldLabel>
                    </Field>
                  ) : null}
                </FieldGroup>
              </Form>
            </div>

            {blockedByWindow ? (
              <Alert variant="destructive">
                <WarningCircleIcon />
                <AlertTitle>The punch window is closed</AlertTitle>
                <AlertDescription>
                  {today.shift
                    ? `${today.shift.name} accepts punches between ${shiftWindow}.`
                    : 'No shift is scheduled for you today.'}{' '}
                  Raise a regularization instead.
                </AlertDescription>
              </Alert>
            ) : null}

            {captureError ? (
              <Alert variant="destructive">
                <WarningCircleIcon />
                <AlertTitle>No photo was captured</AlertTitle>
                <AlertDescription>{captureError}</AlertDescription>
              </Alert>
            ) : null}

            {punch.isError && !result ? (
              <Alert variant="destructive">
                <WarningCircleIcon />
                <AlertTitle>The punch was not recorded</AlertTitle>
                <AlertDescription>
                  {punch.error instanceof ApiError
                    ? punch.error.message
                    : 'The server did not accept it. Nothing was saved, so try again.'}
                  {punch.error instanceof ApiError && punch.error.requestId ? (
                    <span className="mt-1 block font-mono text-[0.6875rem]">
                      Request {punch.error.requestId}
                    </span>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {/* The action a thumb has to reach, held above the phone's
                navigation bar and scrolling normally on a desktop.

                Fixed rather than sticky. A sticky element can only stick
                within its own parent, and this parent ends inside the shell's
                pb-24 — so at the bottom of the page the bar detached and rose
                40px (measured: 1px above the nav at the top of the scroll,
                41px at the end). That is exactly pb-24 minus bottom-14, and it
                is the kind of coupling that comes back whenever the shell's
                padding changes. Fixed does not care how tall the parent is.

                Taking it out of flow means the page no longer reserves its
                height, so the spacer below puts that back. */}
            <div
              className={cn(
                'bg-background/95 supports-backdrop-filter:bg-background/85 reduced-transparency:bg-background fixed inset-x-0 bottom-14 z-20 border-t px-4 py-3 backdrop-blur-md',
                'md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
              )}
            >
              <Button
                size="lg"
                disabled={!canPunch}
                className="h-14 w-full text-sm md:h-11 md:w-auto md:min-w-56"
                onClick={() => {
                  void submit();
                }}
              >
                {punch.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : punchingIn ? (
                  <SignInIcon data-icon="inline-start" />
                ) : (
                  <SignOutIcon data-icon="inline-start" />
                )}
                {punch.isPending ? 'Sending' : punchingIn ? 'Punch in' : 'Punch out'}
                <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
              </Button>

              {/* Why the button is off, stated next to it rather than left for
                  somebody to work out by pressing it. */}
              {!canPunch && !punch.isPending ? (
                <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
                  <FingerprintIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {camera.state !== 'ready'
                    ? 'The camera has to be working before you can punch.'
                    : blockedByWindow
                      ? 'The window for this shift has closed.'
                      : !consentOk
                        ? 'Accept the photo and location notice to continue.'
                        : `Type a reason of at least ${String(MIN_REASON_LENGTH)} characters.`}
                </p>
              ) : null}
            </div>

            {/* Reserves the height the fixed bar no longer occupies, so the
                last thing above it is reachable rather than sitting under it.
                Measured against the bar itself rather than guessed. */}
            <div aria-hidden className="h-20 shrink-0 md:hidden" />
          </>
        )}
      </div>
    </>
  );
}
