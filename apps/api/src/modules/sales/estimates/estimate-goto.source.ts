import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS, SALES_DOCUMENT_STATUS_LABELS, type GoToRecord } from '@vyuha/shared';

import type { Principal } from '../../../platform/rbac/principal.js';
import { GoToSourceRegistry, type GoToSource } from '../../../platform/search/go-to-source.registry.js';
import { EstimateService } from './estimate.service.js';

/** REQ-O-05: typing an estimate number opens it. */
@Injectable()
export class EstimateGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'estimate';
  readonly permissions = [PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL] as const;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly estimates: EstimateService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.estimates.list(principal, { page: 1, pageSize: limit, q: term });
    return data.map((estimate) => ({
      type: this.recordType,
      id: estimate.id,
      title: `Estimate ${estimate.number}`,
      subtitle: [estimate.customerName, SALES_DOCUMENT_STATUS_LABELS[estimate.status], estimate.grandTotal].join(' · '),
      code: estimate.number,
    }));
  }
}
