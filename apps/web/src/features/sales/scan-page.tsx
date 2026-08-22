import { useState } from 'react';
import { BarcodeIcon, CameraSlashIcon, PackageIcon, TruckIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { SearchField } from '@/components/shared/search-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { apiRequest } from '@/lib/api/client';
import { formatRelativeAge } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { DispatchDialog } from './dispatch-dialog';
import { packRecordSchema, type PackRecord } from './types';
import { parseOrThrow } from '@/lib/api/parse';
import { useBarcodeScanner } from './use-barcode-scanner';
import { useSalesOrder } from './use-estimates';

/**
 * Scan a packing slip at the door (D-47). The camera reads the barcode, the
 * slip resolves to its pack and order, and the two verbs that matter at a
 * door are one tap away: ship it (LR, transporter, photographs) or deliver it
 * locally. Both open the dispatch form the Dispatches screen already uses,
 * which then lands on the dispatch, where the door step lives.
 *
 * No camera — a denied permission, a desktop, a phone that cannot — falls
 * back to typing the slip number; the number is printed under the barcode
 * for exactly this.
 */
export function ScanPage() {
  const canCreate = usePermission(PERMISSIONS.SALES_DOCUMENT_CREATE);
  const [typed, setTyped] = useState('');
  const [slip, setSlip] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);

  const resolve = useMutation({
    mutationFn: async (number: string) => {
      const body = await apiRequest<unknown>(`/sales/packs/by-slip/${encodeURIComponent(number)}`);
      return parseOrThrow(packRecordSchema, body, 'pack record');
    },
  });
  const pack: PackRecord | null = resolve.data ?? null;
  const order = useSalesOrder(pack?.documentId ?? null);
  const scanning = canCreate && slip === null;
  const { videoRef, state } = useBarcodeScanner((value) => {
    setSlip(value);
    resolve.mutate(value);
  }, scanning);

  function reset() {
    setSlip(null);
    setTyped('');
    resolve.reset();
  }

  if (!canCreate) {
    return (
      <>
        <PageHeader description="Point the camera at a packing slip to ship it or mark it delivered." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WarningCircleIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot dispatch</EmptyTitle>
            <EmptyDescription>Scanning a slip ships it, which needs sales.document.create.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader description="Point the camera at the barcode on a packing slip. It opens the pack: ship it with the LR, or mark it delivered at the door." />
      <div className="flex flex-col gap-4">
        {slip === null ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden border bg-black sm:max-w-md">
            {/* The video is the viewfinder; the frame inside it is where the slip goes. */}
            <video ref={videoRef} className="size-full object-cover" muted playsInline aria-label="Camera" />
            {state === 'scanning' ? (
              <div aria-hidden className="pointer-events-none absolute inset-[14%] border-2 border-white/90" />
            ) : null}
            {state === 'starting' ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white">
                <Spinner data-icon="inline-start" />
                Starting the camera
              </div>
            ) : null}
            {state === 'denied' || state === 'unsupported' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
                <CameraSlashIcon className="size-6" />
                {state === 'denied' ? 'The camera was not allowed. Type the slip number instead — it is printed under the barcode.' : 'No camera here. Type the slip number instead — it is printed under the barcode.'}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:max-w-md">
          <SearchField
            id="slip-number"
            label="Slip number"
            placeholder="Or type it: SO-0007/AB12"
            value={typed}
            onValueChange={setTyped}
          />
          <div className="flex gap-2">
            <Button
              className="min-h-11 flex-1"
              disabled={typed.trim() === '' || resolve.isPending}
              onClick={() => {
                const value = typed.trim().toUpperCase();
                setSlip(value);
                resolve.mutate(value);
              }}
            >
              <BarcodeIcon data-icon="inline-start" />
              Open this slip
            </Button>
            {slip !== null ? (
              <Button variant="outline" className="min-h-11" onClick={reset}>
                Scan another
              </Button>
            ) : null}
          </div>
        </div>

        {resolve.isPending ? <Skeleton className="h-32 w-full sm:max-w-md" /> : null}

        {resolve.isError ? (
          <Empty className="border sm:max-w-md">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WarningCircleIcon />
              </EmptyMedia>
              <EmptyTitle>No pack for {slip}</EmptyTitle>
              <EmptyDescription>{resolve.error.message}</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" size="sm" onClick={reset}>
              Scan again
            </Button>
          </Empty>
        ) : null}

        {pack !== null && order.data !== undefined ? (
          <section className="flex flex-col gap-3 border p-4 sm:max-w-md" aria-label={`Pack ${slip ?? ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg leading-tight font-semibold tracking-tight">{order.data.customerName}</h2>
                <p className="text-muted-foreground text-sm">
                  <Link to={`/sales/orders/${order.data.id}`} className="underline-offset-4 hover:underline">
                    {order.data.number}
                  </Link>
                  {' · '}
                  {pack.boxCount} box{pack.boxCount === 1 ? '' : 'es'} · packed {formatRelativeAge(pack.packedAt)}
                  {pack.packedByName ? ` by ${pack.packedByName}` : ''}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                <PackageIcon />
                {slip}
              </Badge>
            </div>
            <ul className="divide-y border text-sm">
              {pack.lines.map((line) => (
                <li key={line.lineId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate">{line.description}</span>
                  <span className="tabular-nums shrink-0">{line.quantity}</span>
                </li>
              ))}
            </ul>
            {/* Both verbs open the same form: the mode chosen there decides
                what it asks for. Local deliveries mark the door step on the
                dispatch that follows. */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setDispatchOpen(true);
                }}
              >
                <PackageIcon data-icon="inline-start" />
                Deliver locally
              </Button>
              <Button
                className="min-h-11"
                onClick={() => {
                  setDispatchOpen(true);
                }}
              >
                <TruckIcon data-icon="inline-start" />
                Ship
              </Button>
            </div>
          </section>
        ) : null}

        {pack !== null && order.isPending ? <Skeleton className="h-32 w-full sm:max-w-md" /> : null}
      </div>

      <DispatchDialog open={dispatchOpen} onOpenChange={setDispatchOpen} order={order.data ?? null} loading={order.isPending} loadError={order.error} onRetry={() => { void order.refetch(); }} />
    </>
  );
}
