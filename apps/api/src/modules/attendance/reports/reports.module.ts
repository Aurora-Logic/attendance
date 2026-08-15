import { Module } from '@nestjs/common';

import { ExportService } from './export.service.js';
import { ReportExportHandler } from './report-export.handler.js';
import { ReportController } from './report.controller.js';
import { ReportService } from './report.service.js';
import { SavedViewService } from './saved-view.service.js';
import { ScheduleSweepHandler } from './schedule-sweep.handler.js';
import { ScheduleService } from './schedule.service.js';

/**
 * Reports and Excel export (REQ-J-01 to REQ-J-06).
 *
 * A sub-module of the attendance module rather than a sibling of it, because
 * technical design 3 keeps every attendance concern behind one boundary. It is
 * its own file so that one slice can be built without touching the file every
 * other slice also needs.
 *
 * Nothing is imported here. `DbModule`, `AuditModule`, `FileModule`,
 * `RbacModule` and `JobsModule` are all `@Global()`, and `ReportExportHandler`
 * puts itself into the global job registry during `onModuleInit` -- so the
 * export job is wired without `JobsModule` ever learning that reports exist.
 */
@Module({
  controllers: [ReportController],
  providers: [
    ReportService,
    ExportService,
    SavedViewService,
    ScheduleService,
    ReportExportHandler,
    ScheduleSweepHandler,
  ],
  exports: [ReportService],
})
export class ReportModule {}
