import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';

const permission = vi.hoisted(() => ({ held: new Set<string>() }));
vi.mock('@/lib/session/permissions', () => ({
  usePermission: (key: string) => permission.held.has(key),
  usePermissions: () => permission.held,
}));
vi.mock('./dashboard-page', () => ({
  DashboardPage: () => <div>attendance dashboard</div>,
}));

import { LandingPage } from './landing';

/**
 * Where "/" sends somebody. The failure this guards is quiet: an owner signing
 * in and getting their own punch card, then navigating away every time.
 */
describe('the landing screen', () => {
  it('sends whoever can see the books to the reports dashboard', () => {
    permission.held = new Set(['receivables.view']);
    renderWithProviders(<LandingPage />, { route: '/' });
    // A redirect, so the attendance dashboard must not have rendered at all.
    expect(screen.queryByText('attendance dashboard')).toBeNull();
  });

  it('leaves everybody else on the attendance dashboard', () => {
    // Most of the company. Punch and their own days is the right first screen
    // and must not regress into a redirect they cannot use.
    permission.held = new Set(['punch.self', 'attendance.view.self']);
    renderWithProviders(<LandingPage />, { route: '/' });
    expect(screen.getByText('attendance dashboard')).toBeTruthy();
  });

  it('decides on a permission, not a role name', () => {
    // PRD §2: nothing branches on a role name -- "Admin" is renameable and
    // roles are editable. Somebody granted receivables.view on a custom role
    // gets the same landing as Admin, which is the point.
    permission.held = new Set(['receivables.view']);
    renderWithProviders(<LandingPage />, { route: '/' });
    expect(screen.queryByText('attendance dashboard')).toBeNull();
  });
});
