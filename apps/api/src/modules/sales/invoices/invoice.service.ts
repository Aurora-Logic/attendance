import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_ESTIMATE_SORT,
  ESTIMATE_SORT_FIELDS,
  PERMISSIONS,
  PUSH_KIND_VOUCHER_TYPE,
  pageSlice,
  paginated,
  type CreateInvoiceInput,
  type InvoiceListQuery,
  type Paginated,
  type SalesDocumentSummary,
  type SalesDocumentView,
  type VoucherPushPayload,
} from '@vyuha/shared';
import { sql, type SQL } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database, type Transaction } from '../../../platform/db/db.provider.js';
import { orgToday } from '../../../platform/documents/document-support.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService, type ScopeGrants } from '../../../platform/rbac/scope.service.js';
import { PushOutcomeRegistry, type PushMirror, type PushOutcome } from '../../../platform/sync/push-outcome.registry.js';
import { PushQueueService } from '../../../platform/sync/push-queue.service.js';
import { EstimateRepository, type EstimateHeaderInput } from '../estimates/estimate.repository.js';
import { salesDocuments } from '../schema/index.js';

/**
 * Vyuha-raised invoices (D-38: raised in both places, kept in sync). An
 * invoice is raised against a sales order for the packed-and-uninvoiced
 * balance of its lines at the order's rates; confirming it advances the
 * order's invoiced quantities — the same handshake a Tally-raised invoice
 * completes on pull — and pushes it as a Sales voucher. When that voucher
 * pulls back it attaches to the same link (`external_refs` knows the GUID),
 * so an invoice is never counted twice.
 */

const GRANTS: ScopeGrants = { self: PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, all: PERMISSIONS.SALES_DOCUMENT_VIEW_ALL };
const SQL_TRUE = sql`true`;

@Injectable()
export class InvoiceService implements OnModuleInit {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
    private readonly scopes: ScopeService,
    private readonly pushQueue: PushQueueService,
    private readonly pushOutcomes: PushOutcomeRegistry,
  ) {}

  onModuleInit(): void {
    this.pushOutcomes.register({
      kind: 'SALES_INVOICE',
      onOutcome: (tx, orgId, payload, outcome) => this.applyOutcome(tx, orgId, payload, outcome),
      onMirror: (tx, orgId, documentId, mirror) => this.applyMirror(tx, orgId, documentId, mirror),
    });
  }

  /**
   * D-38, the other direction: the accountant cancelled the Sales voucher in
   * Tally. The invoice here is cancelled too, its link to the order goes, and
   * the order's invoiced_qty gives back what this invoice covered — but never
   * below what has already left the building: goods dispatched against a
   * bill Tally later voided are the accountant's problem to re-bill, not a
   * quantity this side can un-dispatch.
   */
  private async applyMirror(tx: Transaction, orgId: string, documentId: string, mirror: PushMirror): Promise<void> {
    const rows = await tx.execute<{ status: string; number: string; source_document_id: string | null }>(sql`
      SELECT status, number, source_document_id FROM sales_documents WHERE org_id = ${orgId} AND id = ${documentId} AND doc_type = 'INVOICE' AND deleted_at IS NULL
    `);
    const current = rows.rows[0];
    if (current === undefined) return;
    await tx.execute(sql`
      UPDATE sales_documents SET remote_voucher_number = COALESCE(${mirror.remoteVoucherNumber}, remote_voucher_number), remote_guid = ${mirror.remoteGuid}, updated_at = now()
       WHERE id = ${documentId}
    `);
    if (!mirror.isCancelled || current.status !== 'CONFIRMED') return;
    await tx.execute(sql`UPDATE sales_documents SET status = 'CANCELLED', updated_at = now() WHERE id = ${documentId}`);
    if (current.source_document_id !== null) {
      const lines = await tx.execute<{ stock_item_id: string | null; description: string; quantity: string }>(sql`
        SELECT stock_item_id, description, quantity::text AS quantity FROM sales_document_lines WHERE document_id = ${documentId} AND deleted_at IS NULL ORDER BY line_no
      `);
      for (const line of lines.rows) {
        await tx.execute(sql`
          UPDATE sales_document_lines l
             SET invoiced_qty = GREATEST(l.dispatched_qty, l.invoiced_qty - ${line.quantity}::numeric), updated_at = now()
           WHERE l.id = (
             SELECT l2.id FROM sales_document_lines l2
              WHERE l2.document_id = ${current.source_document_id} AND l2.deleted_at IS NULL AND l2.invoiced_qty > l2.dispatched_qty
                AND (${line.stock_item_id === null ? sql`false` : sql`l2.stock_item_id = ${line.stock_item_id}`} OR l2.description = ${line.description})
              ORDER BY l2.line_no LIMIT 1
           )
        `);
      }
      await tx.execute(sql`DELETE FROM sales_order_invoices WHERE invoice_document_id = ${documentId}`);
    }
    this.auditContext.record({ action: 'sales.invoice.cancelled_in_tally', entityType: 'sales_document', entityId: documentId, before: { status: current.status }, after: { number: current.number, remoteGuid: mirror.remoteGuid } });
  }

  async list(principal: Principal, query: InvoiceListQuery): Promise<Paginated<SalesDocumentSummary>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).list(this.scope(principal), {
      q: query.q,
      status: query.status,
      syncState: query.syncState,
      partyId: query.partyId,
      sort: parseSortSafe(query.sort),
      limit,
      offset,
    });
    const filtered = query.sourceDocumentId === undefined ? rows : rows.filter((r) => r.sourceDocumentId === query.sourceDocumentId);
    return paginated(filtered, query, query.sourceDocumentId === undefined ? total : filtered.length);
  }

  async find(principal: Principal, id: string): Promise<SalesDocumentView> {
    const invoice = await this.repository(principal).view(this.scope(principal), id);
    if (invoice === null) throw AppError.notFound('Invoice', id);
    return invoice;
  }

  /** From the order's packed-and-uninvoiced balance (or the named lines' share of it), as a draft. */
  async createFromOrder(principal: Principal, orderId: string, input: CreateInvoiceInput): Promise<SalesDocumentView> {
    const orders = new EstimateRepository(this.db, orgContextOf(principal), 'SALES_ORDER');
    const order = await orders.view(this.scope(principal), orderId);
    if (order === null) throw AppError.notFound('Sales order', orderId);
    if (order.status !== 'CONFIRMED') throw AppError.conflict(`${order.number} is ${order.status.toLowerCase()}; only a confirmed order is invoiced.`);
    if (order.partyId === null) throw AppError.conflict(`${order.number} has no Tally party; an invoice needs one.`);
    const requested = new Map((input.lines ?? []).map((l) => [l.lineId, Number(l.quantity)]));
    const lines = order.lines
      .map((line) => {
        const balance = Number(line.packedQty) - Number(line.invoicedQty);
        const wanted = requested.size === 0 ? balance : (requested.get(line.id) ?? 0);
        if (wanted > balance + 1e-9) throw AppError.validation(`Line ${String(line.lineNo)} (${line.description}) has ${balance.toFixed(3)} packed and uninvoiced.`, { lineId: line.id });
        return { line, quantity: wanted };
      })
      .filter((entry) => entry.quantity > 1e-9);
    if (lines.length === 0) throw AppError.conflict(`${order.number} has nothing packed and uninvoiced.`);

    const repository = this.repository(principal);
    const header: EstimateHeaderInput = {
      sourceDocumentId: order.id,
      date: input.date ?? (await orgToday(this.db, principal.orgId)),
      validUntil: null,
      partyId: order.partyId,
      companyId: order.companyId,
      dealId: order.dealId,
      customerName: order.customerName,
      ownerId: order.ownerId ?? principal.employeeId,
      notes: input.notes ?? null,
      terms: order.terms,
    };
    const id = await repository.create(
      header,
      lines.map(({ line, quantity }) => ({
        stockItemId: line.stockItemId,
        description: line.description,
        quantity: quantity.toFixed(3),
        unit: line.unit,
        rate: line.rate,
        discountPct: line.discountPct,
        taxPct: line.taxPct,
      })),
    );
    const invoice = await repository.view(SQL_TRUE, id);
    if (invoice === null) throw new Error(`Invoice ${id} vanished between insert and read-back.`);
    this.auditContext.record({ action: 'sales.invoice.created', entityType: 'sales_document', entityId: id, before: { orderId, orderNumber: order.number }, after: { number: invoice.number, grandTotal: invoice.grandTotal } });
    return invoice;
  }

  /**
   * Confirming is the moment the invoice exists: the order's lines advance
   * invoiced_qty by what this invoice covers (matched by line order against
   * the order's lines with a packed balance), the link row is written with
   * method `vyuha`, and the Sales voucher is queued.
   */
  async confirm(principal: Principal, id: string): Promise<SalesDocumentView> {
    const invoice = await this.find(principal, id);
    if (invoice.status !== 'DRAFT') throw AppError.conflict(`${invoice.number} is already ${invoice.status.toLowerCase()}.`);
    if (invoice.sourceDocumentId === null) throw AppError.conflict(`${invoice.number} is not against an order.`);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE sales_documents SET status = 'CONFIRMED', updated_at = now(), updated_by = ${principal.userId} WHERE id = ${id}`);
      for (const line of invoice.lines) {
        // Match the order line by item then description, taking only what is packed and uninvoiced.
        await tx.execute(sql`
          UPDATE sales_document_lines l
             SET invoiced_qty = LEAST(l.packed_qty, l.invoiced_qty + ${line.quantity}::numeric), updated_at = now()
           WHERE l.id = (
             SELECT l2.id FROM sales_document_lines l2
              WHERE l2.document_id = ${invoice.sourceDocumentId} AND l2.deleted_at IS NULL AND l2.packed_qty > l2.invoiced_qty
                AND (${line.stockItemId === null ? sql`false` : sql`l2.stock_item_id = ${line.stockItemId}`} OR l2.description = ${line.description})
              ORDER BY l2.line_no LIMIT 1
           )
        `);
      }
      await tx.execute(sql`
        INSERT INTO sales_order_invoices (org_id, document_id, voucher_id, invoice_document_id, method, linked_by)
        VALUES (${principal.orgId}, ${invoice.sourceDocumentId}, NULL, ${id}, 'vyuha', ${principal.userId})
        ON CONFLICT (invoice_document_id) DO NOTHING
      `);
    });
    await this.enqueuePush(principal, id);
    this.auditContext.record({ action: 'sales.invoice.confirmed', entityType: 'sales_document', entityId: id, before: null, after: { orderId: invoice.sourceDocumentId } });
    return this.find(principal, id);
  }

  async push(principal: Principal, id: string): Promise<SalesDocumentView> {
    const invoice = await this.find(principal, id);
    if (invoice.status !== 'CONFIRMED') throw AppError.conflict(`${invoice.number} is ${invoice.status.toLowerCase()}; confirm it first.`);
    if (invoice.syncState === 'PUSHED' || invoice.syncState === 'QUEUED') throw AppError.conflict(`${invoice.number} is already ${invoice.syncState === 'PUSHED' ? 'in Tally' : 'queued'}.`);
    if (!(await this.enqueuePush(principal, id))) throw AppError.conflict('No Tally connection can carry a push.');
    return this.find(principal, id);
  }

  async cancel(principal: Principal, id: string): Promise<SalesDocumentView> {
    const invoice = await this.find(principal, id);
    if (invoice.status !== 'DRAFT') throw AppError.conflict(`${invoice.number} is confirmed; cancel it in Tally, and the change arrives on the next pull.`);
    await this.repository(principal).setStatus(id, 'CANCELLED');
    this.auditContext.record({ action: 'sales.invoice.cancelled', entityType: 'sales_document', entityId: id, before: null, after: null });
    return this.find(principal, id);
  }

  private async enqueuePush(principal: Principal, id: string): Promise<boolean> {
    const invoice = await this.find(principal, id);
    const repository = this.repository(principal);
    const payload: VoucherPushPayload = {
      documentId: invoice.id,
      kind: 'SALES_INVOICE',
      voucherType: PUSH_KIND_VOUCHER_TYPE.SALES_INVOICE,
      reference: invoice.number,
      date: invoice.date,
      partyName: invoice.customerName,
      narration: `${invoice.notes ?? ''}\nvyuha:${invoice.number}:${invoice.id}`.trim(),
      idempotencyKey: `vyuha:${invoice.id}`,
      remoteGuid: null,
      lines: invoice.lines.map((l) => ({ stockItemName: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, discountPct: l.discountPct, amount: l.amount })),
    };
    const jobId = await this.pushQueue.enqueue(principal.orgId, principal.userId, payload);
    await repository.setSync(id, { syncState: jobId === null ? 'NOT_PUSHED' : 'QUEUED', pushJobId: jobId, lastError: null });
    return jobId !== null;
  }

  private async applyOutcome(tx: Transaction, orgId: string, payload: VoucherPushPayload, outcome: PushOutcome): Promise<void> {
    if (outcome.outcome === 'rejected') {
      await tx.execute(sql`UPDATE sales_documents SET sync_state = 'FAILED', last_error = ${outcome.errorText}, updated_at = now() WHERE org_id = ${orgId} AND id = ${payload.documentId}`);
      return;
    }
    await tx.execute(sql`
      UPDATE sales_documents SET sync_state = 'PUSHED', remote_guid = ${outcome.remoteGuid}, remote_voucher_number = ${outcome.remoteVoucherNumber}, last_pushed_at = now(), last_error = NULL, updated_at = now()
       WHERE org_id = ${orgId} AND id = ${payload.documentId}
    `);
  }

  private scope(principal: Principal): SQL {
    return this.scopes.resolve(principal, GRANTS, salesDocuments.ownerId).where;
  }

  private repository(principal: Principal): EstimateRepository {
    return new EstimateRepository(this.db, orgContextOf(principal), 'INVOICE');
  }
}

function parseSortSafe(sort: string | undefined): readonly { field: string; direction: 'asc' | 'desc' }[] {
  const raw = sort ?? DEFAULT_ESTIMATE_SORT;
  return raw
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term !== '')
    .map((term) => ({ field: term.replace(/^-/u, ''), direction: term.startsWith('-') ? ('desc' as const) : ('asc' as const) }))
    .filter((term) => (ESTIMATE_SORT_FIELDS as readonly string[]).includes(term.field));
}
