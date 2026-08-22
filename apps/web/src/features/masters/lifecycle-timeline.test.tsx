import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';
import type { LifecycleEvent } from '@vyuha/shared';

import { LifecycleTimeline } from './lifecycle-timeline';

const EVENTS: LifecycleEvent[] = [
  { kind: 'order', id: 'o1', at: '2026-08-20T09:00:00.000Z', title: 'SO-0007', detail: 'Asha Traders', quantity: '2.000', unit: 'BOX', amount: '9440.00', state: 'CONFIRMED', href: '/sales/orders/o1' },
  { kind: 'grn', id: 'g1', at: '2026-07-02T09:00:00.000Z', title: 'GRN-0003', detail: 'Behar Supply Co', quantity: '10.000', unit: 'BOX', amount: null, state: null, href: '/purchase/grns/g1' },
  { kind: 'voucher', id: 'v1', at: '2026-06-10T09:00:00.000Z', title: 'Sales INV-0031', detail: null, quantity: null, unit: null, amount: '1200.00', state: null, href: '/masters/vouchers/v1' },
];

describe('LifecycleTimeline', () => {
  it('groups by month, every row is a door, and the side filter narrows', () => {
    renderWithProviders(<LifecycleTimeline events={EVENTS} />);
    expect(screen.getByText('August 2026')).toBeTruthy();
    expect(screen.getByText('SO-0007').closest('a')?.getAttribute('href')).toBe('/sales/orders/o1');
    expect(screen.getByText('2 BOX')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Purchase' }));
    expect(screen.queryByText('SO-0007')).toBeNull();
    expect(screen.getByText('GRN-0003')).toBeTruthy();
    expect(screen.getByText(/1 of 3 events/u)).toBeTruthy();
  });
});
