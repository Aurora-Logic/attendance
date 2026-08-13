import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The web app's test runner.
 *
 * Separate from `vite.config.ts` rather than folded into it, matching the API,
 * so the dev server config stays free of test concerns and the two can diverge.
 *
 * jsdom rather than node: everything worth testing on this side of the app
 * renders. The alias is repeated here because Vitest resolves modules itself
 * and does not read the app config.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test-support/setup.ts'],
  },
});
