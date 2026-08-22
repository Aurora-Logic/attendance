import type { Dispatch, Estimate, PackRecord } from './types';

/**
 * The owner's four steps (22 Aug 2026), decided from the order's own
 * quantities: Picked, Packed, Shipped, Delivered. Pure, so the bar that
 * draws it is tested here without rendering.
 */

export type FulfilmentStep = 'picked' | 'packed' | 'shipped' | 'delivered';

export const STEPS: readonly { key: FulfilmentStep; label: string }[] = [
  { key: 'picked', label: 'Picked' },
  { key: 'packed', label: 'Packed' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

export interface FulfilmentProgress {
  /** The step the order is on: the first not yet complete. Null before confirmation. */
  readonly current: FulfilmentStep | null;
  readonly done: ReadonlySet<FulfilmentStep>;
  readonly toPack: number;
  readonly toInvoice: number;
  readonly toDispatch: number;
  readonly undelivered: number;
}

/** Pure, so the bar can be tested without rendering. Quantities are per line; a step is done when nothing is left for it. */
export function fulfilmentProgress(order: Estimate, packs: readonly PackRecord[], dispatches: readonly Dispatch[]): FulfilmentProgress {
  const done = new Set<FulfilmentStep>();
  if (order.status !== 'CONFIRMED') return { current: null, done, toPack: 0, toInvoice: 0, toDispatch: 0, undelivered: 0 };
  let toPack = 0;
  let toInvoice = 0;
  let toDispatch = 0;
  for (const line of order.lines) {
    const ordered = Number(line.quantity);
    const packed = Number(line.packedQty);
    const invoiced = Number(line.invoicedQty);
    const dispatched = Number(line.dispatchedQty);
    toPack += Math.max(0, ordered - packed);
    toInvoice += Math.max(0, packed - invoiced);
    toDispatch += Math.max(0, invoiced - dispatched);
  }
  const shortClosed = order.shortClosedAt !== null;
  const anythingPacked = packs.length > 0 || order.lines.some((line) => Number(line.packedQty) > 0);
  // Picked is the pick queue's work; it is done the moment a pack exists.
  if (anythingPacked) done.add('picked');
  if (anythingPacked && (toPack <= 1e-9 || shortClosed)) done.add('packed');
  const allOut = dispatches.length > 0 && toDispatch <= 1e-9 && toInvoice <= 1e-9 && (toPack <= 1e-9 || shortClosed);
  if (allOut) done.add('shipped');
  const undelivered = dispatches.filter((d) => d.status !== 'delivered').length;
  if (allOut && undelivered === 0) done.add('delivered');
  const current = STEPS.find((step) => !done.has(step.key))?.key ?? null;
  return { current, done, toPack, toInvoice, toDispatch, undelivered };
}

