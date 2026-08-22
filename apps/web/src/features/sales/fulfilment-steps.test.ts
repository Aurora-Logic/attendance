import { describe, expect, it } from 'vitest';

import { fulfilmentProgress } from './fulfilment-progress';
import type { Dispatch, Estimate, PackRecord } from './types';

/** The owner's four steps, decided from the order's own quantities. */
function order(lines: { quantity: string; packedQty: string; invoicedQty: string; dispatchedQty: string }[], status = 'CONFIRMED'): Estimate {
  return { status, shortClosedAt: null, lines: lines.map((line, index) => ({ id: `l${String(index)}`, ...line })) } as unknown as Estimate;
}
const pack = { id: 'p1' } as unknown as PackRecord;
const shipped = { id: 'd1', status: 'shipped' } as unknown as Dispatch;
const delivered = { id: 'd1', status: 'delivered' } as unknown as Dispatch;

describe('fulfilmentProgress', () => {
  it('is nothing before confirmation', () => {
    expect(fulfilmentProgress(order([{ quantity: '10', packedQty: '0', invoicedQty: '0', dispatchedQty: '0' }], 'DRAFT'), [], []).current).toBeNull();
  });

  it('starts at Picked and moves to Packed once a pack exists', () => {
    expect(fulfilmentProgress(order([{ quantity: '10', packedQty: '0', invoicedQty: '0', dispatchedQty: '0' }]), [], []).current).toBe('picked');
    const partly = fulfilmentProgress(order([{ quantity: '10', packedQty: '4', invoicedQty: '0', dispatchedQty: '0' }]), [pack], []);
    expect(partly.current).toBe('packed');
    expect(partly.done.has('picked')).toBe(true);
    expect(partly.toPack).toBe(6);
  });

  it('blocks Shipped on the invoice, and names how much waits', () => {
    const packed = fulfilmentProgress(order([{ quantity: '10', packedQty: '10', invoicedQty: '0', dispatchedQty: '0' }]), [pack], []);
    expect(packed.current).toBe('shipped');
    expect(packed.toInvoice).toBe(10);
    expect(packed.toDispatch).toBe(0);
  });

  it('is Delivered when every dispatch has been marked at the door', () => {
    const out = order([{ quantity: '10', packedQty: '10', invoicedQty: '10', dispatchedQty: '10' }]);
    expect(fulfilmentProgress(out, [pack], [shipped]).current).toBe('delivered');
    const home = fulfilmentProgress(out, [pack], [delivered]);
    expect(home.current).toBeNull();
    expect([...home.done]).toEqual(['picked', 'packed', 'shipped', 'delivered']);
  });
});
