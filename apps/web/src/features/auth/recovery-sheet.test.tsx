import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test-support/render-shell';

import { RecoveryCodesPdf } from './recovery-sheet';

const CODES = ['ABCDE-FGHJK', 'LMNPQ-RSTUV', 'WXYZ2-34567'];

describe('RecoveryCodesPdf', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.body.dataset.print;
  });

  it('prints the sheet under data-print="recovery" with a titled file, and puts the body back afterwards', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderWithProviders(<RecoveryCodesPdf codes={CODES} />);
    for (const code of CODES) expect(screen.getByText(code)).toBeTruthy();
    expect(screen.getByText('How to use one')).toBeTruthy();

    const before = document.title;
    fireEvent.click(screen.getByRole('button', { name: 'Download as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.body.dataset.print).toBe('recovery');
    expect(document.title).toContain('recovery codes');

    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.dataset.print).toBeUndefined();
    expect(document.title).toBe(before);
  });
});
