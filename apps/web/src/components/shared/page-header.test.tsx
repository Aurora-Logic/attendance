import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/button';

import { PageHeader } from './page-header';

// One header pattern for every screen (CLAUDE.md §3.4). The identity block is
// optional and stacks eyebrow, title and description in that order; the
// action stays right-aligned; nothing renders when there is nothing to say.
describe('PageHeader', () => {
  it('renders nothing without content', () => {
    const { container } = render(<PageHeader />);
    expect(container.innerHTML).toBe('');
  });

  it('stacks eyebrow, title and description before the action', () => {
    render(<PageHeader eyebrow="Books" title={<span>Day book</span>} description="Every voucher." action={<Button type="button">Export</Button>} />);
    const header = screen.getByText('Books').closest('[data-guide="screen.header"]');
    expect(header).not.toBeNull();
    const text = header?.textContent ?? '';
    expect(text.indexOf('Books')).toBeLessThan(text.indexOf('Day book'));
    expect(text.indexOf('Day book')).toBeLessThan(text.indexOf('Every voucher.'));
    expect(text.indexOf('Every voucher.')).toBeLessThan(text.indexOf('Export'));
  });
});
