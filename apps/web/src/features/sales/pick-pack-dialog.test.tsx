import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';

import { stepOf } from './fulfilment-progress';
import { PickPackDialog } from './pick-pack-dialog';
import type { Estimate } from './types';

/** The owner's flow: an order is picked, then packed; the sheet opens at whichever is next. */
function order(lines: { quantity: string; pickedQty: string; packedQty: string }[]): Estimate {
  return {
    id: 'o1',
    number: 'SO/501',
    status: 'CONFIRMED',
    customerName: 'Panchavati Electric Works',
    shortClosedAt: null,
    shortCloseReason: null,
    lines: lines.map((line, index) => ({
      id: `l${String(index)}`,
      lineNo: index + 1,
      stockItemId: null,
      description: `Line ${String(index + 1)}`,
      unit: 'NOS',
      rate: '1',
      discountPct: '0',
      taxPct: '0',
      amount: '1',
      taxAmount: '0',
      hsnCode: null,
      invoicedQty: '0.000',
      dispatchedQty: '0.000',
      invoicingQty: '0.000',
      ...line,
    })),
  } as unknown as Estimate;
}

describe('stepOf', () => {
  it('is Pick while the shelf owes and nothing picked waits for a box', () => {
    expect(stepOf(order([{ quantity: '23', pickedQty: '0', packedQty: '0' }]))).toBe('pick');
  });
  it('is Pack the moment something picked waits, even if the shelf still owes', () => {
    expect(stepOf(order([{ quantity: '23', pickedQty: '23', packedQty: '0' }]))).toBe('pack');
    expect(stepOf(order([{ quantity: '23', pickedQty: '10', packedQty: '0' }, { quantity: '5', pickedQty: '0', packedQty: '0' }]))).toBe('pack');
  });
});

describe('PickPackDialog', () => {
  it('opens as Pick for an unpicked order and names what is on the shelf', () => {
    renderWithProviders(<PickPackDialog open onOpenChange={() => {}} order={order([{ quantity: '23', pickedQty: '0', packedQty: '0' }])} />);
    expect(screen.getByText('Pick SO/501')).toBeTruthy();
    expect(screen.getByText(/On the shelf 23/u)).toBeTruthy();
  });

  it('opens as Pack once picked, and offers to pick the rest', () => {
    renderWithProviders(<PickPackDialog open onOpenChange={() => {}} order={order([{ quantity: '23', pickedQty: '10', packedQty: '0' }, { quantity: '5', pickedQty: '0', packedQty: '0' }])} />);
    expect(screen.getByText('Pack SO/501')).toBeTruthy();
    expect(screen.getByText(/Picked 10 · Packed 0 · Balance 10/u)).toBeTruthy();
    // Line 1 still owes 13 and line 2 owes 5: two lines on the shelf, and the way back to pick them.
    expect(screen.getByText(/2 lines are still on the shelf/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pick the rest/u })).toBeTruthy();
  });
});
