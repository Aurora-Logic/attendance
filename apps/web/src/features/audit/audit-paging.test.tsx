import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActorChip } from './actor-chip';
import { olderAction } from './format';
import type { AuditEntry } from './types';

/**
 * The two things in the audit trail's presentation that can be wrong without
 * failing a type: which way the Older button moves, and whether an unattended
 * job is drawn as a person.
 */

describe('olderAction', () => {
  it('advances without fetching when the next page is already cached', () => {
    expect(
      olderAction({ pageIndex: 0, fetchedPages: 3, hasNextPage: true, isFetching: false }),
    ).toBe('advance');
  });

  it('fetches when standing on the last fetched page and the server has more', () => {
    expect(
      olderAction({ pageIndex: 2, fetchedPages: 3, hasNextPage: true, isFetching: false }),
    ).toBe('fetch');
  });

  it('is disabled at the end of the trail', () => {
    // The case that would otherwise offer a page that does not exist.
    expect(
      olderAction({ pageIndex: 2, fetchedPages: 3, hasNextPage: false, isFetching: false }),
    ).toBe('disabled');
  });

  it('is disabled while a fetch is in flight, so a second click cannot skip a page', () => {
    expect(
      olderAction({ pageIndex: 2, fetchedPages: 3, hasNextPage: true, isFetching: true }),
    ).toBe('disabled');
  });

  it('never advances past what has been fetched', () => {
    // Guards the off-by-one directly: on the last cached page, advancing would
    // render an undefined page as an empty table.
    for (let pages = 1; pages <= 4; pages += 1) {
      expect(
        olderAction({
          pageIndex: pages - 1,
          fetchedPages: pages,
          hasNextPage: false,
          isFetching: false,
        }),
      ).toBe('disabled');
    }
  });
});

function entry(actor: AuditEntry['actor']): AuditEntry {
  return { actor } as AuditEntry;
}

describe('ActorChip', () => {
  it('gives a person an initials avatar', () => {
    render(<ActorChip entry={entry({ id: 'u1', name: 'Anita Rao', email: 'a@example.com' } )} />);
    expect(screen.getByText('Anita Rao')).toBeTruthy();
    expect(screen.getByText('AR')).toBeTruthy();
  });

  it('draws an unattended job as System, with no avatar at all', () => {
    const { container } = render(<ActorChip entry={entry(null)} />);
    expect(screen.getByText('System')).toBeTruthy();
    // The assertion that matters: an accrual sweep must not acquire a face and
    // read as a colleague who made a decision.
    expect(container.querySelector('[data-slot="avatar"]')).toBeNull();
  });

  it('falls back to the email when an account has no employee record', () => {
    render(<ActorChip entry={entry({ id: 'u2', name: null, email: 'ops@example.com' } )} />);
    expect(screen.getByText('ops@example.com')).toBeTruthy();
  });
});
