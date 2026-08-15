import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from '@/components/ui/toast';
import { renderWithProviders } from '@/test-support/render-shell';

import { EmployeeDataExportButton } from './employee-data-export-button';

/**
 * REQ-M-05's UI half: the permission gate and the confirmation.
 *
 * The gate is enforced on the endpoint as well, and that is the check that
 * matters -- but a control that is visible to somebody who will be refused is
 * still a bug, and it is the half a server test cannot see.
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

const PROPS = { employeeId: 'emp-1', employeeName: 'Meera Nair' };

describe('EmployeeDataExportButton', () => {
  it('is not rendered at all without employee.manage', () => {
    // Operations may view an employee and may not manage one.
    renderWithProviders(<EmployeeDataExportButton {...PROPS} />, { role: 'Operations' });
    expect(screen.queryByRole('button', { name: /Export data/u })).toBeNull();
  });

  it('is offered to a role that holds employee.manage', () => {
    renderWithProviders(<EmployeeDataExportButton {...PROPS} />, { role: 'HR' });
    expect(screen.getByRole('button', { name: /Export data/u })).toBeDefined();
  });

  it('confirms before asking, naming the person and what the file holds', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EmployeeDataExportButton {...PROPS} />, { role: 'Admin' });

    await user.click(screen.getByRole('button', { name: /Export data/u }));

    expect(await screen.findByText(/Export everything held about Meera Nair/u)).toBeDefined();
    expect(screen.getByText(/recorded against this employee with your name on it/u)).toBeDefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('posts to the employee data export endpoint once confirmed', async () => {
    const user = userEvent.setup();
    request.mockResolvedValue({ id: 'job-1', filename: 'employee-data-EMP1.csv', status: 'QUEUED' });
    renderWithProviders(<EmployeeDataExportButton {...PROPS} />, { role: 'Admin' });

    await user.click(screen.getByRole('button', { name: /Export data/u }));
    const confirm = await screen.findByRole('button', { name: 'Export data' });
    await user.click(confirm);

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('/employees/emp-1/data-export', { method: 'POST' });
    });
  });

  it('says so when the server refuses, rather than closing on a success it did not get', async () => {
    const user = userEvent.setup();
    request.mockRejectedValue(new Error('You do not have permission to do that.'));
    // The shell renders the viewport; without it the message has nowhere to go
    // and this would assert an absence rather than a failure.
    renderWithProviders(
      <>
        <EmployeeDataExportButton {...PROPS} />
        <Toaster />
      </>,
      { role: 'Admin' },
    );

    await user.click(screen.getByRole('button', { name: /Export data/u }));
    await user.click(await screen.findByRole('button', { name: 'Export data' }));

    expect(await screen.findByText('Export refused')).toBeDefined();
    expect(screen.getByText('You do not have permission to do that.')).toBeDefined();
  });
});
