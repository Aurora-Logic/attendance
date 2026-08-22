import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RecordPicker } from './record-picker';

describe('RecordPicker', () => {
  it('shows a chosen option\'s warning on the trigger, before anything is saved (REQ-AO-09)', () => {
    const flagged = { id: 'a', label: 'Asha Traders Pvt Ltd', warning: 'Likely the same as Asha Traders Private Limited (same gstin). Merge in Tally.' };
    render(<RecordPicker label="Tally party" placeholder="Tally party" options={[flagged]} value={flagged} onValueChange={() => {}} />);
    expect(screen.getByLabelText(flagged.warning)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tally party' }).textContent).toContain('Asha Traders Pvt Ltd');
  });
});
