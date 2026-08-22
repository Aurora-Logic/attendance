import type { ErrorCode } from './errors.js';
import type { PermissionKey } from './permissions.js';

/**
 * REQ-AJ-01 to REQ-AJ-04 (proposed; see `OPEN-QUESTIONS.md` P-HELP-1): the
 * answer panel behind Ctrl+F1.
 *
 * **This file carries the shape and not one word of the content.** The cards
 * themselves live in `apps/api/src/platform/help/help.cards.ts` and reach a
 * client only through `GET /help/cards`, which is authenticated and filtered.
 * That is not tidiness. `docker/Caddyfile` serves the built SPA from
 * `handle { root * /srv }` with no auth directive and proxies only `/api/*`
 * to the guarded API, so anything this package exports and the web app
 * imports is readable by anyone who resolves the domain — and these cards
 * say which controls are switched off and which settings nothing reads. A
 * corpus is a disclosure surface, so it is served, never bundled.
 *
 * The answers are written short enough to be shown verbatim. Nothing
 * summarises them at read time, which is what lets the panel be ordinary
 * deterministic code instead of a model.
 */

/**
 * Below this the panel shows the topic list rather than searching. One
 * character matches most of the corpus, and a list that reshuffles on every
 * keystroke from the first one reads as noise.
 */
export const HELP_QUERY_MIN_LENGTH = 2;

/**
 * What the panel shows for one query. Past this a person is browsing rather
 * than asking, and browsing is what the topic list is for.
 */
export const HELP_RESULT_CAP = 6;

/**
 * A card scoring below this is not offered as an answer. It may still appear
 * under "nothing matched" as a near miss, which is a different promise: one
 * says "this is your answer", the other says "these are the closest things I
 * have". Conflating them is how a help panel starts lying.
 */
export const HELP_CONFIDENCE_FLOOR = 3;

/**
 * Grouping for the topic list, and nothing else. Never branched on — a card
 * belongs to exactly one topic for display, and a new module adds a value
 * here rather than teaching the panel about itself.
 */
export const HELP_TOPICS = [
  'punch',
  'attendance',
  'leave',
  'approvals',
  'reports',
  'people',
  'documents',
  'tally',
  'account',
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

export interface HelpCard {
  /** Stable slug. Referenced by tests and by the error-code hook, so renaming one is a breaking change. */
  readonly id: string;
  /**
   * The canonical phrasing, shown as the answer's heading. Written as the
   * question a person actually asks — "Why can't I punch from here?" — not as
   * a documentation title, because the heading is half the answer.
   */
  readonly question: string;
  /**
   * The other ways people type it. This is the whole substitute for a model's
   * paraphrase tolerance, so it is written generously and grows from real
   * misses rather than from imagination.
   */
  readonly aliases: readonly string[];
  /**
   * One to three sentences, rendered verbatim. If an answer will not fit, the
   * card is really two cards.
   */
  readonly answer: string;
  /**
   * The route this card is about, for boosting while a person is on it. Null
   * means it is not about one screen.
   */
  readonly route: string | null;
  /**
   * The key a caller must hold to be shown this card at all. Null means
   * anyone signed in. Filtering happens on the server for the same reason
   * every other list does: the client's copy is cosmetic.
   */
  readonly permission: PermissionKey | null;
  /**
   * A step id in the guided tour registry. Present means the answer can end
   * in **Show me** — the tour walks the real control on the real screen,
   * which is the difference between an answer and an article.
   */
  readonly tourStep: string | null;
  /**
   * Error codes this card explains. When a request fails with one of these,
   * the failure can offer the answer at the point of failure — which reaches
   * people who would never open a help panel.
   */
  readonly errorCodes: readonly ErrorCode[];
  readonly topic: HelpTopic;
}

export interface HelpCardsResponse {
  /**
   * Every card this caller may see, unranked. The client holds the whole set
   * and searches it locally: the corpus is small, the answer is then instant
   * with no request per keystroke, and it keeps working offline after first
   * sign-in — which the service worker already precaches for.
   */
  readonly cards: readonly HelpCard[];
}
