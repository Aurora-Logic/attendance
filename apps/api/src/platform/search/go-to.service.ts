import { Injectable, Logger } from '@nestjs/common';
import {
  GO_TO_QUERY_MIN_LENGTH,
  GO_TO_RESULT_CAP,
  GO_TO_SOURCE_CAP,
  type GoToResponse,
} from '@vyuha/shared';

import { hasAnyPermission, type Principal } from '../rbac/principal.js';
import { rankGoToRecords } from './go-to-rank.js';
import { GoToSourceRegistry } from './go-to-source.registry.js';

/**
 * REQ-O-05, the orchestration: which sources this caller may search, fanned
 * out concurrently, merged, ranked, capped.
 *
 * Permission filtering happens here and scope filtering happens inside each
 * source, which is the same split the rest of the API uses — the route guard
 * keeps out whoever holds no key at all, `ScopeService` decides how much a
 * holder sees. The endpoint itself is only `@Authenticated()` because there is
 * no one permission that means "may search"; each source names its own.
 */
@Injectable()
export class GoToService {
  private readonly logger = new Logger(GoToService.name);

  constructor(private readonly registry: GoToSourceRegistry) {}

  async search(principal: Principal, rawQuery: string): Promise<GoToResponse> {
    const term = rawQuery.trim();
    if (term.length < GO_TO_QUERY_MIN_LENGTH) return { query: term, records: [] };

    const eligible = this.registry
      .sources()
      .filter((source) => hasAnyPermission(principal, source.permissions));

    const settled = await Promise.allSettled(
      eligible.map((source) => source.search(principal, term, GO_TO_SOURCE_CAP)),
    );

    const found = settled.flatMap((outcome, index) => {
      if (outcome.status === 'fulfilled') return outcome.value;
      // One broken source must not take the palette down with it — Go To is
      // the primary navigation, and "employees are missing" is recoverable in
      // a way "every search errors" is not. Logged loudly, never swallowed
      // silently.
      this.logger.error({
        msg: 'Go To source failed; its records are missing from this answer',
        recordType: eligible[index]?.recordType,
        err: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
      return [];
    });

    return { query: term, records: rankGoToRecords(term, found).slice(0, GO_TO_RESULT_CAP) };
  }
}
