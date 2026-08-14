import { Module } from '@nestjs/common';

import { ConsentController } from './consent.controller.js';
import { ConsentService } from './consent.service.js';

/**
 * Consent-notice acceptance (REQ-M-03).
 *
 * Platform rather than attendance, for the reason the settings module gives:
 * the table and the mechanism are generic -- "this user accepted this named
 * notice" -- and the attendance module is merely the first consumer, through
 * the 'attendance.punch_capture' key. CRM and ERP notices would be new keys in
 * the shared catalogue, not new tables.
 *
 * `ConsentService` is exported because the punch context (REQ-D-13) reports
 * whether the notice still gates -- a modules-to-platform import, which is the
 * direction the boundary allows.
 */
@Module({
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
