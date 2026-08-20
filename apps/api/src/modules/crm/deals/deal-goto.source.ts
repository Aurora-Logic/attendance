import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS, type GoToRecord } from '@vyuha/shared';

import type { Principal } from '../../../platform/rbac/principal.js';
import { GoToSourceRegistry, type GoToSource } from '../../../platform/search/go-to-source.registry.js';
import { DealService } from './deal.service.js';

/** REQ-O-05 names deal names. Open and closed alike: a won deal is the one somebody looks up. */
@Injectable()
export class DealGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'deal';
  readonly permissions = [PERMISSIONS.CRM_DEAL_VIEW_SELF, PERMISSIONS.CRM_DEAL_VIEW_ALL] as const;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly deals: DealService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.deals.listDeals(principal, { page: 1, pageSize: limit, q: term, status: 'all' });
    return data.map((deal) => ({
      type: this.recordType,
      id: deal.id,
      title: deal.name,
      subtitle: [deal.companyName, deal.stageName, deal.value === null ? null : deal.value]
        .filter((p): p is string => p !== null)
        .join(' · ') || null,
      code: null,
    }));
  }
}
