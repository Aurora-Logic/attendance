import { Global, Module } from '@nestjs/common';

import { AuditContext } from './audit-context.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';

/**
 * Global: every module that will ever mutate anything needs `AuditContext`,
 * and a second instance would mean a second AsyncLocalStorage that the
 * interceptor never reads -- a failure whose only symptom is audit rows
 * quietly losing their detail.
 */
@Global()
@Module({
  providers: [AuditContext, AuditService, AuditInterceptor],
  exports: [AuditContext, AuditService, AuditInterceptor],
})
export class AuditModule {}
