import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';

import { MfaStep } from './mfa-step';

// The code step after the password: one field for six digits, the browser
// remembered by default, a recovery code behind one toggle, and a way back.
describe('MfaStep', () => {
  it('takes six digits, remembers the browser by default, and switches to a recovery code', () => {
    renderWithProviders(<MfaStep challengeToken={'c'.repeat(32)} onBack={() => undefined} />);
    const input = screen.getByLabelText('Code from your authenticator app');
    fireEvent.change(input, { target: { value: '12ab34' } });
    expect((input as HTMLInputElement).value).toBe('1234');
    expect(screen.getByRole('checkbox', { name: 'Remember this browser for 30 days' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    const recovery = screen.getByLabelText('Recovery code');
    fireEvent.change(recovery, { target: { value: 'abcde-fghjk' } });
    expect((recovery as HTMLInputElement).value).toBe('ABCDE-FGHJK');
    expect(screen.getByRole('button', { name: 'Use the app instead' })).toBeTruthy();
  });

  it('goes back to the password', () => {
    let back = 0;
    renderWithProviders(<MfaStep challengeToken={'c'.repeat(32)} onBack={() => { back += 1; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toBe(1);
  });
});
