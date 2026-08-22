import { HELP_CONFIDENCE_FLOOR, HELP_RESULT_CAP, type HelpCard } from '@vyuha/shared';

/**
 * REQ-AJ-01 (proposed): which card answers what somebody typed.
 *
 * This is the whole of what a model would have done here, and writing it out
 * makes the trade explicit. A model tolerates paraphrase for free; this does
 * not, so the cards carry hand-written aliases and this file matches against
 * them. What it buys is everything a model costs: no request per keystroke,
 * an answer that appears with the letter rather than after it, no text
 * leaving the browser, and a function that can be asserted rather than
 * evaluated.
 *
 * The one rule that shapes it: **a miss must not present as an answer.**
 * Anything below `HELP_CONFIDENCE_FLOOR` is returned separately as a near
 * miss, and the panel says "nothing matched" over those rather than printing
 * the best of a bad set under a heading that claims it is the answer. In a
 * product whose constitution says to stop rather than guess on punch rules,
 * leave accrual and money, confidently answering the wrong question is the
 * expensive failure — not answering none.
 */

/**
 * Words that appear in most questions and therefore separate none of them.
 * Dropped before scoring so "why can't I punch from here" is carried by
 * `punch` and `here`, not by `why` and `I`.
 */
const STOPWORDS = new Set([
  'a', 'am', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'cannot',
  'cant', 'did', 'do', 'does', 'doesnt', 'dont', 'for', 'from', 'get', 'got', 'has', 'have',
  'how', 'i', 'if', 'in', 'is', 'isnt', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on',
  'or', 'our', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'they', 'this', 'to',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'why', 'will', 'with', 'wont',
  'would', 'you', 'your',
]);

/** Lowercase, strip punctuation, collapse whitespace. Apostrophes close up so "can't" meets "cant". */
function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The words worth matching on. Falls back to every word when a query is
 * nothing but stopwords — "what is this" should still reach something rather
 * than scoring zero against the entire corpus.
 */
function terms(normalised: string): string[] {
  const all = normalised.split(' ').filter(Boolean);
  const meaningful = all.filter((term) => !STOPWORDS.has(term));
  return meaningful.length > 0 ? meaningful : all;
}

/**
 * Whether `needle` appears in `haystack` as whole words rather than as any
 * run of characters.
 *
 * Both sides are padded so the match has to start and end on a boundary. The
 * naive `includes` scored "offic" at 40 against the alias "too far from
 * office" — a five-letter fragment presenting as though the user had typed
 * the alias itself, which is the strongest signal this file has. A fragment
 * should reach the near-miss list, never the answer.
 */
function containsPhrase(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

export interface HelpMatch {
  readonly card: HelpCard;
  readonly score: number;
}

export interface HelpRanking {
  /** Confident enough to print as the answer. */
  readonly answers: readonly HelpMatch[];
  /**
   * Matched something, but not enough to claim. Shown under "nothing matched"
   * as the closest things available, which is a different promise from an
   * answer and is worded as one.
   */
  readonly nearMisses: readonly HelpMatch[];
}

/**
 * Scores one card. Exported for the test, which is easier to read as a table
 * of query/card/expected than as assertions about a sorted list.
 */
export function scoreHelpCard(query: string, card: HelpCard, route: string | null): number {
  const nq = normalise(query);
  if (nq === '') return 0;

  const question = normalise(card.question);
  const aliases = card.aliases.map(normalise);

  let score = 0;
  let matchedSomething = false;

  // Somebody typed the card's own wording, or one of the phrasings we wrote
  // down for it. Nothing else should be able to outrank that.
  if (question === nq || aliases.includes(nq)) {
    score += 100;
    matchedSomething = true;
  } else if (
    aliases.some((alias) => containsPhrase(alias, nq) || containsPhrase(nq, alias))
  ) {
    score += 40;
    matchedSomething = true;
  } else if (containsPhrase(question, nq)) {
    score += 30;
    matchedSomething = true;
  }

  const questionTerms = new Set(terms(question));
  const aliasTerms = new Set(aliases.flatMap((alias) => terms(alias)));

  for (const term of terms(nq)) {
    if (questionTerms.has(term)) {
      score += 4;
      matchedSomething = true;
    } else if (aliasTerms.has(term)) {
      score += 3;
      matchedSomething = true;
    } else if (question.includes(term) || aliases.some((alias) => alias.includes(term))) {
      // A partial word — "geofenc" inside "geofence". Real, but weak enough on
      // its own to stay under the floor.
      score += 1;
      matchedSomething = true;
    }
  }

  /*
   * Being on the screen a card is about is a tiebreaker, never a reason. It is
   * added only after something matched, or every card attached to the current
   * route would float over the floor on an unrelated query and the panel would
   * answer a question nobody asked.
   */
  if (matchedSomething && route !== null && card.route === route) score += 3;

  return matchedSomething ? score : 0;
}

export function rankHelpCards(
  query: string,
  cards: readonly HelpCard[],
  route: string | null,
): HelpRanking {
  const scored = cards
    .map((card) => ({ card, score: scoreHelpCard(query, card, route) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));

  return {
    answers: scored.filter((m) => m.score >= HELP_CONFIDENCE_FLOOR).slice(0, HELP_RESULT_CAP),
    nearMisses: scored.filter((m) => m.score < HELP_CONFIDENCE_FLOOR).slice(0, 3),
  };
}
