import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/components/theme-provider';
import { ShortcutProvider } from '@/lib/keyboard/registry';
import { useSessionStore } from '@/lib/session/session-store';

import { LeaveDecisionsSection } from './leave-decisions';
import type { LeaveRequest } from './types';
import { LEAVE_QUERY_ROOT } from './use-leave';

/**
 * The two behaviours of the decision band that could regress silently:
 * REQ-I-05's own-request rule rendering as an explanation rather than as two
 * buttons that can only fail, and REQ-F-05's reason floor stopping a
 * too-short rejection before it becomes a 400. The endpoints themselves are
 * covered by `leave.endpoints.test.ts` on the api side.
 */

const OWN_EMPLOYEE_ID = 'emp-own';

function request(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: 'req-1',
    employee: { id: 'emp-other', name: 'Asha Probe' },
    leaveType: { id: 'lt-1', name: 'Casual Leave', code: 'CL' },
    fromDate: '2026-09-07',
    toDate: '2026-09-08',
    totalDays: 2,
    reason: 'Family visit',
    status: 'PENDING',
    attachmentFileId: null,
    approvalRequestId: null,
    appliedAt: '2026-08-14T10:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    cancelledAt: null,
    ...overrides,
  };
}

function renderBand(rows: LeaveRequest[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Seeded rather than fetched: what is under test is the rendering rules,
  // not the wire. `sample: false` so no dev-fixture notice muddies the DOM.
  queryClient.setQueryData([...LEAVE_QUERY_ROOT, 'decisions', 'pending'], {
    data: rows,
    meta: { page: 1, pageSize: 100, total: rows.length },
    sample: false,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter>
          <ShortcutProvider>
            <LeaveDecisionsSection />
          </ShortcutProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSessionStore.getState().setFromMe({
    displayName: 'Meera Manager',
    roleLabel: 'Operations',
    employeeId: OWN_EMPLOYEE_ID,
    permissions: ['leave.approve.team'],
  });
});

afterEach(() => {
  useSessionStore.getState().clear();
  vi.restoreAllMocks();
});

describe('LeaveDecisionsSection', () => {
  it('offers both decisions on a team request', () => {
    renderBand([request({})]);

    // Both renderings exist in the DOM (the desktop table and the phone
    // cards), so counts are per-rendering rather than singular.
    expect(screen.getAllByRole('button', { name: /^Approve Asha Probe/u }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Reject Asha Probe/u }).length).toBeGreaterThan(0);
  });

  it('explains instead of offering buttons on the approver`s own request (REQ-I-05)', () => {
    renderBand([
      request({ id: 'req-own', employee: { id: OWN_EMPLOYEE_ID, name: 'Meera Manager' } }),
    ]);

    expect(screen.queryByRole('button', { name: /^Approve Meera/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reject Meera/u })).toBeNull();
    expect(screen.getAllByText(/another approver decides/iu).length).toBeGreaterThan(0);
  });

  it('stops a too-short rejection before it reaches the server (REQ-F-05)', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderBand([request({})]);

    const [rejectButton] = screen.getAllByRole('button', { name: /^Reject Asha Probe/u });
    if (!rejectButton) throw new Error('No reject button rendered.');
    await user.click(rejectButton);

    await user.type(screen.getByLabelText('Reason'), 'no');
    // Scoped to the dialog: the row behind it also says "Reject", and the
    // submit button's accessible name carries the shortcut hint chip.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Reject/u }));

    // The dialog is still open with the reason intact, and nothing was sent.
    const reasonField = screen.getByLabelText('Reason');
    expect(reasonField instanceof HTMLTextAreaElement && reasonField.value).toBe('no');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says when there is nothing to decide', () => {
    renderBand([]);
    expect(screen.getByText('No leave waiting on you')).not.toBeNull();
  });
});
