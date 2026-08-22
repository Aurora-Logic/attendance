import { DEFAULT_LOCALE } from '@vyuha/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { currencySymbol, formatAmount, formatCount, setWorkspaceLocale } from './format';

// Every figure in the product is written by these two, from the workspace's
// setting; a change in Settings changes what a table cell says.
describe('workspace number format', () => {
  afterEach(() => {
    setWorkspaceLocale(DEFAULT_LOCALE);
  });

  it('groups the Indian way by default, two decimals always', () => {
    expect(formatAmount('1234567.5')).toBe('12,34,567.50');
    expect(formatAmount('999')).toBe('999.00');
    expect(formatAmount('-1234.567')).toBe('−1,234.56');
    expect(formatCount(12345678)).toBe('1,23,45,678');
    expect(currencySymbol()).toBe('₹');
  });

  it('groups the international way and changes the symbol when the workspace says so', () => {
    setWorkspaceLocale({ numberFormat: 'international', currencySymbol: 'INR' });
    expect(formatAmount('1234567.5')).toBe('1,234,567.50');
    expect(formatCount(12345678)).toBe('12,345,678');
    expect(currencySymbol()).toBe('INR');
  });
});
