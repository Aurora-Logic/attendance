import { Module } from '@nestjs/common';

import { AttendanceReportSource } from './attendance-report.source.js';
import { ReportService } from './report.service.js';

/**
 * Attendance's report content (REQ-J-01).
 *
 * The framework that pages, exports and schedules these rows lives in
 * `platform/export` (REQ-P-02); what remains here is what a report *is* — the
 * queries, the scopes, the cell extraction — handed over through
 * `AttendanceReportSource` during `onModuleInit`, so `ExportModule` never
 * grows an import for this module.
 */
@Module({
  providers: [ReportService, AttendanceReportSource],
  exports: [ReportService],
})
export class ReportModule {}
