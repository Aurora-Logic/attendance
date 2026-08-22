import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';

import App from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

// iOS Safari ignores user-scalable=no for pinch; it does honour a cancelled
// gesture. Owner, 22 Aug 2026: no zoom anywhere on a phone.
document.addEventListener('gesturestart', (event) => { event.preventDefault(); }, { passive: false });

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
