import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { AuthShell, LegalConsent } from './auth-shell';

// The frame both pre-sign-in pages share: wordmark, then the page's title as
// the h1, then the lead, then the form. The consent line names both documents
// and links them where they can be read without a session.
describe('AuthShell', () => {
  it('orders wordmark, title, lead, content', () => {
    render(
      <MemoryRouter>
        <AuthShell title="Welcome back" lead="Sign in with your work email.">
          <p>form</p>
          <LegalConsent verb="signing in" />
        </AuthShell>
      </MemoryRouter>,
    );
    const text = screen.getByRole('main').textContent ?? '';
    const order = ['Vyuha', 'Welcome back', 'Sign in with your work email.', 'form', 'By signing in'].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome back');
    expect(screen.getByRole('link', { name: 'Terms and Conditions' }).getAttribute('href')).toBe('/legal/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/legal/privacy');
  });
});
