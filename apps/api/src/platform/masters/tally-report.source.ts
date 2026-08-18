import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  PERMISSIONS,
  TALLY_REPORTS,
  type ReportCellValue,
  type ReportColumnSpec,
  type ReportDefinition,
  type ReportFilters,
  type ReportKey,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import {
  ReportSourceRegistry,
  type ReportSource,
  type ReportSourcePage,
} from '../export/report-source.registry.js';
import { hasPermission, type Principal } from '../rbac/principal.js';

/**
 * The Tally module's reports under the existing report shell (REQ-Y-06:
 * "none of them is a bespoke screen"). First: REQ-S-05's reconciliation —
 * voucher count and total value per voucher type per month, from Vyuha's
 * projection. The other half of the comparison is Tally's own Day Book, read
 * by a person; the acceptance says so, and a push-only source (OpsTally)
 * gives Vyuha no way to ask Tally for its totals itself.
 *
 * Registered like the attendance source: this file puts itself into the
 * registry, and nothing under `platform/export/` learned a new key.
 */

interface ReconciliationRow {
  readonly month: string;
  readonly voucherType: string;
  readonly count: number;
  readonly cancelled: number;
  readonly total: string;
  readonly lastPulledAt: string;
}

interface TallyReportPage extends ReportSourcePage {
  readonly rows: ReconciliationRow[];
}

@Injectable()
export class TallyReportSource implements ReportSource, OnModuleInit {
  readonly keys: readonly ReportKey[] = TALLY_REPORTS.map((report) => report.key);

  constructor(
    private readonly registry: ReportSourceRegistry,
    @InjectDatabase() private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  visibleDefinitions(principal: Principal): readonly ReportDefinition[] {
    return hasPermission(principal, PERMISSIONS.RECEIVABLES_VIEW) ? TALLY_REPORTS : [];
  }

  assertFiltersUsable(key: ReportKey, filters: ReportFilters): ReportFilters {
    if (key !== 'voucher-reconciliation') {
      throw new Error(`TallyReportSource does not serve "${key}".`);
    }
    if (filters.from !== undefined && filters.to !== undefined && filters.from > filters.to) {
      throw AppError.validation('The period ends before it starts.', {
        fields: [{ path: 'to', message: 'must not precede from' }],
      });
    }
    // Only the period is understood; the shell hides the rest, and a
    // hand-written URL carrying an attendance filter is simply ignored.
    return { ...(filters.from === undefined ? {} : { from: filters.from }), ...(filters.to === undefined ? {} : { to: filters.to }) };
  }

  async count(principal: Principal, key: ReportKey, filters: ReportFilters): Promise<number> {
    this.requireHolder(principal);
    this.assertFiltersUsable(key, filters);
    const rows = await this.db.execute<{ value: number }>(sql`
      SELECT count(*)::int AS value FROM (
        SELECT 1 FROM vouchers
         WHERE org_id = ${principal.orgId}
           ${filters.from === undefined ? sql`` : sql`AND voucher_date >= ${filters.from}`}
           ${filters.to === undefined ? sql`` : sql`AND voucher_date <= ${filters.to}`}
         GROUP BY to_char(voucher_date, 'YYYY-MM'), voucher_type
      ) grouped
    `);
    return rows.rows[0]?.value ?? 0;
  }

  async page(
    principal: Principal,
    key: ReportKey,
    filters: ReportFilters & { sort?: string | undefined },
    limit: number,
    offset: number,
  ): Promise<ReportSourcePage> {
    this.requireHolder(principal);
    this.assertFiltersUsable(key, filters);
    // Two sort fields, both known to this file; anything else falls to month.
    const orderBy = filters.sort === 'voucherType'
      ? sql`voucher_type ASC, month ASC`
      : sql`month ASC, voucher_type ASC`;
    const rows = await this.db.execute<{
      month: string;
      voucher_type: string;
      count: number;
      cancelled: number;
      total: string;
      last_pulled_at: Date;
    }>(sql`
      SELECT to_char(voucher_date, 'YYYY-MM') AS month,
             voucher_type,
             count(*)::int AS count,
             count(*) FILTER (WHERE is_cancelled)::int AS cancelled,
             -- Cancelled vouchers do not count towards value: Tally's Day
             -- Book excludes them, and the point is to match it.
             COALESCE(sum(amount) FILTER (WHERE NOT is_cancelled), 0)::text AS total,
             max(last_pulled_at) AS last_pulled_at
        FROM vouchers
       WHERE org_id = ${principal.orgId}
         ${filters.from === undefined ? sql`` : sql`AND voucher_date >= ${filters.from}`}
         ${filters.to === undefined ? sql`` : sql`AND voucher_date <= ${filters.to}`}
       GROUP BY to_char(voucher_date, 'YYYY-MM'), voucher_type
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}
    `);
    const total = await this.count(principal, key, filters);
    const page: TallyReportPage = {
      rows: rows.rows.map((row) => ({
        month: row.month,
        voucherType: row.voucher_type,
        count: Number(row.count),
        cancelled: Number(row.cancelled),
        total: row.total,
        lastPulledAt: new Date(row.last_pulled_at).toISOString(),
      })),
      total,
    };
    return page;
  }

  cells(page: ReportSourcePage, index: number, columns: readonly ReportColumnSpec[]): ReportCellValue[] {
    const row = (page as TallyReportPage).rows[index];
    if (row === undefined) throw new Error(`No row ${String(index)} on this page.`);
    return columns.map((column): ReportCellValue => {
      switch (column.key) {
        case 'month': return row.month;
        case 'voucherType': return row.voucherType;
        case 'count': return row.count;
        case 'cancelled': return row.cancelled;
        case 'total': return row.total;
        case 'lastPulledAt': return row.lastPulledAt;
        default: return null;
      }
    });
  }

  private requireHolder(principal: Principal): void {
    if (!hasPermission(principal, PERMISSIONS.RECEIVABLES_VIEW)) {
      throw AppError.forbidden('This report needs receivables.view.');
    }
  }
}
