import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/app/layout/app-shell';
import { PageHeader } from '@/components/shared/page-header';
import { useUiStore } from '@/lib/ui-store';
import { renderWithProviders } from '@/test-support/render-shell';
import { setViewportMatches } from '@/test-support/setup';

/**
 * Can a person actually get to the answers?
 *
 * This file exists because the feature shipped unreachable on a phone and
 * nothing went red. The panel opens on Ctrl+F1; the header button that opens
 * it carries `hidden sm:inline-flex`; a phone has no keyboard. So on the width
 * most people use, the help was the one thing you could not ask for.
 *
 * `app-shell.tsx` had already written that lesson down twice — the Calculator
 * row and the "Guide to this screen" row are both in the account sheet for
 * exactly this reason, each with a comment saying the feature would otherwise
 * "exist and be unreachable at the width most people use". The rule kept being
 * rediscovered instead of enforced, so it is a test now.
 *
 * The bitter part is where the help is needed most: a punch refused for being
 * outside the geofence happens to somebody standing in a doorway holding a
 * phone, and that was precisely the person who could not ask why.
 */

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  // The shell mounts the notification bell and the branding fetch alongside
  // the panel. Nothing here asserts on them; they only need to not reject.
  apiRequest: vi.fn().mockResolvedValue({ cards: [], data: [], count: 0, unread: 0 }),
}));

const DESKTOP_WIDTH = window.innerWidth;

/**
 * `useIsMobile` reads `window.innerWidth`, not the matchMedia result, so
 * `setViewportMatches` alone moves nothing — it flips the sidebar's query
 * while the account menu stays on its desktop branch. Both have to be set, or
 * this test would render the dropdown and quietly prove nothing about phones.
 */
function usePhoneViewport() {
  setViewportMatches(true);
  Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
}

afterEach(() => {
  setViewportMatches(false);
  Object.defineProperty(window, 'innerWidth', { value: DESKTOP_WIDTH, configurable: true });
  useUiStore.getState().setShortcutsOpen(false);
  vi.clearAllMocks();
});

function renderShell() {
  return renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<PageHeader description="A test screen." />} />
      </Route>
    </Routes>,
  );
}

describe('reaching the answer panel', () => {
  it('offers it in the header on a desktop', async () => {
    renderShell();

    // Relabelled from "Keyboard shortcuts": the sheet behind it answers
    // questions now, and nobody looking for help clicks a keyboard.
    const button = await screen.findByRole('button', { name: 'Help and shortcuts' });
    await userEvent.setup().click(button);

    expect(useUiStore.getState().shortcutsOpen).toBe(true);
  });

  it('offers it in the account sheet on a phone, where there is no key to press', async () => {
    usePhoneViewport();
    const user = userEvent.setup();
    renderShell();

    /*
     * The header button is still in the document here — `hidden sm:inline-flex`
     * is Tailwind, and jsdom applies no stylesheet, so querying for visibility
     * would pass whatever the class said and prove nothing. Assert the class
     * itself: that is the mechanism that hides it on a phone, and it is the
     * reason the sheet row below has to exist.
     */
    const headerButton = await screen.findByRole('button', { name: 'Help and shortcuts' });
    expect(headerButton.className).toContain('hidden');
    expect(headerButton.className).toContain('sm:inline-flex');

    await user.click(await screen.findByRole('button', { name: /Account menu/ }));
    await user.click(await screen.findByRole('button', { name: 'Ask a question' }));

    expect(useUiStore.getState().shortcutsOpen).toBe(true);
  });
});
