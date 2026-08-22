import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthShell } from './auth-shell';

// The frame both pre-sign-in pages share: wordmark, then the page's title as
// the h1, then the lead, the form, and the product line last.
describe('AuthShell', () => {
  it('orders wordmark, title, lead, content, product line', () => {
    render(
      <AuthShell title="Welcome back" lead="Sign in with your work email.">
        <p>form</p>
      </AuthShell>,
    );
    const text = screen.getByRole('main').textContent ?? '';
    const order = ['Vyuha', 'Welcome back', 'Sign in with your work email.', 'form', 'Attendance'].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome back');
  });
});
