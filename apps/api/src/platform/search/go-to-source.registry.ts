import { Injectable, Logger } from '@nestjs/common';
import type { GoToRecord, PermissionKey } from '@vyuha/shared';

import type { Principal } from '../rbac/principal.js';

/**
 * How a module attaches its records to Go To (REQ-O-05).
 *
 * The same shape as `ApprovalSubjectRegistry` and `JobRegistry`, for the same
 * reason: the index must not import the modules it searches over. Each slice
 * registers its source during `onModuleInit`, and adding a record type to the
 * palette is a registration, not an edit to anything in `platform/search/`.
 * CRM's contacts and Sales' vouchers join by writing one class each in their
 * own module.
 */

export interface GoToSource {
  /** `snake_case`-free singular noun; becomes `GoToRecord.type` on the wire. */
  readonly recordType: string;

  /**
   * Holding **any** of these keys makes the source searchable at all. This is
   * the "permission-filtered before ranking" half of REQ-O-05: a source the
   * caller may not read is never queried, so its records cannot influence the
   * ranking, the cap, or a timing side channel.
   *
   * *How much* of a permitted source the caller sees is the source's own
   * problem — the employee source resolves the same scope predicate the
   * employee register uses, so Go To cannot find a person the list would hide.
   */
  readonly permissions: readonly [PermissionKey, ...PermissionKey[]];

  /**
   * Already matched to the term, at most `limit` rows, in the source's own
   * relevance order. Cross-source ordering is not this method's concern; the
   * service re-ranks the merged set.
   */
  search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]>;
}

@Injectable()
export class GoToSourceRegistry {
  private readonly logger = new Logger(GoToSourceRegistry.name);
  private readonly sourcesByType = new Map<string, GoToSource>();

  register(source: GoToSource): void {
    if (this.sourcesByType.has(source.recordType)) {
      // Two sources for one type means double results at best, and at worst a
      // module shadowing another's records depending on initialisation order.
      throw new Error(`Go To source "${source.recordType}" is already registered.`);
    }
    this.sourcesByType.set(source.recordType, source);
    this.logger.log({ msg: `Go To source registered: ${source.recordType}` });
  }

  sources(): readonly GoToSource[] {
    return [...this.sourcesByType.values()];
  }
}
