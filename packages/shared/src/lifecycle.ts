import type { PartyView, StockItemView } from './masters.js';

/**
 * The life of one thing, read from everything that ever touched it
 * (owner, 22 Aug 2026): a stock item across estimates, orders, picks,
 * packs, dispatches, invoices, purchase orders and receipts; a party as
 * the customer it is, the vendor it is, or both. Every event has a date
 * and a door, so a row in the timeline is a link and never a dead end.
 */
export const LIFECYCLE_EVENT_KINDS = ['estimate', 'order', 'pick', 'pack', 'dispatch', 'delivery', 'invoice', 'purchase_order', 'grn', 'voucher'] as const;
export type LifecycleEventKind = (typeof LIFECYCLE_EVENT_KINDS)[number];

export const LIFECYCLE_EVENT_LABELS: Record<LifecycleEventKind, string> = {
  estimate: 'Estimate',
  order: 'Sales order',
  pick: 'Picked',
  pack: 'Packed',
  dispatch: 'Dispatched',
  delivery: 'Delivered',
  invoice: 'Invoice',
  purchase_order: 'Purchase order',
  grn: 'Received',
  voucher: 'Tally voucher',
};

export interface LifecycleEvent {
  readonly kind: LifecycleEventKind;
  readonly id: string;
  /** ISO date-time. */
  readonly at: string;
  /** The document's number, or the name of the thing. */
  readonly title: string;
  /** Who it was for or from, what it carried. */
  readonly detail: string | null;
  /** Exact decimal text; null where the event carries no quantity. */
  readonly quantity: string | null;
  readonly unit: string | null;
  /** Exact decimal text; null where the event carries no amount. */
  readonly amount: string | null;
  /** The document's own state word, when it has one. */
  readonly state: string | null;
  /** Where the event is read in full. */
  readonly href: string;
}

export interface ItemLifecycleFigures {
  readonly ordered: string;
  readonly picked: string;
  readonly packed: string;
  readonly dispatched: string;
  readonly purchased: string;
  readonly received: string;
  readonly openOrders: number;
  readonly lastSoldAt: string | null;
  readonly lastReceivedAt: string | null;
}

export interface ItemCounterparty {
  readonly id: string | null;
  readonly name: string;
  readonly quantity: string;
  readonly lastRate: string | null;
  readonly lastAt: string;
}

export interface ItemLifecycle {
  readonly item: StockItemView;
  readonly figures: ItemLifecycleFigures;
  readonly customers: readonly ItemCounterparty[];
  readonly vendors: readonly ItemCounterparty[];
  readonly events: readonly LifecycleEvent[];
}

export type PartyRole = 'customer' | 'vendor' | 'both' | 'none';

export interface PartyLifecycleFigures {
  readonly estimates: number;
  readonly orders: number;
  readonly openOrders: number;
  readonly dispatches: number;
  readonly delivered: number;
  readonly invoices: number;
  readonly orderedValue: string;
  readonly invoicedValue: string;
  readonly purchaseOrders: number;
  readonly receipts: number;
  readonly purchasedValue: string;
  readonly lastOrderAt: string | null;
  readonly lastPurchaseAt: string | null;
}

export interface PartyLifecycle {
  readonly party: PartyView;
  readonly role: PartyRole;
  readonly figures: PartyLifecycleFigures;
  readonly events: readonly LifecycleEvent[];
}
