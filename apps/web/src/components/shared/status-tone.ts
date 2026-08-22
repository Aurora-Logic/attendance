/**
 * One place that decides a status's colour, so a state reads the same on every
 * screen (CLAUDE.md §3 rule 4: one hierarchy across the whole app). The tone is
 * the meaning, not the palette — amber waits, blue is in flight, green is done,
 * red is refused, grey has ended, plain has not begun. It is keyed by the raw
 * state value, which is unique enough across the document lives (a shared DRAFT
 * or CONFIRMED means the same in each), so an estimate, a sales order, a
 * purchase order, the Tally sync and the fulfilment all speak one colour.
 *
 * Colour is never the only signal: the label is always the word beside it, so a
 * status stays legible to a colour-blind reader and in a greyscale print.
 *
 * Kept apart from the StatusBadge component so a fast-refresh boundary holds and
 * a plain <Badge> can borrow the tone when its text is composed.
 */

export type StatusTone = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';

const STATUS_TONE: Record<string, StatusTone> = {
  // Nothing has happened yet — a draft, a document not sent to Tally, an order
  // whose fulfilment has not begun.
  DRAFT: 'outline',
  NOT_PUSHED: 'outline',
  open: 'outline',

  // Waiting on someone or something to act.
  QUEUED: 'warning',
  PENDING_APPROVAL: 'warning',
  awaiting_invoice: 'warning',

  // In flight — accepted into a process and moving.
  SENT: 'info',
  CONFIRMED: 'info',
  ordered: 'info',
  picking: 'info',
  ready_to_dispatch: 'info',
  partially_dispatched: 'info',
  partially_received: 'info',
  shipped: 'info',

  // Done, and well.
  PUSHED: 'success',
  ACCEPTED: 'success',
  closed: 'success',
  received: 'success',
  delivered: 'success',

  // Refused or stopped.
  FAILED: 'destructive',
  REJECTED: 'destructive',
  CANCELLED: 'destructive',

  // Ended, but not the happy ending.
  EXPIRED: 'secondary',
  short_closed: 'secondary',
};

/** The tone a raw status value wears; unmapped states read as neutral. */
export function statusTone(state: string): StatusTone {
  return STATUS_TONE[state] ?? 'outline';
}
