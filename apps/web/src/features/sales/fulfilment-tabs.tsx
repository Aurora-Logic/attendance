import { Link } from 'react-router';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useDispatches } from './use-dispatches';
import { useAwaitingInvoice, usePackedList, usePickQueue } from './use-fulfilment';

/**
 * Owner, 22 Aug 2026: the fulfilment flow is one screen with stage tabs --
 * Pick, Packed, Awaiting invoice, Dispatched, Delivered -- rather than
 * five destinations. Each tab is a link to the screen that already does
 * that stage, so nothing moved; the strip says where you are and what
 * waits at each stage. Counts are the stage lists' own totals.
 */
export type FulfilmentStage = 'pick' | 'packed' | 'invoice' | 'dispatched' | 'delivered';

const STAGES: readonly { value: FulfilmentStage; label: string; to: string }[] = [
  { value: 'pick', label: 'Pick', to: '/sales/pick-queue' },
  { value: 'packed', label: 'Packed', to: '/sales/packed' },
  { value: 'invoice', label: 'Awaiting invoice', to: '/sales/awaiting-invoice' },
  { value: 'dispatched', label: 'Dispatched', to: '/sales/dispatches' },
  { value: 'delivered', label: 'Delivered', to: '/sales/delivered' },
];

function countOf(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'object' && data !== null) {
    const meta = (data as { meta?: { total?: unknown } }).meta;
    if (meta && typeof meta.total === 'number') return meta.total;
    const rows = (data as { data?: unknown }).data;
    if (Array.isArray(rows)) return rows.length;
  }
  return null;
}

export function FulfilmentTabs({ current }: { current: FulfilmentStage }) {
  const pick = usePickQueue();
  const packed = usePackedList({ page: 1, pageSize: 1 });
  const invoice = useAwaitingInvoice();
  const dispatched = useDispatches({ page: 1, pageSize: 1, delivered: 'no' });
  const delivered = useDispatches({ page: 1, pageSize: 1, delivered: 'yes' });
  const counts: Record<FulfilmentStage, number | null> = {
    pick: countOf(pick.data),
    packed: countOf(packed.data),
    invoice: countOf(invoice.data),
    dispatched: countOf(dispatched.data),
    delivered: countOf(delivered.data),
  };

  return (
    <Tabs value={current} className="gap-0">
      <TabsList className="no-scrollbar max-w-full overflow-x-auto">
        {STAGES.map((stage) => (
          <TabsTrigger key={stage.value} value={stage.value} className="px-3" render={<Link to={stage.to} />}>
            {stage.label}
            {counts[stage.value] !== null ? <span className="text-muted-foreground ml-1.5 tabular-nums">{counts[stage.value]}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
