import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { ThemeProvider } from '@/components/theme-provider';
import { ShortcutProvider } from '@/lib/keyboard/registry';
import { SESSION_QUERY_KEY, type Me } from '@/lib/session/use-session';
import { useSessionStore } from '@/lib/session/session-store';
import { ROLE_PERMISSION_MATRIX, type SystemRoleName } from '@vyuha/shared';

/**
 * Renders a component inside the providers the application shell assumes.
 *
 * The session is seeded two ways on purpose, because the app reads it two ways:
 * the query cache is what `useMe` returns (the header's name and roles), and
 * the zustand store is what permission gating reads. Seeding only one of them
 * produces a shell that renders but filters nothing, which is exactly the
 * shape of the bug this file exists to catch.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { role?: SystemRoleName; route?: string } = {},
): RenderResult {
  const role: SystemRoleName = options.role ?? 'Admin';
  const permissions = [...ROLE_PERMISSION_MATRIX[role]];

  const me: Me = {
    user: { id: 'u1', email: 'test@vyuha.test', status: 'ACTIVE', employeeId: 'e1' },
    employee: {
      id: 'e1',
      employeeCode: 'E001',
      firstName: 'Test',
      lastName: 'User',
      departmentId: null,
      locationId: null,
      reportingManagerId: null,
    },
    roles: [{ id: 'r1', name: role }],
    permissions,
  };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, me);

  useSessionStore.getState().setFromMe({
    displayName: 'Test User',
    roleLabel: role,
    // The same record `me` above names, for the reason given in the doc
    // comment: the two seeds must describe one person.
    employeeId: 'e1',
    permissions,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[options.route ?? '/']}>
          <ShortcutProvider>{ui}</ShortcutProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The shell with a single routed child, for testing shell-level chrome. */
export function shellWith(page: ReactElement, Shell: () => ReactElement | null) {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={page} />
      </Route>
    </Routes>
  );
}
