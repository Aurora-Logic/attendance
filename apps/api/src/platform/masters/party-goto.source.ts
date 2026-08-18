import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS, type GoToRecord } from '@vyuha/shared';

import type { Principal } from '../rbac/principal.js';
import { GoToSourceRegistry, type GoToSource } from '../search/go-to-source.registry.js';
import { MastersService } from './masters.service.js';

/**
 * Parties in Go To (REQ-O-05) — the first record type after employees, and
 * the reason the registry was built as a registry: this file registers
 * itself, and nothing in `platform/search/` changed to admit it.
 *
 * Same reuse-of-authority as the employee source: the search is
 * `MastersService.listParties`, so Go To finds exactly what the Parties
 * screen shows a holder of the same key, including parties marked absent in
 * Tally — history points at them, and a palette that hid them would send
 * the reader to a screen that does not.
 */
@Injectable()
export class PartyGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'party';
  readonly permissions = [PERMISSIONS.MASTERS_TALLY_VIEW] as const;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly masters: MastersService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.masters.listParties(principal, {
      page: 1,
      pageSize: limit,
      q: term,
    });

    return data.map((party) => ({
      type: this.recordType,
      id: party.id,
      title: party.name,
      subtitle: [
        party.parentGroup,
        party.gstin,
        party.absentInTally ? 'absent in Tally' : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · '),
      // A party has no short code a person types from memory; the GSTIN is
      // searchable but nobody quotes it to navigate. Null opts out of the
      // exact-code ranking tier rather than pretending one exists.
      code: null,
    }));
  }
}
