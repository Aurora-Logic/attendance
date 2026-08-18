import { Injectable } from '@nestjs/common';
import {
  DATA_SCOPES,
  DEFAULT_ESTIMATE_SORT,
  ESTIMATE_SORT_FIELDS,
  ESTIMATE_TRANSITIONS,
  PERMISSIONS,
  pageSlice,
  paginated,
  parseSort,
  type CreateEstimateInput,
  type EstimateListQuery,
  type EstimateStatusInput,
  type EstimateSummary,
  type EstimateView,
  type ItemHistoryQuery,
  type ItemHistoryView,
  type Paginated,
  type SalesLineInput,
  type UpdateEstimateInput,
} from '@vyuha/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { employees, organizations, parties, stockItems } from '../../../platform/db/schema/index.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService, type ScopeGrants } from '../../../platform/rbac/scope.service.js';
import { salesDocuments } from '../schema/index.js';
import { EstimateRepository, type EstimateHeaderInput } from './estimate.repository.js';

/**
 * Estimates (REQ-W-01, REQ-W-02). Vyuha-owned; nothing here reaches Tally
 * (D-04). Ownership scopes like every CRM record; a draft is editable, and
 * anything past draft is read-only except for its status — an accepted
 * estimate is what a sales order is raised from, and rewriting it after the
 * fact would rewrite what the customer agreed to.
 *
 * The customer is a Tally party, a CRM company, or a name. The company is
 * checked to exist by id in raw SQL rather than through `CrmService`,
 * because this module may not import that one (technical design §1); the
 * scope question ("may this user see that company") is CRM's and answered
 * on CRM's screens, where the estimate is raised from.
 */

const GRANTS: ScopeGrants = {
  self: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
  all: PERMISSIONS.SALES_DOCUMENT_VIEW_ALL,
};

const SQL_TRUE = sql`true`;

@Injectable()
export class EstimateService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
    private readonly scopes: ScopeService,
  ) {}

  async list(principal: Principal, query: EstimateListQuery): Promise<Paginated<EstimateSummary>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).list(this.scope(principal), {
      q: query.q,
      status: query.status,
      partyId: query.partyId,
      companyId: query.companyId,
      dealId: query.dealId,
      ownerId: query.ownerId,
      sort: parseSort(query.sort ?? DEFAULT_ESTIMATE_SORT, ESTIMATE_SORT_FIELDS),
      limit,
      offset,
    });
    return paginated(rows, query, total);
  }

  async find(principal: Principal, id: string): Promise<EstimateView> {
    const estimate = await this.repository(principal).view(this.scope(principal), id);
    if (estimate === null) throw AppError.notFound('Estimate', id);
    return estimate;
  }

  async create(principal: Principal, input: CreateEstimateInput): Promise<EstimateView> {
    const repository = this.repository(principal);
    const customer = await this.resolveCustomer(principal, input.partyId ?? null, input.companyId ?? null, input.customerName ?? null);
    const lines = await this.resolveLines(principal, input.lines);
    const header: EstimateHeaderInput = {
      date: input.date ?? (await this.today(principal.orgId)),
      validUntil: input.validUntil ?? null,
      partyId: customer.partyId,
      companyId: customer.companyId,
      dealId: input.dealId ?? null,
      customerName: customer.name,
      ownerId: await this.resolveOwner(principal, input.ownerId),
      notes: input.notes ?? null,
      terms: input.terms ?? null,
    };
    const id = await repository.create(header, lines);
    const estimate = await repository.view(SQL_TRUE, id);
    if (estimate === null) throw new Error(`Estimate ${id} vanished between insert and read-back.`);
    this.auditContext.record({
      action: 'sales.estimate.created',
      entityType: 'sales_document',
      entityId: id,
      before: null,
      after: auditView(estimate),
    });
    return estimate;
  }

  async update(principal: Principal, id: string, input: UpdateEstimateInput): Promise<EstimateView> {
    const repository = this.repository(principal);
    const existing = await this.find(principal, id);
    if (existing.status !== 'DRAFT') {
      throw AppError.conflict(
        `${existing.number} is ${existing.status.toLowerCase()} and read-only. Move it back to draft, or raise a new estimate.`,
      );
    }
    const patch: Partial<EstimateHeaderInput> = {};
    if (input.partyId !== undefined || input.companyId !== undefined || input.customerName !== undefined) {
      const customer = await this.resolveCustomer(
        principal,
        input.partyId === undefined ? existing.partyId : input.partyId,
        input.companyId === undefined ? existing.companyId : input.companyId,
        input.customerName ?? (input.partyId === undefined && input.companyId === undefined ? existing.customerName : null),
      );
      patch.partyId = customer.partyId;
      patch.companyId = customer.companyId;
      patch.customerName = customer.name;
    }
    if (input.date !== undefined) patch.date = input.date;
    if (input.validUntil !== undefined) patch.validUntil = input.validUntil;
    if (input.dealId !== undefined) patch.dealId = input.dealId;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.terms !== undefined) patch.terms = input.terms;
    if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) {
      patch.ownerId = await this.resolveOwner(principal, input.ownerId);
    }
    const lines = input.lines === undefined ? undefined : await this.resolveLines(principal, input.lines);
    const updated = await repository.updateHeader(id, patch, lines);
    if (!updated) throw AppError.notFound('Estimate', id);
    const estimate = await repository.view(SQL_TRUE, id);
    if (estimate === null) throw AppError.notFound('Estimate', id);
    this.auditContext.record({
      action: 'sales.estimate.updated',
      entityType: 'sales_document',
      entityId: id,
      before: auditView(existing),
      after: auditView(estimate),
    });
    return estimate;
  }

  async setStatus(principal: Principal, id: string, input: EstimateStatusInput): Promise<EstimateView> {
    const repository = this.repository(principal);
    const existing = await this.find(principal, id);
    if (input.status === existing.status) return existing;
    if (!ESTIMATE_TRANSITIONS[existing.status].includes(input.status)) {
      throw AppError.conflict(`${existing.number} cannot go from ${existing.status.toLowerCase()} to ${input.status.toLowerCase()}.`, {
        from: existing.status,
        to: input.status,
        allowed: ESTIMATE_TRANSITIONS[existing.status],
      });
    }
    if (input.status !== 'DRAFT' && existing.lines.length === 0) {
      throw AppError.conflict(`${existing.number} has no lines; add at least one before sending it.`);
    }
    const changed = await repository.setStatus(id, input.status);
    if (!changed) throw AppError.notFound('Estimate', id);
    const estimate = await repository.view(SQL_TRUE, id);
    if (estimate === null) throw AppError.notFound('Estimate', id);
    this.auditContext.record({
      action: `sales.estimate.${input.status.toLowerCase()}`,
      entityType: 'sales_document',
      entityId: id,
      before: auditView(existing),
      after: auditView(estimate),
    });
    return estimate;
  }

  async remove(principal: Principal, id: string): Promise<void> {
    const existing = await this.find(principal, id);
    if (existing.status !== 'DRAFT') {
      throw AppError.conflict(`${existing.number} is ${existing.status.toLowerCase()}; only a draft can be deleted. Reject or expire it instead.`);
    }
    const deleted = await this.repository(principal).softDelete(id);
    if (!deleted) throw AppError.notFound('Estimate', id);
    this.auditContext.record({
      action: 'sales.estimate.deleted',
      entityType: 'sales_document',
      entityId: id,
      before: auditView(existing),
      after: null,
    });
  }

  /** REQ-W-02. Any document viewer may ask: it is read from data they can already open. */
  async itemHistory(principal: Principal, query: ItemHistoryQuery): Promise<ItemHistoryView> {
    const history = await this.repository(principal).itemHistory({
      stockItemId: query.stockItemId,
      partyId: query.partyId ?? null,
      companyId: query.companyId ?? null,
      limit: query.limit,
    });
    if (history === null) throw AppError.notFound('Stock item', query.stockItemId);
    return history;
  }

  // ---------------------------------------------------------------- helpers

  private scope(principal: Principal): SQL {
    return this.scopes.resolve(principal, GRANTS, salesDocuments.ownerId).where;
  }

  private async resolveOwner(principal: Principal, requested: string | null | undefined): Promise<string | null> {
    if (requested === undefined || requested === null) return principal.employeeId;
    if (requested === principal.employeeId) return requested;
    if (this.scopes.breadth(principal, GRANTS) !== DATA_SCOPES.ALL) {
      throw AppError.forbidden('Only a holder of sales.document.view.all may assign a document to somebody else.');
    }
    const rows = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.orgId, principal.orgId), eq(employees.id, requested), isNull(employees.deletedAt)))
      .limit(1);
    if (rows.length === 0) throw AppError.validation('The owner must be a current employee.', { ownerId: requested });
    return requested;
  }

  /** A party wins over a company when both are given: the party is who invoices go to. */
  private async resolveCustomer(
    principal: Principal,
    partyId: string | null,
    companyId: string | null,
    customerName: string | null,
  ): Promise<{ partyId: string | null; companyId: string | null; name: string }> {
    let name = customerName;
    if (partyId !== null) {
      const rows = await this.db
        .select({ name: parties.name })
        .from(parties)
        .where(and(eq(parties.orgId, principal.orgId), eq(parties.id, partyId)))
        .limit(1);
      const party = rows[0];
      if (party === undefined) throw AppError.validation('The party was not found.', { partyId });
      name ??= party.name;
    }
    if (companyId !== null) {
      const rows = await this.db.execute<{ name: string; party_id: string | null }>(
        sql`SELECT name, party_id FROM crm_companies WHERE org_id = ${principal.orgId} AND id = ${companyId} AND deleted_at IS NULL LIMIT 1`,
      );
      const company = rows.rows[0];
      if (company === undefined) throw AppError.validation('The company was not found.', { companyId });
      name ??= company.name;
    }
    if (name === null || name === '') throw AppError.validation('A party, a company, or a customer name is required.');
    return { partyId, companyId, name };
  }

  /**
   * Lines with a stock item take the item's name as description when none
   * was typed, and its GST rate as tax when none was given; a free-text line
   * stands as typed. An item id from another organisation is refused.
   */
  private async resolveLines(principal: Principal, lines: readonly SalesLineInput[]): Promise<SalesLineInput[]> {
    const resolved: SalesLineInput[] = [];
    for (const line of lines) {
      if (line.stockItemId === undefined || line.stockItemId === null) {
        resolved.push({ ...line, stockItemId: null });
        continue;
      }
      const rows = await this.db
        .select({ name: stockItems.name, unit: stockItems.unit, gstRate: stockItems.gstRate })
        .from(stockItems)
        .where(and(eq(stockItems.orgId, principal.orgId), eq(stockItems.id, line.stockItemId)))
        .limit(1);
      const item = rows[0];
      if (item === undefined) throw AppError.validation('A line names a stock item that was not found.', { stockItemId: line.stockItemId });
      resolved.push({
        ...line,
        description: line.description === '' ? item.name : line.description,
        unit: line.unit ?? item.unit,
        taxPct: line.taxPct === '0' && item.gstRate !== null ? String(Number(item.gstRate)) : line.taxPct,
      });
    }
    return resolved;
  }

  private async today(orgId: string): Promise<string> {
    const rows = await this.db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return new Intl.DateTimeFormat('en-CA', { timeZone: rows[0]?.timezone ?? 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  private repository(principal: Principal): EstimateRepository {
    return new EstimateRepository(this.db, orgContextOf(principal));
  }
}

function auditView(estimate: EstimateView): Record<string, unknown> {
  return {
    number: estimate.number,
    status: estimate.status,
    date: estimate.date,
    validUntil: estimate.validUntil,
    partyId: estimate.partyId,
    companyId: estimate.companyId,
    dealId: estimate.dealId,
    customerName: estimate.customerName,
    ownerId: estimate.ownerId,
    grandTotal: estimate.grandTotal,
    lineCount: estimate.lines.length,
  };
}
