import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ALL_REPORTS,
  type ReportCellValue,
  type ReportColumnSpec,
  type ReportDefinition,
  type ReportFilters,
  type ReportKey,
} from '@vyuha/shared';

import {
  ReportSourceRegistry,
  type ReportSource,
  type ReportSourcePage,
} from '../../../platform/export/report-source.registry.js';
import type { Principal } from '../../../platform/rbac/principal.js';
import { ReportService, cellsFor, type ReportPage } from './report.service.js';

/**
 * Attendance's reports, handed to the export framework (REQ-P-02).
 *
 * Registered the way every cross-module attachment is — it puts itself into
 * the registry during `onModuleInit`, and `platform/export/` never imports
 * this file. The framework pages, writes and schedules; what a row *is* stays
 * here, next to the queries that produce it.
 *
 * `keys` claims every definition in the shared catalogue, which is correct
 * exactly as long as every report in the product is an attendance report.
 * The Phase 6d receivables reports change that: their definitions join
 * `@vyuha/shared` grouped by owner, this claims only the attendance group,
 * and the registry's duplicate refusal is what turns an overlap into a boot
 * failure instead of a coin toss.
 */
@Injectable()
export class AttendanceReportSource implements ReportSource, OnModuleInit {
  readonly keys: readonly ReportKey[] = ALL_REPORTS.map((report) => report.key);

  constructor(
    private readonly registry: ReportSourceRegistry,
    private readonly reports: ReportService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  visibleDefinitions(principal: Principal): readonly ReportDefinition[] {
    return this.reports.catalogue(principal);
  }

  assertFiltersUsable(key: ReportKey, filters: ReportFilters): ReportFilters {
    return ReportService.assertFiltersUsable(key, filters);
  }

  count(principal: Principal, key: ReportKey, filters: ReportFilters): Promise<number> {
    return this.reports.count(principal, key, filters);
  }

  page(
    principal: Principal,
    key: ReportKey,
    filters: ReportFilters & { sort?: string | undefined },
    limit: number,
    offset: number,
  ): Promise<ReportSourcePage> {
    return this.reports.page(principal, key, filters, limit, offset);
  }

  cells(
    page: ReportSourcePage,
    index: number,
    columns: readonly ReportColumnSpec[],
  ): ReportCellValue[] {
    // The framework only ever hands back a page this source produced — the
    // registry routes by key and `page` above returns a `ReportPage` — so the
    // narrowing is the contract, not a guess. `cellsFor` then switches on the
    // page's own `kind` discriminant.
    return cellsFor(page as ReportPage, index, columns);
  }
}
