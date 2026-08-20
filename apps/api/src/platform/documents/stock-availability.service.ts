import { Injectable } from '@nestjs/common';
import type { StockAvailability } from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../db/db.provider.js';

/**
 * REQ-AC-03/AC-04: the one number Tally cannot give — available = closing
 * balance − quantity committed to open sales orders. Committed is Vyuha's
 * own operational figure (13 §2): it never reaches a statement or a ledger,
 * and a database rebuilt from a backfill recomputes it from the open orders.
 * Read here in raw SQL over the sales module's lines rather than through
 * the module (technical design §1): the platform owns the question because
 * the low-stock report and the procurement job ask it too.
 */
@Injectable()
export class StockAvailabilityService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  async forItems(orgId: string, stockItemIds: readonly string[]): Promise<Map<string, StockAvailability>> {
    const out = new Map<string, StockAvailability>();
    if (stockItemIds.length === 0) return out;
    const rows = await this.db.execute<{
      id: string;
      closing_qty: string | null;
      committed: string;
      open_po: string;
      reorder_level: string | null;
      minimum_order_qty: string | null;
      as_of: Date | null;
    }>(sql`
      SELECT s.id,
             s.closing_qty::text AS closing_qty,
             COALESCE((
               SELECT sum(l.quantity - l.dispatched_qty)
                 FROM sales_document_lines l
                 JOIN sales_documents d ON d.id = l.document_id
                WHERE l.stock_item_id = s.id AND l.deleted_at IS NULL
                  AND d.doc_type = 'SALES_ORDER' AND d.status = 'CONFIRMED'
                  AND d.short_closed_at IS NULL AND d.deleted_at IS NULL
             ), 0)::text AS committed,
             COALESCE((
               SELECT sum(pl.quantity - pl.received_qty - pl.rejected_qty)
                 FROM purchase_order_lines pl
                 JOIN purchase_orders po ON po.id = pl.purchase_order_id
                WHERE pl.stock_item_id = s.id AND pl.deleted_at IS NULL
                  AND po.status = 'CONFIRMED' AND po.short_closed_at IS NULL AND po.deleted_at IS NULL
             ), 0)::text AS open_po,
             i.reorder_level::text AS reorder_level,
             i.minimum_order_qty::text AS minimum_order_qty,
             s.last_pulled_at AS as_of
        FROM stock_items s
        LEFT JOIN item_settings i ON i.stock_item_id = s.id AND i.deleted_at IS NULL
       WHERE s.org_id = ${orgId} AND s.id = ANY(${sql.raw(`ARRAY[${stockItemIds.map((id) => `'${id}'::uuid`).join(',')}]`)})
    `);
    for (const row of rows.rows) {
      const closing = row.closing_qty === null ? null : Number(row.closing_qty);
      out.set(row.id, {
        stockItemId: row.id,
        closingQty: row.closing_qty === null ? null : Number(row.closing_qty).toFixed(3),
        committedQty: Number(row.committed).toFixed(3),
        availableQty: closing === null ? null : (closing - Number(row.committed)).toFixed(3),
        openPoQty: Number(row.open_po).toFixed(3),
        reorderLevel: row.reorder_level === null ? null : Number(row.reorder_level).toFixed(3),
        minimumOrderQty: row.minimum_order_qty === null ? null : Number(row.minimum_order_qty).toFixed(3),
        asOf: row.as_of === null ? null : new Date(row.as_of).toISOString(),
      });
    }
    return out;
  }

  async forItem(orgId: string, stockItemId: string): Promise<StockAvailability | null> {
    return (await this.forItems(orgId, [stockItemId])).get(stockItemId) ?? null;
  }
}
