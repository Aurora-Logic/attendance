import type { HelpCard } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { rankHelpCards, scoreHelpCard } from './rank';

/**
 * The behaviour worth pinning is the refusal, not the match.
 *
 * A help panel that always produces its best guess is worse than one that
 * says it has nothing, because a confident wrong answer about a punch rule or
 * a leave balance is acted on. So the tests below spend most of their time on
 * what must *not* be returned as an answer: an unrelated query, a query that
 * only brushes a card, and a card that would have floated up on the route
 * boost alone.
 */

function card(over: Partial<HelpCard> & Pick<HelpCard, 'id' | 'question'>): HelpCard {
  return {
    aliases: [],
    answer: 'An answer.',
    route: null,
    permission: null,
    tourStep: null,
    errorCodes: [],
    topic: 'punch',
    ...over,
  };
}

const GEOFENCE = card({
  id: 'punch.outside-geofence',
  question: "Why can't I punch from here?",
  aliases: ['outside geofence', 'punch blocked location', 'too far from office', 'not in range'],
  route: '/punch',
});

const LEAVE_BALANCE = card({
  id: 'leave.insufficient-balance',
  question: 'It says I do not have enough leave balance',
  aliases: ['insufficient balance', 'no leave left', 'leave balance'],
  route: '/my-leave',
  topic: 'leave',
});

const SHORTCUTS = card({
  id: 'account.keyboard',
  question: 'What are the keyboard shortcuts?',
  aliases: ['shortcuts', 'hotkeys', 'keyboard', 'tally keys'],
  topic: 'account',
});

const CORPUS = [GEOFENCE, LEAVE_BALANCE, SHORTCUTS];

describe('scoreHelpCard', () => {
  it('scores an exact alias above everything else', () => {
    expect(scoreHelpCard('outside geofence', GEOFENCE, null)).toBeGreaterThan(
      scoreHelpCard('punch', GEOFENCE, null),
    );
  });

  it('matches the question wording apostrophes and all', () => {
    expect(scoreHelpCard("why can't I punch from here?", GEOFENCE, null)).toBeGreaterThan(50);
    // Same words, no apostrophe, no capitals — a person typing in a hurry.
    expect(scoreHelpCard('why cant i punch from here', GEOFENCE, null)).toBeGreaterThan(50);
  });

  it('scores an unrelated query at zero rather than at something small', () => {
    expect(scoreHelpCard('purchase order vendor', GEOFENCE, null)).toBe(0);
  });

  it('does not let the route boost carry a card that matched nothing', () => {
    // On /punch, asking about something else entirely. The boost must not
    // apply, or every card on the current screen answers every question.
    expect(scoreHelpCard('vendor lead time', GEOFENCE, '/punch')).toBe(0);
  });

  it('uses the route only to break a tie between cards that both matched', () => {
    const off = scoreHelpCard('punch', GEOFENCE, null);
    const on = scoreHelpCard('punch', GEOFENCE, '/punch');
    expect(on).toBeGreaterThan(off);
  });

  it('ignores stopwords so a question is carried by its nouns', () => {
    // "leave balance" and "the balance of my leave" should both land.
    expect(scoreHelpCard('the balance of my leave', LEAVE_BALANCE, null)).toBeGreaterThan(0);
  });

  it('still matches when a query is nothing but stopwords', () => {
    // Falls back to every word rather than scoring the whole corpus at zero.
    expect(scoreHelpCard('what is this', card({ id: 'x', question: 'What is this?' }), null))
      .toBeGreaterThan(0);
  });
});

describe('rankHelpCards', () => {
  it('puts the right card first', () => {
    const { answers } = rankHelpCards('cant punch from here', CORPUS, null);
    expect(answers[0]?.card.id).toBe('punch.outside-geofence');
  });

  it('returns nothing at all for a query the corpus does not cover', () => {
    const ranking = rankHelpCards('how do I calculate gratuity', CORPUS, null);
    expect(ranking.answers).toEqual([]);
    expect(ranking.nearMisses).toEqual([]);
  });

  it('separates a weak match into near misses rather than calling it an answer', () => {
    // "office" appears only inside one alias phrase, as a substring hit worth
    // 1 — real enough to offer as "closest thing", not enough to claim.
    const ranking = rankHelpCards('offic', CORPUS, null);
    expect(ranking.answers).toEqual([]);
    expect(ranking.nearMisses.map((m) => m.card.id)).toContain('punch.outside-geofence');
  });

  it('is deterministic when two cards tie', () => {
    const first = rankHelpCards('balance', CORPUS, null);
    const second = rankHelpCards('balance', CORPUS, null);
    expect(first.answers.map((m) => m.card.id)).toEqual(second.answers.map((m) => m.card.id));
  });

  it('answers an empty query with nothing, so the panel can show topics instead', () => {
    expect(rankHelpCards('', CORPUS, null).answers).toEqual([]);
  });
});
