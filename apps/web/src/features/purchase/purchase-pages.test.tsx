import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';

import { DEFAULT_DOCUMENT_SETTINGS } from '@vyuha/shared';

import { GrnPaperPage } from './grn-paper-page';
import { GrnsPage } from './grns-page';
import { PurchaseOrderEditorPage } from './purchase-order-editor-page';
import { PurchaseOrdersPage } from './purchase-orders-page';
import { RequirementsPage } from './requirements-page';
import { draftFingerprint, lineBalance, purchaseOrderSchema, purchaseOrderToDraft, type Grn, type PurchaseOrder, type Requirement } from './types';

/**
 * The three purchase screens against the API's own view shapes (13 §4), and
 * the draft helpers the PO sheet leans on. The API is mocked at `apiRequest`,
 * so what is under test is the parse at the boundary, the permission gate,
 * and what the rows say — not the server.
 */

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const { apiRequest } = await import('@/lib/api/client');
const request = vi.mocked(apiRequest);

afterEach(() => {
  request.mockReset();
});

const REQUIREMENTS: Requirement[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    stockItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    stockItemName: 'Copper wire 2.5mm',
    quantity: '40.000',
    orderedQty: '0.000',
    receivedQty: '0.000',
    source: 'shortage',
    salesOrderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    salesOrderLineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    salesOrderNumber: 'SO-0007',
    customerName: 'Asha Traders',
    neededBy: '2026-08-25',
    state: 'open',
    closedReason: null,
    createdAt: '2026-08-18T09:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    stockItemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    stockItemName: 'PVC conduit 25mm',
    quantity: '100.000',
    orderedQty: '100.000',
    receivedQty: '0.000',
    source: 'reorder',
    salesOrderId: null,
    salesOrderLineId: null,
    salesOrderNumber: null,
    customerName: null,
    neededBy: null,
    state: 'ordered',
    closedReason: null,
    createdAt: '2026-08-17T02:00:00.000Z',
  },
];

const ORDER: PurchaseOrder = {
  id: '33333333-3333-4333-8333-333333333333',
  number: 'PO-0001',
  status: 'CONFIRMED',
  fulfilment: 'partially_received',
  date: '2026-08-18',
  partyId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  vendorName: 'Metro Cables',
  vendorEmail: 'sales@metro.example',
  vendorWhatsapp: null,
  salesOrderId: null,
  expectedDate: '2026-08-28',
  ownerId: null,
  ownerName: null,
  notes: null,
  terms: null,
  details: null,
  shipTo: null,
  subtotal: '4000.00',
  discountTotal: '0.00',
  taxTotal: '720.00',
  grandTotal: '4720.00',
  approvalRequired: false,
  syncState: 'PUSHED',
  remoteGuid: 'guid-1',
  remoteVoucherNumber: '17',
  lastError: null,
  shortClosedAt: null,
  shortCloseReason: null,
  lines: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      lineNo: 1,
      stockItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      description: 'Copper wire 2.5mm',
      quantity: '40.000',
      unit: 'm',
      rate: '100.00',
      discountPct: '0.00',
      taxPct: '18.00',
      hsnCode: '8544',
      amount: '4000.00',
      taxAmount: '720.00',
      receivedQty: '10.000',
      rejectedQty: '2.000',
      requirements: [{ requirementId: REQUIREMENTS[0]?.id ?? '', quantity: '40.000', salesOrderNumber: 'SO-0007', customerName: 'Asha Traders' }],
    },
  ],
  notifications: [{ id: '55555555-5555-4555-8555-555555555555', channel: 'email', recipient: 'sales@metro.example', status: 'pending', composedText: 'PO-0001 for Metro Cables', sentAt: null, error: null }],
  createdAt: '2026-08-18T09:00:00.000Z',
  updatedAt: '2026-08-18T09:00:00.000Z',
};

const GRN: Grn = {
  id: '66666666-6666-4666-8666-666666666666',
  number: 'GRN-0001',
  purchaseOrderId: ORDER.id,
  purchaseOrderNumber: ORDER.number,
  vendorName: ORDER.vendorName,
  receivedById: null,
  receivedByName: 'Store keeper',
  receivedAt: '2026-08-18T10:00:00.000Z',
  vendorInvoiceRef: 'MC/118',
  notes: null,
  syncState: 'QUEUED',
  remoteGuid: null,
  remoteVoucherNumber: null,
  lastError: null,
  lines: [{ purchaseOrderLineId: ORDER.lines[0]?.id ?? '', description: 'Copper wire 2.5mm', receivedQty: '10.000', rejectedQty: '2.000', rejectionReason: 'Kinked' }],
  pendingAllocations: [
    {
      purchaseOrderLineId: ORDER.lines[0]?.id ?? '',
      stockItemName: 'Copper wire 2.5mm',
      unallocatedQty: '10.000',
      waiting: [
        { requirementId: REQUIREMENTS[0]?.id ?? '', salesOrderNumber: 'SO-0007', customerName: 'Asha Traders', outstandingQty: '40.000' },
        { requirementId: '77777777-7777-4777-8777-777777777777', salesOrderNumber: 'SO-0009', customerName: 'Bright Homes', outstandingQty: '15.000' },
      ],
    },
  ],
};

function answer(routes: Record<string, unknown>) {
  request.mockImplementation((path: string) => {
    const hit = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    if (hit === undefined) return Promise.reject(new Error(`unexpected request ${path}`));
    return Promise.resolve(hit[1]);
  });
}

describe('RequirementsPage', () => {
  it('refuses a role without purchase.document.view', () => {
    renderWithProviders(<RequirementsPage />, { role: 'Employee' });
    expect(screen.getByText('You cannot view the procurement queue')).toBeDefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('asks for open requirements by default and shows who waits behind each', async () => {
    answer({ '/purchase/requirements': REQUIREMENTS, '/masters/': { data: [], meta: { page: 1, pageSize: 25, total: 0 } } });
    renderWithProviders(<RequirementsPage />, { role: 'Admin', route: '/purchase/requirements' });

    expect(await screen.findAllByText('Copper wire 2.5mm')).not.toHaveLength(0);
    expect(request.mock.calls[0]?.[0]).toBe('/purchase/requirements?state=open');
    expect(screen.getAllByText('SO-0007').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Asha Traders').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Shortage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reorder').length).toBeGreaterThan(0);
  });

  it('offers to raise one PO for the selected open lines', async () => {
    const user = userEvent.setup();
    answer({ '/purchase/requirements': REQUIREMENTS, '/masters/': { data: [], meta: { page: 1, pageSize: 25, total: 0 } } });
    renderWithProviders(<RequirementsPage />, { role: 'Admin', route: '/purchase/requirements' });
    await screen.findAllByText('Copper wire 2.5mm');

    // Only the open row is selectable: the ordered one has no checkbox.
    const [box] = screen.getAllByRole('checkbox', { name: /Select Copper wire/u });
    expect(screen.queryByRole('checkbox', { name: /Select PVC conduit/u })).toBeNull();
    expect(box).toBeDefined();
    if (box) await user.click(box);

    expect(await screen.findByText('1 selected')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Raise PO for selected/u }));
    expect(await screen.findByText(/become one draft PO, one line per item/u)).toBeDefined();
  });
});

describe('PurchaseOrdersPage', () => {
  it('lists orders with both states and offers Settings to an approver', async () => {
    const { lines: _lines, notifications: _notifications, ...summary } = ORDER;
    answer({ '/purchase/orders?': { data: [summary], meta: { page: 1, pageSize: 25, total: 1 } } });
    renderWithProviders(<PurchaseOrdersPage />, { role: 'Admin', route: '/purchase/orders' });

    expect(await screen.findAllByText('PO-0001')).not.toHaveLength(0);
    expect(screen.getAllByText('Metro Cables').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Partially received').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/In Tally · #17/u).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Purchase settings' })).toBeDefined();
  });

  it('opens a confirmed order on its page: the paper, receipt figures, its requirements and the vendor copy', async () => {
    answer({
      [`/purchase/orders/${ORDER.id}`]: ORDER,
      '/masters/': { data: [], meta: { page: 1, pageSize: 25, total: 0 } },
      '/documents/settings': DEFAULT_DOCUMENT_SETTINGS,
      '/settings/branding': { name: 'Surabhi Hardwares', logoUrl: null, logoUrlExpiresInSeconds: null },
    });
    renderWithProviders(
      <Routes>
        <Route path="/purchase/orders/:id" element={<PurchaseOrderEditorPage />} />
      </Routes>,
      { role: 'Admin', route: `/purchase/orders/${ORDER.id}` },
    );

    // The paper: the vendor where the buyer stands, the number, the line.
    const paper = await screen.findByRole('article', { name: 'Purchase Order PO-0001' });
    expect(within(paper).getByText('Metro Cables')).toBeDefined();
    expect(within(paper).getByText('Copper wire 2.5mm')).toBeDefined();
    expect(screen.getByText(/Purchase order PO-0001/u)).toBeDefined();
    // Ordered / received / rejected / balance, from the line.
    expect(screen.getByText('Ordered')).toBeDefined();
    expect(screen.getByText('Balance')).toBeDefined();
    expect(screen.getByText('28')).toBeDefined();
    // REQ-X-10: who the line was bought for.
    expect(screen.getByText(/For SO-0007 \(Asha Traders\) · 40/u)).toBeDefined();
    // REQ-X-18: the vendor copy, pending.
    expect(screen.getByText('Vendor copy')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Mark sent' })).toBeDefined();
    // Confirmed with a balance: Receive and Short close are offered; nothing to push. Excel and PDF are there.
    expect(screen.getByRole('button', { name: 'Receive' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Short close' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Push/u })).toBeNull();
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDefined();
  });
});

describe('GrnsPage', () => {
  it('flags receipts still waiting for an allocation', async () => {
    answer({ '/purchase/grns': [GRN] });
    renderWithProviders(<GrnsPage />, { role: 'Admin', route: '/purchase/grns' });

    expect(await screen.findAllByText('GRN-0001')).not.toHaveLength(0);
    expect(screen.getAllByText('1 pending allocation').length).toBeGreaterThan(0);
  });

  it('opens a receipt on its page: the paper, and the allocation form for an approver', async () => {
    answer({
      '/purchase/grns/': GRN,
      [`/purchase/orders/${ORDER.id}`]: ORDER,
      '/masters/': { data: [], meta: { page: 1, pageSize: 25, total: 0 } },
      '/documents/settings': DEFAULT_DOCUMENT_SETTINGS,
      '/settings/branding': { name: 'Surabhi Hardwares', logoUrl: null, logoUrlExpiresInSeconds: null },
    });
    renderWithProviders(
      <Routes>
        <Route path="/purchase/grns/:id" element={<GrnPaperPage />} />
      </Routes>,
      { role: 'Admin', route: `/purchase/grns/${GRN.id}` },
    );

    // The paper: the vendor, the received quantity, no money on a goods receipt.
    const paper = await screen.findByRole('article', { name: 'Goods Receipt Note GRN-0001' });
    expect(within(paper).getByText('Metro Cables')).toBeDefined();
    expect(within(paper).getByText(/Copper wire 2.5mm/u)).toBeDefined();
    expect(within(paper).queryByText(/Rate/u)).toBeNull();
    expect(screen.getByText(/Goods receipt GRN-0001/u)).toBeDefined();
    expect(screen.getByText('Pending allocation')).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Quantity for SO-0007' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Quantity for SO-0009' })).toBeDefined();
    // Nothing typed yet, so nothing to allocate.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Allocate/u }).hasAttribute('disabled')).toBe(true);
    });
  });
});

describe('purchase order drafts', () => {
  it('parses the API view and keeps requirement links through a draft round trip', () => {
    const parsed = purchaseOrderSchema.parse(ORDER);
    const draft = purchaseOrderToDraft(parsed);
    const line = draft.lines[0];
    expect(line).toBeDefined();
    expect(draft.lineRequirements[line?.key ?? '']).toEqual([REQUIREMENTS[0]?.id]);
    expect(line?.quantity).toBe('40');
    expect(line?.rate).toBe('100');
  });

  it('reads two drafts of the same record as clean, whatever their line keys', () => {
    const a = purchaseOrderToDraft(ORDER);
    const b = purchaseOrderToDraft(ORDER);
    expect(a.lines[0]?.key).not.toBe(b.lines[0]?.key);
    expect(draftFingerprint(a)).toBe(draftFingerprint(b));
    expect(draftFingerprint({ ...a, notes: 'changed' })).not.toBe(draftFingerprint(b));
  });

  it('never reports a negative balance', () => {
    expect(lineBalance({ quantity: '10.000', receivedQty: '8.000', rejectedQty: '2.000' })).toBe(0);
    expect(lineBalance({ quantity: '10.000', receivedQty: '12.000', rejectedQty: '0.000' })).toBe(0);
    expect(lineBalance({ quantity: '40.000', receivedQty: '10.000', rejectedQty: '2.000' })).toBe(28);
  });
});
