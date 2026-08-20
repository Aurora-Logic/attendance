import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';

import { CalculatorButton, CalculatorPanel } from './calculator-panel';
import { useCalculatorStore } from './store';

/**
 * The parts the reducer tests cannot reach: the hint chip PRD §6.4 requires,
 * and the wiring between a keypress and the machine.
 *
 * The arithmetic itself is pinned in `machine.test.ts` and `decimal.test.ts`;
 * repeating it through a DOM would be slower and prove less.
 */

afterEach(() => {
  useCalculatorStore.setState({ open: false, target: null });
});

describe('CalculatorButton', () => {
  it('shows both keys, because Ctrl+N is reserved by the browser', async () => {
    /*
     * PRD §6.4: register the Tally key, provide a documented alias, show both.
     *
     * "Show" is now the tooltip rather than a chip beside the icon — the pair
     * rendered five chips permanently and made this the widest control in the
     * header. The requirement this asserts is unchanged: both keys reach the
     * reader from the control itself. Only the moment changed, and that
     * departure is recorded as OPEN-QUESTIONS G-10.
     */
    const user = userEvent.setup();
    renderWithProviders(<CalculatorButton />);

    await user.hover(screen.getByRole('button', { name: 'Calculator' }));

    const chips = (await screen.findAllByText(/^(Ctrl|⌃|N|Alt|⌥)$/u)).map((el) => el.textContent);
    expect(chips).toContain('N');
    expect(chips.filter((c) => c === 'N')).toHaveLength(2);
    expect(screen.getByText('or')).toBeDefined();
  });

  it('opens the panel', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <CalculatorButton />
        <CalculatorPanel />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Calculator' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Calculator display')).toBeDefined();
    });
  });
});

describe('CalculatorPanel', () => {
  it('renders nothing until it is opened', () => {
    renderWithProviders(<CalculatorPanel />);
    expect(screen.queryByLabelText('Calculator display')).toBeNull();
  });

  it('totals through the keypad and offers the result', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CalculatorPanel />);
    useCalculatorStore.getState().openPanel();

    const display = await screen.findByLabelText('Calculator display');
    await user.click(screen.getByRole('button', { name: '7' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: '8' }));
    await user.click(screen.getByRole('button', { name: 'Equals' }));

    await waitFor(() => {
      expect(display.textContent).toContain('15');
    });
    // No field was focused when it opened, so it offers the clipboard instead.
    expect(screen.getByRole('button', { name: /Copy/u })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Put in field/u })).toBeNull();
  });

  it('leaves focus on a key activated from the keyboard, and takes it back after a click', async () => {
    // Two different needs pulling the same way. After a mouse press, focus has
    // to return to the display or the next Enter re-presses whichever key the
    // pointer left focused. After Enter on a tabbed-to key, it must not, or a
    // keyboard user is thrown back to the start of the keypad on every press.
    const user = userEvent.setup();
    renderWithProviders(<CalculatorPanel />);
    useCalculatorStore.getState().openPanel();

    const seven = await screen.findByRole('button', { name: '7' });
    seven.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(seven);

    await user.click(seven);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Calculator display'));
    });
  });

  it('takes typed digits and operators, not only clicks', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CalculatorPanel />);
    useCalculatorStore.getState().openPanel();

    const display = await screen.findByLabelText('Calculator display');
    await user.keyboard('.1+.2{Enter}');

    await waitFor(() => {
      expect(display.textContent).toContain('0.3');
    });
  });

  it('remembers the field it was opened from and writes the total back', async () => {
    const user = userEvent.setup();
    const field = document.createElement('input');
    field.type = 'text';
    document.body.append(field);
    field.focus();

    renderWithProviders(<CalculatorPanel />);
    // Captured in the action, which is the last moment `document.activeElement`
    // is still the field rather than a key on the keypad.
    useCalculatorStore.getState().openPanel();

    await screen.findByLabelText('Calculator display');
    expect(useCalculatorStore.getState().target).toBe(field);

    await user.click(screen.getByRole('button', { name: '9' }));
    await user.click(screen.getByRole('button', { name: /Put in field/u }));

    await waitFor(() => {
      expect(field.value).toBe('9');
    });
    field.remove();
  });

  it('ignores a field that cannot take a total', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(checkbox);
    checkbox.focus();

    renderWithProviders(<CalculatorPanel />);
    useCalculatorStore.getState().openPanel();

    expect(useCalculatorStore.getState().target).toBeNull();
    checkbox.remove();
  });
});
