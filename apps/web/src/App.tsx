import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';

import { AppShell } from '@/app/layout/app-shell';
import { SessionGate } from '@/app/session-gate';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { EmployeesPage } from '@/features/employees/employees-page';
import { ApprovalsPage } from '@/features/approvals';
import { MyAttendancePage, TeamAttendancePage } from '@/features/attendance';
import { HolidaysPage } from '@/features/holidays';
import { LeaveTypesPage, MyLeavePage } from '@/features/leave';
import { PatternsPage } from '@/features/patterns/patterns-page';
import { PunchPage } from '@/features/punch';
import { ShiftsPage } from '@/features/shifts';
import { PlaceholderPage } from '@/features/placeholder/placeholder-page';
import { ProfilePage } from '@/features/profile/profile-page';
import { ShortcutProvider } from '@/lib/keyboard/registry';
import { ALL_NAV_ITEMS } from '@/lib/nav';

/**
 * Routes with a screen of their own. Everything else in the navigation falls
 * through to the placeholder, so the two lists cannot both claim a path — the
 * filter below is driven by this set rather than by a second hand-written list
 * that would go stale the next time a screen ships.
 */
const BUILT_ROUTES = new Set([
  '/',
  '/employees',
  '/punch',
  '/my-attendance',
  '/team-attendance',
  '/shifts',
  '/my-leave',
  '/approvals',
  '/leave-types',
  '/holidays',
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // An operations tool is read constantly; refetching a muster on every
      // window focus would be a lot of noise for little freshness.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionGate>
        <ShortcutProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />

              <Route path="employees" element={<EmployeesPage />} />

              <Route path="punch" element={<PunchPage />} />
              <Route path="my-leave" element={<MyLeavePage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="leave-types" element={<LeaveTypesPage />} />
              <Route path="holidays" element={<HolidaysPage />} />
              <Route path="my-attendance" element={<MyAttendancePage />} />
              <Route path="team-attendance" element={<TeamAttendancePage />} />
              <Route path="shifts" element={<ShiftsPage />} />

              {/* Off the sidebar on purpose: reached from the user menu, not
                  from the navigation groups the PRD fixes (§6.1). */}
              <Route path="profile" element={<ProfilePage />} />

              {/* Sample data lives on this route, so it is never built into
                  a production bundle (CLAUDE.md §6). */}
              {import.meta.env.DEV ? (
                <Route path="patterns" element={<PatternsPage />} />
              ) : null}

              {ALL_NAV_ITEMS.filter((item) => !BUILT_ROUTES.has(item.to)).map((item) => (
                <Route key={item.to} path={item.to.slice(1)} element={<PlaceholderPage />} />
              ))}

              <Route path="*" element={<PlaceholderPage />} />
            </Route>
          </Routes>
        </ShortcutProvider>
        </SessionGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
