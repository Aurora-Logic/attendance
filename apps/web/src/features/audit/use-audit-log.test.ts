import { describe, expect, it } from 'vitest';

import { EMPTY_FILTERS } from './types';
import { toSearch } from './use-audit-log';

/**
 * The query string the audit viewer and the per-record history send.
 *
 * Both failures this guards against are silent. A dropped `entityId` returns
 * the whole organisation's trail under a sheet headed "History — Asha Menon",
 * which reads as that person having done all of it. And a date filter sent
 * un-widened turns "from 12 August" into "from midnight UTC on 12 August",
 * which quietly hides the first five and a half hours of an Indian working day.
 */

function paramsOf(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

describe('toSearch', () => {
  it('sends nothing but the page size when nothing is filtered', () => {
    const params = paramsOf(toSearch(EMPTY_FILTERS, null));

    expect(params.toString()).toBe('limit=50');
  });

  it('carries entityId, which is what makes a per-record history per-record', () => {
    const params = paramsOf(
      toSearch(
        { ...EMPTY_FILTERS, entityType: 'employee', entityId: '019-abc' },
        null,
      ),
    );

    expect(params.get('entityId')).toBe('019-abc');
    expect(params.get('entityType')).toBe('employee');
  });

  it('widens a date-only filter to the whole day at both ends', () => {
    const params = paramsOf(
      toSearch({ ...EMPTY_FILTERS, from: '2026-08-12', to: '2026-08-14' }, null),
    );

    expect(params.get('from')).toBe('2026-08-12T00:00:00.000Z');
    // Inclusive of the last day: a `to` of midnight would exclude everything
    // that happened on the date the reader picked.
    expect(params.get('to')).toBe('2026-08-14T23:59:59.999Z');
  });

  it('passes the cursor through unchanged', () => {
    // Opaque, and produced by the endpoint. Any transformation here would be
    // this client inventing a page boundary the server did not issue.
    const cursor = 'MjAyNi0wOC0xNFQwMDowMDowMC4wMDBafDAxOQ';
    expect(paramsOf(toSearch(EMPTY_FILTERS, cursor)).get('cursor')).toBe(cursor);
  });

  it('omits a filter that is an empty string rather than sending a blank one', () => {
    // The server's schema has `.min(1)` on action and entityType, so a blank
    // would be a 400 rather than "no filter".
    const params = paramsOf(toSearch({ ...EMPTY_FILTERS, action: '', entityId: '' }, null));

    expect(params.has('action')).toBe(false);
    expect(params.has('entityId')).toBe(false);
  });
});
