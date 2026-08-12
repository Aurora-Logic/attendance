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
import { cn } from '@/lib/utils';

import { CameraPanel } from './camera-panel';
import { HALF_DAY_PARTS, type HalfDayPart, type PunchDraft, type PunchResult } from './types';
import { useCamera } from './use-camera';
import { POOR_ACCURACY_M, useGeolocation } from './use-geolocation';
import { useOnline } from './use-online';
import { postPunch, usePunch, useToday } from './use-punch';
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
              ? 'The stamped photo is stored against this punch.'
              : 'The punch endpoint is not connected yet, so nothing was sent and nothing was saved. This is what the confirmation will look like.'}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        {photoUrl ? (
          // The 256px thumbnail, never the full image (technical design §7).
          // Before the endpoint exists this is the frame captured locally, and
          // it carries no server stamp — which is the point of REQ-D-03.
          <img
            src={photoUrl}
            alt="The photo taken with this punch"
            className="size-24 shrink-0 border object-cover"
          />
        ) : null}
        <dl className="flex min-w-0 flex-col gap-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Day status</dt>
            <dd>
              <AttendanceStatusBadge status={result.status} />
            </dd>
          </div>
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

      <Button variant="outline" className="pointer-coarse:h-11 self-start" onClick={onAgain}>
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
  const [result, setResult] = useState<PunchResult | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(true);
  const [queue, setQueue] = useState<PunchDraft[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Revoking on replacement rather than on unmount: a second punch in the same
  // session would otherwise leak the first blob for the life of the tab.
  useEffect(() => {
    if (!photoUrl) return undefined;
    return () => {
      URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  /**
   * REQ-D-10: drain the queue when connectivity returns.
   *
   * One at a time, head first, so the punches reach the server in the order
   * they were taken. A success shifts the head and re-runs this effect for the
   * next one; a failure leaves the queue alone, which also stops the effect
   * re-running, so a dead server is not retried in a loop.
   */
  useEffect(() => {
    if (!online) return undefined;
    const next = queue[0];
    if (!next) return undefined;

    let cancelled = false;
    postPunch(next)
      .then(() => {
        if (!cancelled) {
          setQueue((rest) => rest.slice(1));
          setQueueError(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setQueueError(
          error instanceof ApiError
            ? error.message
            : 'The queued punch could not be sent. It is still queued.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [online, queue]);

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
      setQueue((rest) => [...rest, draft]);
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
        // The endpoint does not exist yet in development. Rather than hide the
        // confirmation until it does, it is rendered and labelled as not
        // recorded — the flow stays reviewable and nobody is told a lie.
        const unbuilt =
          error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.status === 404);
        if (import.meta.env.DEV && unbuilt) {
          setResult({
            id: 'not-recorded',
            type: draft.type,
            at: new Date().toISOString(),
            // No day row yet means no status yet; PENDING is what the day
            // engine writes before it has decided anything.
            status: today.status ?? 'PENDING',
            flags: [],
            photoThumbUrl: null,
          });
          setRecorded(false);
          setPhotoUrl(URL.createObjectURL(photo));
        }
        // Otherwise the mutation's error state renders below the action.
      },
    });
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

  if (query.isPending) {
    return (
      <>
        <PageHeader description="Punch in and out. A live photo is required every time." />
        <PunchSkeleton />
      </>
    );
  }

  if (query.isError || !today) {
    return (
      <>
        <PageHeader description="Punch in and out. A live photo is required every time." />
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

        {queue.length > 0 ? (
          <Alert>
            <CloudSlashIcon />
            <AlertTitle>
              {queue.length === 1 ? '1 punch queued' : `${String(queue.length)} punches queued`}
            </AlertTitle>
            <AlertDescription>
              {queueError ??
                'Waiting to reach the server. They will be sent in the order they were taken.'}
            </AlertDescription>
          </Alert>
        ) : null}

        {result ? (
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
                        className="pointer-coarse:h-11 ml-auto shrink-0"
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

                  {/* REQ-M-03. Acceptance belongs on the server; until the
                      endpoint exists it gates the button and nothing more. */}
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
                        }}
                      />
                      {/* No retention period is stated here on purpose. The
                          screen used to promise a number that came from a
                          field the server never sent, and punch photos are
                          currently stored with no expiry at all, so the
                          promise had nothing behind it. REQ-L-03 and REQ-M-03
                          are open (OPEN-QUESTIONS P1-4); until a period is
                          configured and enforced, saying nothing is the only
                          honest option. */}
                      <FieldLabel htmlFor="punch-consent" className="font-normal">
                        I understand that each punch stores a photo of me and my location.
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
