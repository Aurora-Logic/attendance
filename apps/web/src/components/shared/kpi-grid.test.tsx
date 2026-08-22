import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KpiGrid } from './kpi-grid';

describe('KpiGrid', () => {
  it('shows the change against the comparison, "new" on a zero base, and no delta without one', () => {
    render(
      <KpiGrid
        tiles={[
          { label: 'Ordered', value: '120', current: 120, previous: 100, format: String },
          { label: 'Revenue', value: '8,000', current: 8000, previous: 0 },
          { label: 'Shortages', value: '1', current: 1, previous: 3, format: String, lowerIsBetter: true },
          { label: 'On the shelf', value: '50', note: 'Tally closing' },
        ]}
      />,
    );
    expect(screen.getByText('+20 (+20%)')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();
    const fewer = screen.getByText('−2 (−66.7%)');
    expect(fewer.closest('dd')?.className).toContain('text-success');
    expect(screen.getByText('Tally closing')).toBeTruthy();
    expect(screen.queryByText('no change')).toBeNull();
  });
});
