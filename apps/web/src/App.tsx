import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';

import { AppShell } from '@/app/layout/app-shell';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { PatternsPage } from '@/features/patterns/patterns-page';
import { PlaceholderPage } from '@/features/placeholder/placeholder-page';
import { ShortcutProvider } from '@/lib/keyboard/registry';
import { ALL_NAV_ITEMS } from '@/lib/nav';

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
        <ShortcutProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />

              {/* Sample data lives on this route, so it is never built into
                  a production bundle (CLAUDE.md §6). */}
              {import.meta.env.DEV ? (
                <Route path="patterns" element={<PatternsPage />} />
              ) : null}

              {ALL_NAV_ITEMS.filter((item) => item.to !== '/').map((item) => (
                <Route key={item.to} path={item.to.slice(1)} element={<PlaceholderPage />} />
              ))}

              <Route path="*" element={<PlaceholderPage />} />
            </Route>
          </Routes>
        </ShortcutProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
