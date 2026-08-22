import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { heatGridOf } from './heat-grid';
import { HeatmapTable } from './heatmap-table';

describe('HeatmapTable', () => {
  it('draws one named cell per category and month, shades by the grid maximum, and opens a row', () => {
    const grid = heatGridOf([
      { category: 'Asha', month: '2026-04', value: 2, rowId: 'a' },
      { category: 'Asha', month: '2026-05', value: 10, rowId: 'a' },
      { category: 'Behar', month: '2026-05', value: 5, rowId: '' },
    ]);
    const onRow = vi.fn();
    render(<HeatmapTable grid={grid} rowLabel="Customer" onRow={onRow} />);
    expect(screen.getByRole('button', { name: 'Asha, 2026-05: 10' }).className).toContain('chart-5');
    expect(screen.getByRole('button', { name: 'Asha, 2026-04: 2' }).className).toContain('chart-1');
    expect(screen.getByRole('button', { name: 'Behar, 2026-04: nothing' }).className).toContain('bg-muted');
    fireEvent.click(screen.getByRole('button', { name: 'Asha' }));
    expect(onRow).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('button', { name: 'Behar' })).toBeNull();
  });
});
