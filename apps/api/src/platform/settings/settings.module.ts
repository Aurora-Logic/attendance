import { Module } from '@nestjs/common';

import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';
import { WorkspacePolicyReader } from './workspace-policy.reader.js';

/**
 * Organisation settings (REQ-L-01 to REQ-L-05).
 *
 * Platform rather than attendance: the `settings` table, the `organizations`
 * row and the audit of a change are all platform concerns, and CRM and ERP will
 * add their own rows to the same table. The `attendance.*` key prefix names the
 * module that consumes a row, not the module that owns the mechanism -- see the
 * note at the top of `settings.catalogue.ts`.
 *
 * `AuditContext` and `Mailer` both come from global modules, so nothing is
 * imported here.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, WorkspacePolicyReader],
  exports: [SettingsService, WorkspacePolicyReader],
})
export class SettingsModule {}
