import { Global, Module } from '@nestjs/common';

import { AuditContext } from './audit-context.js';
import { AuditLogService } from './audit-log.service.js';
import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';

/**
 * Global: every module that will ever mutate anything needs `AuditContext`,
 * and a second instance would mean a second AsyncLocalStorage that the
 * interceptor never reads -- a failure whose only symptom is audit rows
 * quietly losing their detail.
 *
 * `AuditLogService` is the read side (REQ-M-02) and is deliberately not
 * exported: nothing outside this module should be querying the trail, and the
 * one place that displays it goes through `AuditController`.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditContext, AuditService, AuditInterceptor, AuditLogService],
  exports: [AuditContext, AuditService, AuditInterceptor],
})
export class AuditModule {}
