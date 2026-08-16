import type { GoToRecord } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { rankGoToRecords } from './go-to-rank.js';

/**
 * The promise under test is the delivery plan's acceptance line: "typing an
 * employee code in Go To opens that employee". Opening means ranking first,
 * so the exact-code tier must beat every fuzzier tier from every source —
 * each case here was checked against a deliberately broken comparator (one
 * that sorts alphabetically) and fails under it.
 */

function record(partial: Partial<GoToRecord> & { id: string }): GoToRecord {
  return {
    type: 'employee',
    title: 'Anonymous',
    subtitle: null,
    code: null,
    ...partial,
  };
}

describe('rankGoToRecords', () => {
  it('puts an exact code match first, whatever order it arrived in', () => {
    const ranked = rankGoToRecords('vy-0003', [
      record({ id: 'prefix', code: 'VY-00031', title: 'Prefix Person' }),
      record({ id: 'title', code: 'VY-0900', title: 'Vy-0003 Kumar' }),
      record({ id: 'exact', code: 'VY-0003', title: 'Asha Menon' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['exact', 'prefix', 'title']);
  });

  it('ranks code prefix above title prefix above a word start above an infix', () => {
    const ranked = rankGoToRecords('men', [
      record({ id: 'infix', title: 'Clement Rao' }),
      record({ id: 'word', title: 'Asha Menon' }),
      record({ id: 'title', title: 'Menaka Iyer' }),
      record({ id: 'code', code: 'MEN-01', title: 'Zed Last' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['code', 'title', 'word', 'infix']);
  });

  it('keeps the incoming order inside a tier instead of alphabetising', () => {
    // The source answered in its own relevance order; two title-prefix
    // matches must keep it. Alphabetical would put Anil first.
    const ranked = rankGoToRecords('an', [
      record({ id: 'first', title: 'Ananya Rao' }),
      record({ id: 'second', title: 'Anil Kumar' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['first', 'second']);
  });

  it('matches case-insensitively on both code and title', () => {
    const ranked = rankGoToRecords('VY-0003', [
      record({ id: 'other', title: 'Someone Else' }),
      record({ id: 'exact', code: 'vy-0003', title: 'Asha Menon' }),
    ]);
    expect(ranked[0]?.id).toBe('exact');
  });

  it('a record with no code cannot claim the code tiers', () => {
    const ranked = rankGoToRecords('vy', [
      record({ id: 'codeless', code: null, title: 'Zeta Person' }),
      record({ id: 'coded', code: 'VY-0001', title: 'Omega Person' }),
    ]);
    expect(ranked[0]?.id).toBe('coded');
  });
});
