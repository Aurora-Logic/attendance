import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_ESTIMATE_SORT,
  ESTIMATE_SORT_FIELDS,
  PERMISSIONS,
  PUSH_KIND_VOUCHER_TYPE,
  pageSlice,
  paginated,
  parseSort,
  type ConvertEstimateInput,
  type CreateSalesOrderInput,
  type Paginated,
  type SalesDocumentSummary,
  type SalesDocumentView,
  type SalesOrderListQuery,
  type UpdateSalesOrderInput,
  type VoucherPushPayload,
} from '@vyuha/shared';
import { sql, type SQL } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database, type Transaction } from '../../../platform/db/db.provider.js';
import { hasPermission, orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService, type ScopeGrants } from '../../../platform/rbac/scope.service.js';
import { PushOutcomeRegistry, type PushOutcome } from '../../../platform/sync/push-outcome.registry.js';
import { PushQueueService } from '../../../platform/sync/push-queue.service.js';
import { orgToday, resolveDocumentCustomer, resolveDocumentLines, resolveDocumentOwner } from '../../../platform/documents/document-support.js';
import { EstimateRepository, type EstimateHeaderInput } from '../estimates/estimate.repository.js';
import { salesDocuments } from '../schema/index.js';

/**
 * Sales orders (REQ-W-03) and the push path they ride (09 §3.3, REQ-W-06,
 * REQ-W-07). Created fresh or converted from an accepted estimate; a draft
 * is edited freely; confirming it queues one push job — one voucher per
 * request, always — and from then on the document's sync state is whatever
 * the agent reported, never inferred. An alter re-pushes against the GUID
 * Tally gave and never creates a second voucher.
 *
 * The customer must be a Tally party: an order pushes, and Tally has no
 * ledger for a prospect (REQ-U-03).
 */

const GRANTS: ScopeGrants = {
  self: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF,
  all: PERMISSIONS.SALES_DOCUMENT_VIEW_ALL,
};

const SQL_TRUE = sql`true`;
const DOC_TYPE = 'SALES_ORDER' as const;

@Injectable()
export class SalesOrderService implements OnModuleInit {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
    private readonly scopes: ScopeService,
    private readonly pushOutcomes: PushOutcomeRegistry,
    private readonly pushQueue: PushQueueService,
  ) {}

  onModuleInit(): void {
    this.pushOutcomes.register({
      kind: 'SALES_ORDER',
      onOutcome: (tx, orgId, payload, outcome) => this.applyOutcome(tx, orgId, payload, outcome),
    });
  }

  async list(principal: Principal, query: SalesOrderListQuery): Promise<Paginated<SalesDocumentSummary>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).list(this.scope(principal), {
      q: query.q,
      status: query.status,
      syncState: query.syncState,
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

  async find(principal: Principal, id: string): Promise<SalesDocumentView> {
    const order = await this.repository(principal).view(this.scope(principal), id);
    if (order === null) throw AppError.notFound('Sales order', id);
    return order;
  }

  async create(principal: Principal, input: CreateSalesOrderInput): Promise<SalesDocumentView> {
    const repository = this.repository(principal);
    const customer = await resolveDocumentCustomer(this.db, principal, input.partyId, null, null);
    const lines = await resolveDocumentLines(this.db, principal, input.lines);
    const header: EstimateHeaderInput = {
      date: input.date ?? (await orgToday(this.db, principal.orgId)),
      validUntil: null,
      partyId: customer.partyId,
      companyId: null,
      dealId: input.dealId ?? null,
      customerName: customer.name,
      ownerId: await resolveDocumentOwner(this.db, this.scopes, GRANTS, principal, input.ownerId),
      notes: input.notes ?? null,
      terms: input.terms ?? null,
    };
    const id = await repository.create(header, lines);
    const order = await repository.view(SQL_TRUE, id);
    if (order === null) throw new Error(`Sales order ${id} vanished between insert and read-back.`);
    this.auditContext.record({ action: 'sales.order.created', entityType: 'sales_document', entityId: id, before: null, after: auditView(order) });
    return order;
  }

  /** REQ-W-03: an accepted estimate becomes a draft order carrying its lines. */
  async convertFromEstimate(principal: Principal, estimateId: string, input: ConvertEstimateInput): Promise<SalesDocumentView> {
    const estimates = new EstimateRepository(this.db, orgContextOf(principal), 'ESTIMATE');
    const estimate = await estimates.view(this.scope(principal), estimateId);
    if (estimate === null) throw AppError.notFound('Estimate', estimateId);
    if (estimate.status !== 'ACCEPTED') {
      throw AppError.conflict(`${estimate.number} is ${estimate.status.toLowerCase()}; only an accepted estimate becomes an order.`);
    }
    const partyId = input.partyId ?? estimate.partyId;
    if (partyId === null) {
      throw AppError.validation('The estimate was addressed to a prospect. Choose the Tally party the order is for.', {
        fields: [{ path: 'partyId', message: 'is required' }],
      });
    }
    const customer = await resolveDocumentCustomer(this.db, principal, partyId, null, null);
    const repository = this.repository(principal);
    const header: EstimateHeaderInput = {
      sourceDocumentId: estimate.id,
      date: await orgToday(this.db, principal.orgId),
      validUntil: null,
      partyId: customer.partyId,
      companyId: estimate.companyId,
      dealId: estimate.dealId,
      customerName: customer.name,
      ownerId: estimate.ownerId ?? principal.employeeId,
      notes: estimate.notes,
      terms: estimate.terms,
    };
    const id = await repository.create(
      header,
      estimate.lines.map((line) => ({
        stockItemId: line.stockItemId,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        rate: line.rate,
        discountPct: line.discountPct,
        taxPct: line.taxPct,
      })),
    );
    const order = await repository.view(SQL_TRUE, id);
    if (order === null) throw new Error(`Sales order ${id} vanished between insert and read-back.`);
    this.auditContext.record({
      action: 'sales.order.converted',
      entityType: 'sales_document',
      entityId: id,
      before: { estimateId: estimate.id, estimateNumber: estimate.number },
      after: auditView(order),
    });
    return order;
  }

  async update(principal: Principal, id: string, input: UpdateSalesOrderInput): Promise<SalesDocumentView> {
    const existing = await this.find(principal, id);
    if (existing.status !== 'DRAFT') {
      throw AppError.conflict(`${existing.number} is ${existing.status.toLowerCase()}. A confirmed order changes only through Alter (REQ-W-07).`);
    }
    return this.applyEdit(principal, existing, input, 'sales.order.updated');
  }

  /**
   * Draft → confirmed, and one push job queued for the agent. Without a
   * connection an agent can work, the order is confirmed and stays
   * NOT_PUSHED — said plainly on the screen — and Push queues it later.
   */
  async confirm(principal: Principal, id: string): Promise<SalesDocumentView> {
    const existing = await this.find(principal, id);
    if (existing.status !== 'DRAFT') throw AppError.conflict(`${existing.number} is already ${existing.status.toLowerCase()}.`);
    if (existing.lines.length === 0) throw AppError.conflict(`${existing.number} has no lines.`);
    const repository = this.repository(principal);
    await repository.setStatus(id, 'CONFIRMED');
    const queued = await this.enqueuePush(principal, { ...existing, status: 'CONFIRMED' }, false);
    const order = await repository.view(SQL_TRUE, id);
    if (order === null) throw AppError.notFound('Sales order', id);
    this.auditContext.record({
      action: 'sales.order.confirmed',
      entityType: 'sales_document',
      entityId: id,
      before: auditView(existing),
      after: { ...auditView(order), queued },
    });
    return order;
  }

  /** Queue (or re-queue) the push for a confirmed order that is not in Tally. */
  async push(principal: Principal, id: string): Promise<SalesDocumentView> {
    const existing = await this.find(principal, id);
    if (existing.status !== 'CONFIRMED') throw AppError.conflict(`${existing.number} is ${existing.status.toLowerCase()}; confirm it first.`);
    if (existing.syncState === 'PUSHED') throw AppError.conflict(`${existing.number} is already in Tally. Use Alter to change it.`);
    if (existing.syncState === 'QUEUED') throw AppError.conflict(`${existing.number} is already queued for the agent.`);
    const queued = await this.enqueuePush(principal, existing, false);
    if (!queued) {
      throw AppError.conflict('No Tally connection can carry a push: an agent connection with a bound company and an issued token is needed.');
    }
    const order = await this.repository(principal).view(SQL_TRUE, id);
    if (order === null) throw AppError.notFound('Sales order', id);
    this.auditContext.record({ action: 'sales.order.push_requested', entityType: 'sales_document', entityId: id, before: auditView(existing), after: auditView(order) });
    return order;
  }

  /**
   * REQ-W-07: a pushed order is read-only except through this. The edit is
   * applied and re-pushed against the stored GUID; the agent alters that
   * voucher and never creates a second. Needs `sales.document.alter`.
   */
  async alter(principal: Principal, id: string, input: UpdateSalesOrderInput): Promise<SalesDocumentView> {
    if (!hasPermission(principal, PERMISSIONS.SALES_DOCUMENT_ALTER)) {
      throw AppError.forbidden('Altering an accepted document needs sales.document.alter.');
    }
    const existing = await this.find(principal, id);
    if (existing.syncState === 'QUEUED') throw AppError.conflict(`${existing.number} has a push in flight.`);
    if (existing.status !== 'CONFIRMED' || existing.syncState !== 'PUSHED' || existing.remoteGuid === null) {
      throw AppError.conflict(`${existing.number} is not in Tally; edit it as a draft, or push it first.`);
    }
    const edited = await this.applyEdit(principal, existing, input, 'sales.order.altered');
    await this.enqueuePush(principal, edited, true);
    const order = await this.repository(principal).view(SQL_TRUE, id);
    if (order === null) throw AppError.notFound('Sales order', id);
    return order;
  }

  async cancel(principal: Principal, id: string): Promise<SalesDocumentView> {
    const existing = await this.find(principal, id);
    if (existing.status !== 'DRAFT') {
      throw AppError.conflict(`${existing.number} is ${existing.status.toLowerCase()}; a confirmed order is cancelled in Tally, and the change arrives on the next pull.`);
    }
    const repository = this.repository(principal);
    await repository.setStatus(id, 'CANCELLED');
    const order = await repository.view(SQL_TRUE, id);
    if (order === null) throw AppError.notFound('Sales order', id);
    this.auditContext.record({ action: 'sales.order.cancelled', entityType: 'sales_document', entityId: id, before: auditView(existing), after: auditView(order) });
    return order;
  }

  // ---------------------------------------------------------------- helpers

  private async applyEdit(principal: Principal, existing: SalesDocumentView, input: UpdateSalesOrderInput, action: string): Promise<SalesDocumentView> {
    const repository = this.repository(principal);
    const patch: Partial<EstimateHeaderInput> = {};
    if (input.partyId !== undefined) {
      const customer = await resolveDocumentCustomer(this.db, principal, input.partyId, null, null);
      patch.partyId = customer.partyId;
      patch.customerName = customer.name;
    }
    if (input.date !== undefined) patch.date = input.date;
    if (input.dealId !== undefined) patch.dealId = input.dealId;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.terms !== undefined) patch.terms = input.terms;
    if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) {
      patch.ownerId = await resolveDocumentOwner(this.db, this.scopes, GRANTS, principal, input.ownerId);
    }
    const lines = input.lines === undefined ? undefined : await resolveDocumentLines(this.db, principal, input.lines);
    const updated = await repository.updateHeader(existing.id, patch, lines);
    if (!updated) throw AppError.notFound('Sales order', existing.id);
    const order = await repository.view(SQL_TRUE, existing.id);
    if (order === null) throw AppError.notFound('Sales order', existing.id);
    this.auditContext.record({ action, entityType: 'sales_document', entityId: existing.id, before: auditView(existing), after: auditView(order) });
    return order;
  }

  /**
   * One push job for one document (09 §3.3: one voucher per request). The
   * job's entity_type carries the document id so two documents queue side
   * by side while one document can never have two pushes open. The agent
   * renders the XML from the payload; the API never writes Tally XML.
   */
  private async enqueuePush(principal: Principal, order: SalesDocumentView, alter: boolean): Promise<boolean> {
    const repository = this.repository(principal);
    const payload: VoucherPushPayload = {
      documentId: order.id,
      kind: 'SALES_ORDER',
      voucherType: PUSH_KIND_VOUCHER_TYPE.SALES_ORDER,
      reference: order.number,
      date: order.date,
      partyName: order.customerName,
      narration: `${order.notes ?? ''}\nvyuha:${order.number}:${order.id}`.trim(),
      idempotencyKey: `vyuha:${order.id}`,
      remoteGuid: alter ? order.remoteGuid : null,
      lines: order.lines.map((line) => ({
        stockItemName: line.description,
        quantity: line.quantity,
        unit: line.unit,
        rate: line.rate,
        discountPct: line.discountPct,
        amount: line.amount,
      })),
    };
    const jobId = await this.pushQueue.enqueue(principal.orgId, principal.userId, payload);
    if (jobId === null) {
      await repository.setSync(order.id, { syncState: 'NOT_PUSHED', pushJobId: null });
      return false;
    }
    await repository.setSync(order.id, { syncState: 'QUEUED', pushJobId: jobId, lastError: null });
    return true;
  }

  /** The registry's callback: the agent's word becomes the document's state (REQ-W-06). */
  private async applyOutcome(tx: Transaction, orgId: string, payload: VoucherPushPayload, outcome: PushOutcome): Promise<void> {
    if (outcome.outcome === 'rejected') {
      await tx.execute(sql`
        UPDATE sales_documents
           SET sync_state = 'FAILED', last_error = ${outcome.errorText}, updated_at = now()
         WHERE org_id = ${orgId} AND id = ${payload.documentId} AND deleted_at IS NULL
      `);
      return;
    }
    await tx.execute(sql`
      UPDATE sales_documents
         SET sync_state = 'PUSHED', remote_guid = ${outcome.remoteGuid}, remote_voucher_number = ${outcome.remoteVoucherNumber},
             last_pushed_at = now(), last_error = NULL, updated_at = now()
       WHERE org_id = ${orgId} AND id = ${payload.documentId} AND deleted_at IS NULL
    `);
  }

  private scope(principal: Principal): SQL {
    return this.scopes.resolve(principal, GRANTS, salesDocuments.ownerId).where;
  }

  private repository(principal: Principal): EstimateRepository {
    return new EstimateRepository(this.db, orgContextOf(principal), DOC_TYPE);
  }
}

function auditView(order: SalesDocumentView): Record<string, unknown> {
  return {
    number: order.number,
    status: order.status,
    date: order.date,
    partyId: order.partyId,
    customerName: order.customerName,
    ownerId: order.ownerId,
    grandTotal: order.grandTotal,
    lineCount: order.lines.length,
    syncState: order.syncState,
    remoteGuid: order.remoteGuid,
    sourceDocumentId: order.sourceDocumentId,
  };
}
