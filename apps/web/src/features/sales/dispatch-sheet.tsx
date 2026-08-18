import { useEffect, useState } from 'react';
import { ArrowSquareOutIcon, CheckIcon, CopyIcon, EnvelopeSimpleIcon, UploadSimpleIcon, WarningCircleIcon, WhatsappLogoIcon, XCircleIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useIsMobile } from '@/hooks/use-mobile';
import { EMPTY_VALUE, formatDate, formatRelativeAge } from '@/lib/format';
import { ShortcutLayer } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { DISPATCH_MODE_LABELS, PERMISSIONS } from '@vyuha/shared';

import { SyncStateBadge } from './sales-order-sheet';
import { trimZeros, type Dispatch, type DispatchNotification } from './types';
import { useAttachmentUrl, useMarkNotification, usePushDispatch } from './use-dispatches';

/**
 * One dispatch (REQ-AA-16, AA-31): how it travelled, what left, the
 * photographs behind a signed link minted when the sheet opens, and the
 * customer's notification — composed by the system, sent by a person, and
 * marked so (REQ-AA-24…AA-27, the `manual` channel of REQ-AA-26). The
 * Delivery Note's sync badge is the agent's word (REQ-AA-22, REQ-W-06).
 */

interface DispatchSheetProps {
  dispatch: Dispatch | null;
  onOpenChange: (open: boolean) => void;
}

export function DispatchSheet({ dispatch, onOpenChange }: DispatchSheetProps) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={dispatch !== null} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 sm:max-w-3xl max-md:max-h-[92vh]">
        {dispatch ? (
          <DispatchSheetBody
            key={dispatch.id}
            dispatch={dispatch}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const NOTIFICATION_STATUS_LABELS: Record<DispatchNotification['status'], string> = { pending: 'Pending', sent: 'Sent', failed: 'Failed' };

function DispatchSheetBody({ dispatch, onClose }: { dispatch: Dispatch; onClose: () => void }) {
  const canAct = usePermission(PERMISSIONS.SALES_DOCUMENT_CREATE);
  const push = usePushDispatch();
  const mark = useMarkNotification();
  const failure = push.error ?? mark.error;
  const copy = actionErrorCopy(failure, push.error ? 'Pushing the Delivery Note' : 'Marking the notification');

  const facts: [string, string][] = [
    ['Mode', DISPATCH_MODE_LABELS[dispatch.mode]],
    ['Dispatched', `${formatRelativeAge(dispatch.dispatchedAt)}${dispatch.dispatchedByName ? ` by ${dispatch.dispatchedByName}` : ''}`],
    ...(dispatch.mode === 'local_own_vehicle'
      ? ([
          ['Vehicle', dispatch.vehicleNumber ?? EMPTY_VALUE],
          ['Driver', dispatch.driverName ?? EMPTY_VALUE],
        ] as [string, string][])
      : []),
    ...(dispatch.mode === 'outstation'
      ? ([
          ['LR number', dispatch.lrNumber ?? EMPTY_VALUE],
          ['Transporter', dispatch.transporterName ?? EMPTY_VALUE],
          ['Transporter contact', dispatch.transporterContact ?? EMPTY_VALUE],
          ['Vehicle', dispatch.vehicleNumber ?? EMPTY_VALUE],
          ['Expected delivery', dispatch.expectedDeliveryDate === null ? EMPTY_VALUE : formatDate(dispatch.expectedDeliveryDate)],
        ] as [string, string][])
      : []),
  ];

  return (
    <ShortcutLayer id={`modal:dispatch-${dispatch.id}`}>
      <SheetHeader className="shrink-0 border-b">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          Dispatch {dispatch.number}
          <Badge variant="outline">{DISPATCH_MODE_LABELS[dispatch.mode]}</Badge>
          <SyncStateBadge record={dispatch} />
        </SheetTitle>
        <SheetDescription>
          {dispatch.customerName} · against{' '}
          <Link to={`/sales/orders/${dispatch.documentId}`} className="underline-offset-4 hover:underline">
            {dispatch.orderNumber}
          </Link>
          {dispatch.syncState === 'PUSHED' ? `. In Tally as Delivery Note #${dispatch.remoteVoucherNumber ?? '?'}.` : dispatch.syncState === 'QUEUED' ? '. Queued: the agent pushes the Delivery Note on its next poll.' : '.'}
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        {failure ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.description}</AlertDescription>
          </Alert>
        ) : null}

        {dispatch.lastError ? (
          <Alert variant="destructive">
            <XCircleIcon />
            <AlertTitle>{dispatch.syncState === 'FAILED' ? 'Tally rejected the Delivery Note' : 'Tally has since changed it'}</AlertTitle>
            <AlertDescription>
              <p className="font-mono text-xs">{dispatch.lastError}</p>
              <p className="mt-1">
                {dispatch.syncState === 'FAILED'
                  ? 'Tally\u2019s own words (REQ-T-01). Fix the cause there, then push again.'
                  : 'Seen on the pull (D-38). The goods left either way; the accountant decides what replaces the voucher.'}
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {dispatch.notes ? <p className="text-sm">{dispatch.notes}</p> : null}

        <div className="flex flex-col gap-2">
          <SectionHeading title="Lines" note="What left in this dispatch. The order shows the balance." />
          <ul className="divide-y border">
            {dispatch.lines.map((line) => (
              <li key={line.lineId} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{line.description}</span>
                <span className="shrink-0 tabular-nums">
                  {trimZeros(line.quantity)}
                  {line.unit ? ` ${line.unit}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {dispatch.attachments.length > 0 ? (
          <div className="flex flex-col gap-2">
            <SectionHeading title="Photographs" note="Signed links, minted when this opened; they expire." />
            <div className="flex flex-wrap gap-2">
              {dispatch.attachments.map((attachment, index) => (
                <AttachmentThumb key={attachment.fileId} dispatchId={dispatch.id} fileId={attachment.fileId} label={attachment.kind === 'box' ? 'Box photo' : 'LR photo'} index={index} />
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <SectionHeading title="Customer notification" note="Composed here; sent by hand until the channels are wired (REQ-AA-26). Mark it once it has gone." />
          {dispatch.notifications.length === 0 ? <p className="text-muted-foreground text-xs">No notification was composed.</p> : null}
          <ul className="flex flex-col divide-y border">
            {dispatch.notifications.map((notification) => (
              <li key={notification.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm">
                    {notification.channel === 'email' ? <EnvelopeSimpleIcon /> : <WhatsappLogoIcon />}
                    <span className="font-medium">{notification.channel === 'email' ? 'Email' : 'WhatsApp'}</span>
                    <span className="text-muted-foreground text-xs">{notification.recipient ?? 'no address on the party or the order'}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={notification.status === 'sent' ? 'default' : notification.status === 'failed' ? 'destructive' : 'outline'}>
                      {NOTIFICATION_STATUS_LABELS[notification.status]}
                      {notification.sentAt ? ` · ${formatRelativeAge(notification.sentAt)}` : ''}
                    </Badge>
                  </span>
                </div>
                {notification.error ? <p className="text-destructive text-xs">{notification.error}</p> : null}
                <Textarea readOnly rows={6} aria-label={`${notification.channel} message`} className="font-mono" value={notification.composedText} />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <CopyButton text={notification.composedText} label={`${notification.channel} message`} />
                  {notification.status === 'pending' && canAct ? (
                    <Button
                      size="sm"
                      className="pointer-coarse:min-h-11"
                      disabled={mark.isPending}
                      onClick={() => {
                        mark.mutate(
                          { dispatchId: dispatch.id, notificationId: notification.id, status: 'sent' },
                          {
                            onSuccess: () => {
                              toast.add({ type: 'success', title: `${notification.channel === 'email' ? 'Email' : 'WhatsApp'} marked sent`, description: `Recorded against ${dispatch.number} (REQ-AA-27).` });
                            },
                          },
                        );
                      }}
                    >
                      {mark.isPending && mark.variables?.notificationId === notification.id ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
                      Mark sent
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <SheetFooter className="shrink-0 flex-row flex-wrap justify-end gap-2 border-t">
        {canAct && (dispatch.syncState === 'NOT_PUSHED' || dispatch.syncState === 'FAILED') ? (
          <Button
            variant="outline"
            disabled={push.isPending}
            onClick={() => {
              push.mutate(dispatch.id, {
                onSuccess: (saved) => {
                  toast.add({ type: 'success', title: `${saved.number} queued for Tally`, description: 'The agent pushes the Delivery Note on its next poll.' });
                },
              });
            }}
          >
            {push.isPending ? <Spinner data-icon="inline-start" /> : <UploadSimpleIcon data-icon="inline-start" />}
            {dispatch.syncState === 'FAILED' ? 'Push again' : 'Push to Tally'}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          <ACTION_ICONS.close data-icon="inline-start" />
          Close
        </Button>
      </SheetFooter>
    </ShortcutLayer>
  );
}

/** A photograph behind its signed URL, asked for when the sheet opens; a link, because the full image is what the customer is sent. */
function AttachmentThumb({ dispatchId, fileId, label, index }: { dispatchId: string; fileId: string; label: string; index: number }) {
  const url = useAttachmentUrl(dispatchId, fileId);
  const name = `${label} ${String(index + 1)}`;
  if (url.isPending) return <Skeleton className="size-24" aria-label={`Loading ${name}`} />;
  if (url.isError) {
    return (
      <span className="text-muted-foreground flex size-24 items-center justify-center border p-2 text-center text-xs" title={url.error.message}>
        {name} unavailable
      </span>
    );
  }
  return (
    <a href={url.data.url} target="_blank" rel="noreferrer" className="group relative block size-24 border" aria-label={`Open ${name} in a new tab`}>
      <img src={url.data.url} alt={name} className="size-full object-cover" />
      <span className="bg-background/80 absolute inset-x-0 bottom-0 flex items-center justify-between px-1.5 py-0.5 text-[0.6875rem]">
        {label}
        <ArrowSquareOutIcon />
      </span>
    </a>
  );
}

/**
 * The clipboard is the convenience; the text on screen is the guarantee. A
 * multi-line message does not fit CopyField's single-line input, so this is
 * its button and its announcement beside a read-only Textarea instead.
 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (outcome !== 'copied') return undefined;
    const timer = window.setTimeout(() => {
      setOutcome('idle');
    }, 2500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [outcome]);

  async function copy() {
    try {
      // `navigator.clipboard` is absent over plain http and reading it throws;
      // the catch covers that as well as a refused permission (see CopyField).
      await navigator.clipboard.writeText(text);
      setOutcome('copied');
    } catch {
      setOutcome('failed');
    }
  }

  return (
    <>
      <span className="text-muted-foreground text-xs" role="status" aria-live="polite">
        {outcome === 'copied' ? 'Copied.' : outcome === 'failed' ? 'This browser would not write to the clipboard; select the text and copy it by hand.' : ''}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="pointer-coarse:min-h-11"
        aria-label={outcome === 'copied' ? `${label} copied` : `Copy ${label}`}
        onClick={() => {
          void copy();
        }}
      >
        {outcome === 'copied' ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
        Copy
      </Button>
    </>
  );
}
