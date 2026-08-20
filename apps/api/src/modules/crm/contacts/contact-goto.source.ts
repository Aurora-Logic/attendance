import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS, type GoToRecord } from '@vyuha/shared';

import type { Principal } from '../../../platform/rbac/principal.js';
import { GoToSourceRegistry, type GoToSource } from '../../../platform/search/go-to-source.registry.js';
import { CrmService } from './crm.service.js';

/**
 * Contacts and companies in Go To (REQ-O-05 names "contact names" outright).
 * Both go through `CrmService`, so the palette is scoped exactly as the
 * screens are — a `view.self` holder finds their own people and nobody
 * else's. Two sources rather than one because the palette routes by record
 * type, and a contact and a company open different screens.
 */
@Injectable()
export class ContactGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'contact';
  readonly permissions = [PERMISSIONS.CRM_CONTACT_VIEW_SELF, PERMISSIONS.CRM_CONTACT_VIEW_ALL] as const;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly crm: CrmService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.crm.listContacts(principal, { page: 1, pageSize: limit, q: term });
    return data.map((contact) => ({
      type: this.recordType,
      id: contact.id,
      title: contact.name,
      subtitle: [contact.designation, contact.companyName].filter((p): p is string => p !== null).join(' · ') || null,
      code: null,
    }));
  }
}

@Injectable()
export class CompanyGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'company';
  readonly permissions = [PERMISSIONS.CRM_CONTACT_VIEW_SELF, PERMISSIONS.CRM_CONTACT_VIEW_ALL] as const;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly crm: CrmService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.crm.listCompanies(principal, { page: 1, pageSize: limit, q: term });
    return data.map((company) => ({
      type: this.recordType,
      id: company.id,
      title: company.name,
      subtitle: [company.city, company.contactCount === 0 ? null : `${company.contactCount} contact${company.contactCount === 1 ? '' : 's'}`]
        .filter((p): p is string => p !== null)
        .join(' · ') || null,
      code: null,
    }));
  }
}
