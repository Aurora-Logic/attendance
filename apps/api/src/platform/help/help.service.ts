import { Injectable } from '@nestjs/common';
import type { HelpCardsResponse } from '@vyuha/shared';

import { hasPermission, type Principal } from '../rbac/principal.js';
import { HELP_CARDS } from './help.cards.js';

/**
 * REQ-AJ-03 (proposed): which cards this caller may be shown.
 *
 * The whole permitted set goes over the wire at once and the client searches
 * it locally. That is deliberate on three counts: the corpus is small enough
 * that ranking it in the browser is instant, an answer panel that asks the
 * server per keystroke feels slower than the question, and a set already in
 * hand still answers when the network is not there — which matters because
 * the punch screen is the one most likely to be used on a bad connection, and
 * the service worker already precaches for exactly that.
 *
 * Filtering is here rather than in the browser for the ordinary reason: the
 * client's copy of a permission decision is cosmetic. A card that names what
 * an administrator can do is not dangerous, but it is noise to someone who
 * cannot do it, and a corpus is a disclosure surface — `help.cards.ts` says
 * why the file is served rather than bundled.
 */
@Injectable()
export class HelpService {
  cardsFor(principal: Principal): HelpCardsResponse {
    const cards = HELP_CARDS.filter(
      (card) => card.permission === null || hasPermission(principal, card.permission),
    );
    return { cards };
  }
}
