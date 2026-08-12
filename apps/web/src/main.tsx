import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider } from '@/components/theme-provider';
import { useSessionStore } from '@/lib/session/session-store';

import App from './App';
import './index.css';

// The auth endpoints arrive later in Phase 0. Until `/me` exists there is no
// permission set, and without one the sidebar and the Go To palette render
// empty. In development we seed the Admin set so the shell can be seen and the
// permission filtering exercised; the header shows a banner and a role
// switcher so this can never be mistaken for a real session. Production takes
// this branch never, and falls through to the anonymous state.
if (import.meta.env.DEV) {
  useSessionStore.getState().applyPreviewRole('Admin');
} else {
  useSessionStore.getState().clear();
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
