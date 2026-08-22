import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HelpCard } from '@vyuha/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '@/lib/api/client';
import { useGuideStore } from '@/lib/guide-store';
import { useUiStore } from '@/lib/ui-store';
import { renderWithProviders } from '@/test-support/render-shell';

import { ShortcutDialog } from '@/app/shortcut-dialog';

/**
 * The panel's promises, through the DOM rather than through the ranker.
 *
 * `rank.test.ts` already pins which card wins; repeating that here would be
 * slower and prove less. What only a render can show is the part that decides
 * whether this feature is trustworthy: that a question it cannot answer says
 * so instead of printing its best guess under a heading, and that **Show me**
 * reaches the guide rather than merely looking like it does.
 */

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiRequest: vi.fn(),
}));

const request = vi.mocked(apiRequest);

function card(over: Partial<HelpCard> & Pick<HelpCard, 'id' | 'question'>): HelpCard {
  return {
    aliases: [],
    answer: 'An answer.',
    route: null,
    permission: null,
    tourStep: null,
    errorCodes: [],
    topic: 'punch',
    ...over,
  };
}

const CARDS: HelpCard[] = [
  card({
    id: 'punch.outside-geofence',
    question: "Why can't I punch from here?",
    aliases: ['outside geofence', 'punch blocked location', 'too far from office'],
    answer:
      "Your punch has to be inside your office location's radius, which is 100 metres unless an administrator changed it.",
    route: '/punch',
    tourStep: 'screen.punch',
  }),
  card({
    id: 'account.keyboard',
    question: 'What are the keyboard shortcuts?',
    aliases: ['shortcuts', 'hotkeys', 'keyboard'],
    answer: 'Ctrl+F1 lists every shortcut active on the screen you are looking at.',
    topic: 'account',
  }),
];

beforeEach(() => {
  request.mockResolvedValue({ cards: CARDS });
});

afterEach(() => {
  useUiStore.getState().setShortcutsOpen(false);
  useGuideStore.getState().consumeArmed();
  vi.clearAllMocks();
});

/**
 * Render, then open — the order `goto-palette.test.tsx` uses. Opening the
 * store before the tree exists puts the dialog's first render outside act()
 * and leaves the portal behind for the next test to trip over.
 */
async function openDialog() {
  renderWithProviders(<ShortcutDialog />);
  useUiStore.getState().setShortcutsOpen(true);
  return screen.findByLabelText('Ask a question about this software');
}

describe('the answer panel on Ctrl+F1', () => {
  it('shows the shortcut reference until a question is asked', async () => {
    await openDialog();
    expect(await screen.findByText('Walk me through this screen')).toBeDefined();
  });

  it('answers a question in place, and replaces the reference while doing it', async () => {
    const user = userEvent.setup();
    const box = await openDialog();

    await user.type(box, 'cant punch from here');

    expect(await screen.findByText(/inside your office location/)).toBeDefined();
    // One question at a time: the reference steps aside rather than sitting
    // under the answer.
    expect(screen.queryByText('Walk me through this screen')).toBeNull();
  });

  it('finds a card through an alias nobody would guess was the title', async () => {
    const user = userEvent.setup();
    const box = await openDialog();

    await user.type(box, 'hotkeys');

    expect(await screen.findByText(/lists every shortcut active/)).toBeDefined();
  });

  /*
   * The assertion this file exists for. A help panel that always produces its
   * best guess is worse than one that admits it has nothing, because a
   * confident wrong answer about a punch rule gets acted on.
   */
  it('says it has no answer rather than printing the closest thing as one', async () => {
    const user = userEvent.setup();
    const box = await openDialog();

    await user.type(box, 'how do I calculate gratuity');

    expect(await screen.findByText('No answer for that yet')).toBeDefined();
    expect(screen.queryByText(/inside your office location/)).toBeNull();
  });

  it('arms the guide at the card’s own step and gets out of the way', async () => {
    const user = userEvent.setup();
    const box = await openDialog();

    await user.type(box, 'outside geofence');
    await user.click(await screen.findByRole('button', { name: /Show me/ }));

    await waitFor(() => {
      expect(useGuideStore.getState().armed).toBe(true);
    });
    expect(useGuideStore.getState().armedFromStepId).toBe('screen.punch');
    // The tour walks the real screen, so the dialog cannot still be over it.
    expect(useUiStore.getState().shortcutsOpen).toBe(false);
  });

  it('asks the server once, however much is typed', async () => {
    const user = userEvent.setup();
    const box = await openDialog();

    await user.type(box, 'geofence');
    await screen.findByText(/inside your office location/);

    expect(request.mock.calls.filter(([path]) => path === '/help/cards')).toHaveLength(1);
  });

  it('offers a retry rather than a blank panel when the corpus will not load', async () => {
    request.mockRejectedValue(new Error('Could not reach the server.'));
    const user = userEvent.setup();
    const box = await openDialog();

    await user.type(box, 'geofence');

    expect(await screen.findByText('Could not load the answers')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });
});
