import type { KeyboardEvent } from 'react';

import type { DocumentDetails } from '@vyuha/shared';

import type { PaperEditing, PaperLine } from './paper';

/** What the paper keeps beside itself that is not a component: the Enter rule and the details grid's order and names. */

/** Move down a column on Enter; on the last row, Enter adds a line (Tally's voucher entry, on paper). */
export function useEnterMoves(editing: PaperEditing | undefined, lines: readonly PaperLine[]) {
  return (rowIndex: number, cell: string) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || editing === undefined) return;
    event.preventDefault();
    const target = `[data-cell="${cell}-${String(rowIndex + 1)}"]`;
    if (rowIndex === lines.length - 1) {
      editing.addLine();
      // The new row mounts after React commits this event's state; the same box on it is the natural landing.
      window.setTimeout(() => {
        document.querySelector<HTMLInputElement>(target)?.focus();
      }, 30);
      return;
    }
    const next = document.querySelector<HTMLInputElement>(target);
    next?.focus();
    next?.select();
  };
}


/** Shown in their own block, not the details column. */
export const E_INVOICE_KEYS = new Set<keyof DocumentDetails>(['irn', 'ackNo', 'ackDate']);
export const DETAIL_ORDER: readonly (keyof DocumentDetails)[] = ['deliveryNote', 'paymentTerms', 'referenceNo', 'otherReferences', 'buyersOrderNo', 'buyersOrderDate', 'dispatchDocNo', 'deliveryNoteDate', 'dispatchedThrough', 'destination', 'termsOfDelivery'];
export const DETAIL_LABELS: Record<keyof DocumentDetails, string> = {
  deliveryNote: 'Delivery note',
  paymentTerms: 'Terms of payment',
  referenceNo: 'Reference',
  otherReferences: 'Other references',
  buyersOrderNo: "Buyer's order",
  buyersOrderDate: 'Order date',
  dispatchDocNo: 'Dispatch doc',
  deliveryNoteDate: 'Delivery note date',
  dispatchedThrough: 'Dispatched through',
  destination: 'Destination',
  termsOfDelivery: 'Terms of delivery',
  irn: 'IRN',
  ackNo: 'Ack no.',
  ackDate: 'Ack date',
};

