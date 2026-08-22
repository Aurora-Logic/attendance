import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { APPROVAL_TYPE_ICONS, ATTENDANCE_STATUS_ICONS, DOCUMENT_ICONS, PUNCH_SOURCE_ICONS } from '@/components/shared/entity-icons';

import { AttendanceFlags, AttendanceStatusBadge, EarlyStreakBadge } from './status-badge';

/**
 * The glyph registries (22 Aug 2026) are only worth having if the glyph
 * actually lands in the DOM. Rendered, not inspected: an svg per flag, one on
 * the status pill, one on the streak badge.
 */
describe('glyphs reach the DOM', () => {
  it('every flag renders its pennant, coloured by its own token', () => {
    const { container } = render(<AttendanceFlags flags={['late', 'outside_window', 'missing_punch']} />);
    expect(container.querySelectorAll('svg')).toHaveLength(3);
    expect(container.querySelector('.text-flag-late')).not.toBeNull();
    expect(container.querySelector('.text-flag-outside-window')).not.toBeNull();
  });

  it('the status pill and the streak badge wear theirs', () => {
    const { container } = render(
      <>
        <AttendanceStatusBadge status="PRESENT" />
        <EarlyStreakBadge streak={4} />
      </>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(container.textContent).toContain('4 days early');
  });

  it('the registries hold a component for every key they claim', () => {
    for (const table of [ACTION_ICONS, APPROVAL_TYPE_ICONS, ATTENDANCE_STATUS_ICONS, PUNCH_SOURCE_ICONS, DOCUMENT_ICONS]) {
      for (const [key, Icon] of Object.entries(table)) {
        expect(typeof Icon, key).not.toBe('undefined');
        const { container } = render(<Icon aria-hidden />);
        expect(container.querySelector('svg'), key).not.toBeNull();
      }
    }
  });
});
