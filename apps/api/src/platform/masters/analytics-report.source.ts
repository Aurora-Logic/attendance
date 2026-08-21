import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ANALYTICS_REPORTS,
  ANALYTICS_REPORT_KEYS,
  PERMISSIONS,
  recordCell,
  type ReportCellValue,
  type ReportColumnSpec,
  type ReportDefinition,
  type ReportFilters,
  type ReportKey,
} from '@vyuha/shared';
import { sql, type SQL } from 'drizzle-orm';

import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import {
  ReportSourceRegistry,
  type ReportSource,
  type ReportSourcePage,
} from '../export/report-source.registry.js';
import { hasPermission, type Principal } from '../rbac/principal.js';

/**
 * The Tier 1 analytics of `14` (D-46), every one a registry entry and a
 * query per REQ-AD-02 — no new route, no new screen. All fifteen read the
 * projection (vouchers, voucher_lines, stock_items, parties) plus Vyuha's
 * own committed quantities, and every row that can carries the pull it
 * rests on (REQ-AD-06). What the data cannot honestly feed — cash/bank
 * books without a ledgers master, anything bill-wise — is absent rather
 * than approximate (REQ-AD-07).
 *
 * Sorting: each report whitelists its sortable fields into a SQL fragment;
 * an unknown sort falls back to the default rather than erroring, matching
 * the shell's behaviour elsewhere.
 */

interface AnalyticsPage extends ReportSourcePage {
  readonly key: ReportKey;
  readonly rows: readonly Record<string, unknown>[];
}

/** A whitelist of sortable fields to fragments; `-field` descends. */
function orderBy(sort: string | undefined, fields: Record<string, string>, fallback: string): SQL {
  if (sort !== undefined) {
    const descending = sort.startsWith('-');
    const field = descending ? sort.slice(1) : sort;
    const column = fields[field];
    if (column !== undefined) return sql.raw(`${column} ${descending ? 'DESC' : 'ASC'} NULLS LAST`);
  }
  return sql.raw(fallback);
}

@Injectable()
export class AnalyticsReportSource implements ReportSource, OnModuleInit {
  readonly keys: readonly ReportKey[] = ANALYTICS_REPORT_KEYS;

  constructor(
    private readonly registry: ReportSourceRegistry,
    @InjectDatabase() private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  visibleDefinitions(principal: Principal): readonly ReportDefinition[] {
    return hasPermission(principal, PERMISSIONS.RECEIVABLES_VIEW) ? ANALYTICS_REPORTS : [];
  }

  assertFiltersUsable(key: ReportKey, filters: ReportFilters): ReportFilters {
    if (!this.keys.includes(key)) throw new Error(`AnalyticsReportSource does not serve "${key}".`);
    if (filters.from !== undefined && filters.to !== undefined && filters.from > filters.to) {
      throw AppError.validation('The period ends before it starts.', { fields: [{ path: 'to', message: 'must not precede from' }] });
    }
    if (key === 'ledger-extract' && filters.ledgerName === undefined) {
      throw AppError.validation('A ledger extract is for one ledger. Type its name as Tally has it.', {
        fields: [{ path: 'ledgerName', message: 'is required' }],
      });
    }
    return {
      ...(filters.from === undefined ? {} : { from: filters.from }),
      ...(filters.to === undefined ? {} : { to: filters.to }),
      ...(filters.partyId === undefined ? {} : { partyId: filters.partyId }),
      ...(filters.ledgerName === undefined ? {} : { ledgerName: filters.ledgerName }),
      ...(filters.itemName === undefined ? {} : { itemName: filters.itemName }),
    };
  }

  async count(principal: Principal, key: ReportKey, filters: ReportFilters): Promise<number> {
    this.requireHolder(principal);
    const usable = this.assertFiltersUsable(key, filters);
    // The ledger extract's opening row rides above the lines, like the statement's.
    if (key === 'ledger-extract') return (await this.scalar(sql`SELECT count(*)::int AS value FROM (${this.body(key, principal.orgId, usable)}) t`)) + 1;
    return this.scalar(sql`SELECT count(*)::int AS value FROM (${this.body(key, principal.orgId, usable)}) t`);
  }

  async page(
    principal: Principal,
    key: ReportKey,
    filters: ReportFilters & { sort?: string | undefined },
    limit: number,
    offset: number,
  ): Promise<ReportSourcePage> {
    this.requireHolder(principal);
    const usable = this.assertFiltersUsable(key, filters);
    const total = await this.count(principal, key, usable);
    const asOf = await this.asOf(principal.orgId);
    if (key === 'ledger-extract') {
      const page: AnalyticsPage = { key, total, rows: await this.ledgerExtractRows(principal.orgId, usable, limit, offset, asOf) };
      return page;
    }
    const order = orderBy(filters.sort, SORTABLE[key] ?? {}, DEFAULT_ORDER[key] ?? ' 1 ASC');
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT * FROM (${this.body(key, principal.orgId, usable)}) t ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}
    `);
    const page: AnalyticsPage = { key, total, rows: rows.rows.map((row) => ({ ...row, asOf })) };
    return page;
  }

  cells(page: ReportSourcePage, index: number, columns: readonly ReportColumnSpec[]): ReportCellValue[] {
    const typed = page as AnalyticsPage;
    const row = typed.rows[index];
    if (row === undefined) throw new Error(`No row ${String(index)} on this page.`);
    return columns.map((column) => recordCell(row, column.key));
  }

  /** Every report as one subquery whose output columns are its column keys. */
  private body(key: ReportKey, orgId: string, f: ReportFilters): SQL {
    switch (key) {
      case 'stock-summary':
        return sql`
          SELECT s.id AS "stockItemId", s.name AS item, s.parent_group AS "group", s.unit,
                 s.closing_qty::text AS "closingQty",
                 COALESCE(c.committed, 0)::text AS "committedQty",
                 (COALESCE(s.closing_qty, 0) - COALESCE(c.committed, 0))::text AS "availableQty",
                 s.cost_price::text AS "costRate",
                 round(COALESCE(s.closing_qty, 0) * COALESCE(s.cost_price, 0), 2)::text AS value
            FROM stock_items s
            LEFT JOIN (
              SELECT l.stock_item_id, sum(l.quantity - l.dispatched_qty) AS committed
                FROM sales_document_lines l JOIN sales_documents d ON d.id = l.document_id
               WHERE l.org_id = ${orgId} AND d.doc_type = 'SALES_ORDER' AND d.status = 'CONFIRMED'
                 AND d.short_closed_at IS NULL AND d.deleted_at IS NULL AND l.deleted_at IS NULL AND l.stock_item_id IS NOT NULL
               GROUP BY l.stock_item_id
            ) c ON c.stock_item_id = s.id
           WHERE s.org_id = ${orgId} AND NOT s.absent_in_tally ${this.itemClause(f, 's.name')}
        `;
      case 'negative-stock':
        return sql`
          SELECT s.id AS "stockItemId", s.name AS item, s.parent_group AS "group",
                 s.closing_qty::text AS "closingQty", s.unit, s.last_pulled_at AS "lastPulledAt"
            FROM stock_items s
           WHERE s.org_id = ${orgId} AND s.closing_qty < 0
        `;
      case 'stale-projections':
        return sql`
          SELECT ic.id AS "connectionId", COALESCE(ic.company_name, ic.name) AS "companyName", ic.status AS "connectionState",
                 p.at AS "lastPulledAt",
                 CASE WHEN p.at IS NULL THEN NULL ELSE floor(extract(epoch FROM now() - p.at) / 3600)::int END AS "hoursStale"
            FROM integration_connections ic
            LEFT JOIN (SELECT connection_id, max(last_pulled_at) AS at FROM vouchers WHERE org_id = ${orgId} GROUP BY connection_id) p ON p.connection_id = ic.id
           WHERE ic.org_id = ${orgId} AND ic.deleted_at IS NULL
             AND (p.at IS NULL OR p.at < now() - interval '24 hours')
        `;
      case 'duplicate-masters':
        // Names that collapse to the same key once case, spaces and punctuation go.
        return sql`
          WITH normalised AS (
            SELECT 'Party' AS kind, id, name, lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) AS norm FROM parties WHERE org_id = ${orgId}
            UNION ALL
            SELECT 'Item' AS kind, id, name, lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) AS norm FROM stock_items WHERE org_id = ${orgId}
          )
          SELECT a.id::text || ':' || b.id::text AS id, a.kind, a.name AS "nameA", b.name AS "nameB",
                 'Same name once case, spaces and punctuation are ignored' AS reason
            FROM normalised a JOIN normalised b ON a.kind = b.kind AND a.norm = b.norm AND a.id < b.id AND a.name <> b.name
        `;
      case 'customer-item-matrix':
        return sql`
          SELECT COALESCE(v.party_id::text, v.party_name) || ':' || COALESCE(l.stock_item_id::text, l.stock_item_name) AS id,
                 v.party_id AS "partyId", v.party_name AS "partyName", l.stock_item_id AS "stockItemId", l.stock_item_name AS item,
                 count(DISTINCT v.id)::int AS invoices, sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric)::text AS quantity,
                 sum(l.amount)::text AS value, max(v.voucher_date)::text AS "lastDate"
            FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
           WHERE ${this.salesLines(orgId, f)} ${this.partyClause(f)} ${this.itemClause(f, 'l.stock_item_name')}
           GROUP BY v.party_id, v.party_name, l.stock_item_id, l.stock_item_name
        `;
      case 'purchase-rhythm':
        return sql`
          WITH sales AS (
            SELECT party_id, party_name, voucher_date FROM vouchers
             WHERE org_id = ${orgId} AND voucher_type = 'Sales' AND NOT is_cancelled AND party_id IS NOT NULL
          ),
          gaps AS (
            SELECT party_id, voucher_date, voucher_date - lag(voucher_date) OVER (PARTITION BY party_id ORDER BY voucher_date) AS gap FROM sales
          ),
          rhythm AS (
            SELECT party_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY gap)::int AS median_gap
              FROM gaps WHERE gap IS NOT NULL GROUP BY party_id HAVING count(*) >= 2
          ),
          last_gap AS (
            SELECT DISTINCT ON (party_id) party_id, gap AS last_gap FROM gaps WHERE gap IS NOT NULL ORDER BY party_id, voucher_date DESC
          ),
          latest AS (
            SELECT party_id, max(party_name) AS party_name, max(voucher_date) AS last_sale,
                   count(*) FILTER (WHERE voucher_date >= CURRENT_DATE - 365)::int AS sales_12m
              FROM sales GROUP BY party_id
          )
          SELECT l.party_id AS "partyId", l.party_name AS "partyName", l.sales_12m AS "sales12m",
                 round(l.sales_12m / 12.0, 1)::text AS "perMonth", r.median_gap AS "medianGapDays",
                 g.last_gap AS "lastGapDays", (CURRENT_DATE - l.last_sale)::int AS "daysSince",
                 CASE WHEN g.last_gap IS NULL THEN 'STEADY'
                      WHEN g.last_gap > r.median_gap * 1.5 THEN 'SLOWING'
                      WHEN g.last_gap < r.median_gap * 0.67 THEN 'QUICKENING'
                      ELSE 'STEADY' END AS trend
            FROM latest l JOIN rhythm r ON r.party_id = l.party_id LEFT JOIN last_gap g ON g.party_id = l.party_id
        `;
      case 'price-variance':
        return sql`
          WITH rated AS (
            SELECT l.stock_item_id, l.stock_item_name, v.party_name, l.rate
              FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
             WHERE ${this.salesLines(orgId, f)} AND l.rate IS NOT NULL AND l.rate > 0 ${this.itemClause(f, 'l.stock_item_name')}
          ),
          spread AS (
            SELECT stock_item_name, count(DISTINCT party_name)::int AS buyers,
                   min(rate) AS min_rate, max(rate) AS max_rate, round(avg(rate), 2) AS avg_rate
              FROM rated GROUP BY stock_item_name HAVING count(DISTINCT party_name) >= 2 AND max(rate) > min(rate)
          )
          SELECT s.stock_item_name AS id, s.stock_item_name AS item, s.buyers,
                 s.min_rate::text AS "minRate",
                 (SELECT party_name FROM rated r WHERE r.stock_item_name = s.stock_item_name AND r.rate = s.min_rate LIMIT 1) AS "minParty",
                 s.max_rate::text AS "maxRate",
                 (SELECT party_name FROM rated r WHERE r.stock_item_name = s.stock_item_name AND r.rate = s.max_rate LIMIT 1) AS "maxParty",
                 s.avg_rate::text AS "avgRate",
                 round((s.max_rate - s.min_rate) * 100.0 / s.min_rate, 1)::text AS "spreadPct"
            FROM spread s
        `;
      case 'item-velocity':
        return sql`
          WITH sold AS (
            SELECT l.stock_item_id, l.stock_item_name,
                   sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_date >= CURRENT_DATE - 365) AS qty_12m,
                   sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_date >= CURRENT_DATE - 90) AS qty_3m
              FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
             WHERE ${this.salesLines(orgId, { })} ${this.itemClause(f, 'l.stock_item_name')}
             GROUP BY l.stock_item_id, l.stock_item_name
          )
          SELECT s.stock_item_id AS "stockItemId", s.stock_item_name AS item,
                 round(COALESCE(s.qty_12m, 0) / 12.0, 1)::text AS monthly12,
                 round(COALESCE(s.qty_3m, 0) / 3.0, 1)::text AS monthly3,
                 CASE WHEN COALESCE(s.qty_3m, 0) / 3.0 > COALESCE(s.qty_12m, 0) / 12.0 * 1.25 THEN 'RISING'
                      WHEN COALESCE(s.qty_3m, 0) / 3.0 < COALESCE(s.qty_12m, 0) / 12.0 * 0.75 THEN 'FALLING'
                      ELSE 'STEADY' END AS trend,
                 i.closing_qty::text AS "closingQty",
                 CASE WHEN COALESCE(s.qty_12m, 0) > 0 AND i.closing_qty IS NOT NULL
                      THEN floor(i.closing_qty / (s.qty_12m / 365.0))::int ELSE NULL END AS "coverDays"
            FROM sold s LEFT JOIN stock_items i ON i.id = s.stock_item_id
           WHERE COALESCE(s.qty_12m, 0) > 0
        `;
      case 'dead-stock':
        return sql`
          WITH last_sale AS (
            SELECT l.stock_item_id, max(v.voucher_date) AS last_date
              FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
             WHERE ${this.salesLines(orgId, { })} AND l.stock_item_id IS NOT NULL
             GROUP BY l.stock_item_id
          )
          SELECT i.id AS "stockItemId", i.name AS item, ls.last_date::text AS "lastSaleDate",
                 CASE WHEN ls.last_date IS NULL THEN NULL ELSE (CURRENT_DATE - ls.last_date)::int END AS "daysIdle",
                 i.closing_qty::text AS "closingQty",
                 round(COALESCE(i.closing_qty, 0) * COALESCE(i.cost_price, 0), 2)::text AS "valueLocked"
            FROM stock_items i LEFT JOIN last_sale ls ON ls.stock_item_id = i.id
           WHERE i.org_id = ${orgId} AND NOT i.absent_in_tally AND COALESCE(i.closing_qty, 0) > 0
             AND (ls.last_date IS NULL OR ls.last_date < CURRENT_DATE - 90)
             ${this.itemClause(f, 'i.name')}
        `;
      case 'movement-analysis':
        return sql`
          SELECT to_char(v.voucher_date, 'YYYY-MM') || ':' || l.stock_item_name AS id,
                 to_char(v.voucher_date, 'YYYY-MM') AS month, l.stock_item_name AS item,
                 COALESCE(sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_type = 'Purchase'), 0)::text AS "inwardQty",
                 COALESCE(sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_type = 'Sales'), 0)::text AS "outwardQty",
                 (COALESCE(sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_type = 'Purchase'), 0)
                  - COALESCE(sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_type = 'Sales'), 0))::text AS "netQty"
            FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
           WHERE l.org_id = ${orgId} AND l.kind = 'inventory' AND v.voucher_type IN ('Sales', 'Purchase') AND NOT v.is_cancelled
             ${this.periodClause(f, 'v.voucher_date')} ${this.itemClause(f, 'l.stock_item_name')}
           GROUP BY to_char(v.voucher_date, 'YYYY-MM'), l.stock_item_name
        `;
      case 'vendor-item-history':
        return sql`
          WITH bought AS (
            SELECT v.party_id, v.party_name, l.stock_item_name, v.voucher_date, l.rate, COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric AS billed_qty
              FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
             WHERE l.org_id = ${orgId} AND l.kind = 'inventory' AND v.voucher_type = 'Purchase' AND NOT v.is_cancelled
               ${this.periodClause(f, 'v.voucher_date')} ${this.partyClause(f)} ${this.itemClause(f, 'l.stock_item_name')}
          )
          SELECT COALESCE(party_id::text, party_name) || ':' || stock_item_name AS id,
                 party_name AS "vendorName", party_id AS "partyId", stock_item_name AS item,
                 count(*)::int AS purchases, sum(billed_qty)::text AS quantity,
                 (array_agg(rate ORDER BY voucher_date DESC))[1]::text AS "lastRate",
                 round(avg(rate), 2)::text AS "avgRate",
                 max(voucher_date)::text AS "lastDate",
                 CASE WHEN (array_agg(rate ORDER BY voucher_date DESC))[1] > avg(rate) * 1.05 THEN 'RISING'
                      WHEN (array_agg(rate ORDER BY voucher_date DESC))[1] < avg(rate) * 0.95 THEN 'FALLING'
                      ELSE 'STEADY' END AS "rateTrend"
            FROM bought WHERE rate IS NOT NULL
           GROUP BY party_id, party_name, stock_item_name
        `;
      case 'vendor-price-comparison':
        return sql`
          WITH last_rates AS (
            SELECT DISTINCT ON (v.party_name, l.stock_item_name) l.stock_item_name, v.party_name, l.rate
              FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
             WHERE l.org_id = ${orgId} AND l.kind = 'inventory' AND v.voucher_type = 'Purchase' AND NOT v.is_cancelled
               AND l.rate IS NOT NULL AND l.rate > 0 ${this.itemClause(f, 'l.stock_item_name')}
             ORDER BY v.party_name, l.stock_item_name, v.voucher_date DESC
          ),
          spread AS (
            SELECT stock_item_name, count(*)::int AS vendors, min(rate) AS best, max(rate) AS worst
              FROM last_rates GROUP BY stock_item_name HAVING count(*) >= 2
          )
          SELECT s.stock_item_name AS id, s.stock_item_name AS item, s.vendors,
                 s.best::text AS "bestRate",
                 (SELECT party_name FROM last_rates r WHERE r.stock_item_name = s.stock_item_name AND r.rate = s.best LIMIT 1) AS "bestVendor",
                 s.worst::text AS "worstRate",
                 (SELECT party_name FROM last_rates r WHERE r.stock_item_name = s.stock_item_name AND r.rate = s.worst LIMIT 1) AS "worstVendor",
                 CASE WHEN s.best > 0 THEN round((s.worst - s.best) * 100.0 / s.best, 1)::text ELSE '0' END AS "spreadPct"
            FROM spread s
        `;
      case 'credit-breaches':
        return sql`
          WITH balances AS (
            SELECT party_id,
                   sum(CASE WHEN voucher_type IN ('Sales', 'Debit Note', 'Payment') THEN amount
                            WHEN voucher_type IN ('Receipt', 'Credit Note') THEN -amount ELSE 0 END) AS exposure
              FROM vouchers WHERE org_id = ${orgId} AND NOT is_cancelled AND party_id IS NOT NULL GROUP BY party_id
          )
          SELECT p.id AS "partyId", p.name AS "partyName", p.credit_limit::text AS "creditLimit",
                 b.exposure::text AS exposure,
                 (b.exposure - p.credit_limit)::text AS "overBy",
                 COALESCE((SELECT count(*)::int FROM audit_logs a
                    WHERE a.org_id = ${orgId} AND a.action = 'sales.order.credit_overridden'
                      AND a.created_at >= now() - interval '90 days'), 0) AS "releases90d"
            FROM parties p JOIN balances b ON b.party_id = p.id
           WHERE p.org_id = ${orgId} AND lower(p.parent_group) = 'sundry debtors'
             AND p.credit_limit IS NOT NULL AND p.credit_limit > 0 AND b.exposure > p.credit_limit
        `;
      case 'stock-ageing':
        // FIFO-assumed (D-46): the closing quantity is covered by the newest
        // purchases first; whatever those cannot cover is 90d+ by definition.
        return sql`
          WITH inward AS (
            SELECT l.stock_item_id,
                   sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_date >= CURRENT_DATE - 30) AS in_0,
                   sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_date >= CURRENT_DATE - 60 AND v.voucher_date < CURRENT_DATE - 30) AS in_31,
                   sum(COALESCE(NULLIF(substring(l.billed_qty from '^[0-9]+(?:\\.[0-9]+)?'), ''), '0')::numeric) FILTER (WHERE v.voucher_date >= CURRENT_DATE - 90 AND v.voucher_date < CURRENT_DATE - 60) AS in_61
              FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
             WHERE l.org_id = ${orgId} AND l.kind = 'inventory' AND v.voucher_type = 'Purchase' AND NOT v.is_cancelled AND l.stock_item_id IS NOT NULL
             GROUP BY l.stock_item_id
          )
          SELECT i.id AS "stockItemId", i.name AS item, i.closing_qty::text AS "closingQty",
                 least(COALESCE(i.closing_qty, 0), COALESCE(w.in_0, 0))::text AS bucket0,
                 least(greatest(COALESCE(i.closing_qty, 0) - COALESCE(w.in_0, 0), 0), COALESCE(w.in_31, 0))::text AS bucket31,
                 least(greatest(COALESCE(i.closing_qty, 0) - COALESCE(w.in_0, 0) - COALESCE(w.in_31, 0), 0), COALESCE(w.in_61, 0))::text AS bucket61,
                 greatest(COALESCE(i.closing_qty, 0) - COALESCE(w.in_0, 0) - COALESCE(w.in_31, 0) - COALESCE(w.in_61, 0), 0)::text AS bucket90,
                 round(COALESCE(i.closing_qty, 0) * COALESCE(i.cost_price, 0), 2)::text AS "valueLocked"
            FROM stock_items i LEFT JOIN inward w ON w.stock_item_id = i.id
           WHERE i.org_id = ${orgId} AND NOT i.absent_in_tally AND COALESCE(i.closing_qty, 0) > 0
             ${this.itemClause(f, 'i.name')}
        `;
      case 'ledger-extract':
        return sql`
          SELECT l.id FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
           WHERE ${this.ledgerLines(orgId, f)} ${this.periodClause(f, 'v.voucher_date')}
        `;
      default:
        throw new Error(`AnalyticsReportSource does not serve "${key}".`);
    }
  }

  /**
   * REQ-AE-02: the extract mirrors the customer statement's shape — an
   * opening row carrying everything before the period, then each line with
   * a running balance. Debit and credit read from `is_deemed_positive`,
   * which is Tally's own word for the line's direction.
   */
  private async ledgerExtractRows(orgId: string, f: ReportFilters, limit: number, offset: number, asOf: string | null): Promise<Record<string, unknown>[]> {
    const opening = await this.db.execute<{ value: string }>(sql`
      SELECT COALESCE(sum(CASE WHEN l.is_deemed_positive THEN l.amount ELSE -l.amount END), 0)::text AS value
        FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
       WHERE ${this.ledgerLines(orgId, f)} ${f.from === undefined ? sql`AND false` : sql`AND v.voucher_date < ${f.from}`}
    `);
    const openingValue = Number(opening.rows[0]?.value ?? 0);
    const rows = await this.db.execute<{ id: string; date: string; voucher_type: string; voucher_number: string; party_name: string | null; amount: string; deemed: boolean }>(sql`
      SELECT l.id, v.voucher_date AS date, v.voucher_type, v.voucher_number, v.party_name, l.amount::text AS amount, l.is_deemed_positive AS deemed
        FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
       WHERE ${this.ledgerLines(orgId, f)} ${this.periodClause(f, 'v.voucher_date')}
       ORDER BY v.voucher_date ASC, v.created_at ASC
       LIMIT ${limit} OFFSET ${offset === 0 ? 0 : offset - 1}
    `);
    let balance = openingValue;
    const lines = rows.rows.map((r) => {
      const amount = Number(r.amount);
      balance += r.deemed ? amount : -amount;
      return {
        id: r.id,
        date: r.date,
        voucherType: r.voucher_type,
        voucherNumber: r.voucher_number,
        partyName: r.party_name,
        debit: r.deemed ? Number(r.amount).toFixed(2) : null,
        credit: r.deemed ? null : Number(r.amount).toFixed(2),
        balance: balance.toFixed(2),
        asOf,
      };
    });
    if (offset === 0) {
      return [
        { id: 'opening', date: f.from ?? '', voucherType: 'Opening balance', voucherNumber: '', partyName: null, debit: null, credit: null, balance: openingValue.toFixed(2), asOf },
        ...lines,
      ];
    }
    return lines;
  }

  private ledgerLines(orgId: string, f: ReportFilters): SQL {
    return sql`l.org_id = ${orgId} AND l.kind = 'ledger' AND l.ledger_name ILIKE ${f.ledgerName ?? ''} AND NOT v.is_cancelled`;
  }

  private salesLines(orgId: string, f: ReportFilters): SQL {
    return sql`l.org_id = ${orgId} AND l.kind = 'inventory' AND v.voucher_type = 'Sales' AND NOT v.is_cancelled ${this.periodClause(f, 'v.voucher_date')}`;
  }

  private partyClause(f: ReportFilters): SQL {
    return f.partyId === undefined ? sql`` : sql`AND v.party_id = ${f.partyId}`;
  }

  private itemClause(f: ReportFilters, column: string): SQL {
    return f.itemName === undefined ? sql`` : sql`AND ${sql.raw(column)} ILIKE ${`%${f.itemName}%`}`;
  }

  private periodClause(f: ReportFilters, column: string): SQL {
    const col = sql.raw(column);
    return sql`${f.from === undefined ? sql`` : sql`AND ${col} >= ${f.from}`} ${f.to === undefined ? sql`` : sql`AND ${col} <= ${f.to}`}`;
  }

  /** REQ-AD-06 / REQ-Y-07: the newest pull the figures rest on. */
  private async asOf(orgId: string): Promise<string | null> {
    const rows = await this.db.execute<{ at: Date | null }>(sql`SELECT max(last_pulled_at) AS at FROM vouchers WHERE org_id = ${orgId}`);
    const at = rows.rows[0]?.at ?? null;
    return at === null ? null : new Date(at).toISOString();
  }

  private async scalar(query: SQL): Promise<number> {
    const rows = await this.db.execute<{ value: number }>(query);
    return Number(rows.rows[0]?.value ?? 0);
  }

  private requireHolder(principal: Principal): void {
    if (!hasPermission(principal, PERMISSIONS.RECEIVABLES_VIEW)) {
      throw AppError.forbidden('This report needs receivables.view.');
    }
  }
}

/** Sortable fields per report, whitelisted into fragments. */
const SORTABLE: Partial<Record<ReportKey, Record<string, string>>> = {
  'stock-summary': { item: '"item"', closingQty: '"closingQty"::numeric', value: '"value"::numeric' },
  'negative-stock': { item: '"item"', closingQty: '"closingQty"::numeric' },
  'stale-projections': { hoursStale: '"hoursStale"' },
  'duplicate-masters': { nameA: '"nameA"' },
  'customer-item-matrix': { partyName: '"partyName"', item: '"item"', value: '"value"::numeric', lastDate: '"lastDate"' },
  'purchase-rhythm': { partyName: '"partyName"', sales12m: '"sales12m"', daysSince: '"daysSince"' },
  'price-variance': { item: '"item"', spreadPct: '"spreadPct"::numeric' },
  'item-velocity': { item: '"item"', monthly12: '"monthly12"::numeric', coverDays: '"coverDays"' },
  'dead-stock': { item: '"item"', lastSaleDate: '"lastSaleDate"', daysIdle: '"daysIdle"', valueLocked: '"valueLocked"::numeric' },
  'movement-analysis': { month: '"month"', item: '"item"' },
  'vendor-item-history': { vendorName: '"vendorName"', item: '"item"', lastDate: '"lastDate"' },
  'vendor-price-comparison': { item: '"item"', spreadPct: '"spreadPct"::numeric' },
  'credit-breaches': { partyName: '"partyName"', exposure: '"exposure"::numeric', overBy: '"overBy"::numeric' },
  'stock-ageing': { item: '"item"', valueLocked: '"valueLocked"::numeric' },
};

const DEFAULT_ORDER: Partial<Record<ReportKey, string>> = {
  'stock-summary': '"value"::numeric DESC NULLS LAST',
  'negative-stock': '"closingQty"::numeric ASC',
  'stale-projections': '"hoursStale" DESC NULLS FIRST',
  'duplicate-masters': '"kind" ASC, "nameA" ASC',
  'customer-item-matrix': '"value"::numeric DESC',
  'purchase-rhythm': '"daysSince" DESC',
  'price-variance': '"spreadPct"::numeric DESC',
  'item-velocity': '"monthly12"::numeric DESC',
  'dead-stock': '"valueLocked"::numeric DESC NULLS LAST',
  'movement-analysis': '"month" DESC, "item" ASC',
  'vendor-item-history': '"lastDate" DESC',
  'vendor-price-comparison': '"spreadPct"::numeric DESC',
  'credit-breaches': '"overBy"::numeric DESC',
  'stock-ageing': '"valueLocked"::numeric DESC NULLS LAST',
};
