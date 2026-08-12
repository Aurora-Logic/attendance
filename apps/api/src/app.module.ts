import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AuditContextMiddleware } from './platform/audit/audit-context.middleware.js';
import { AuditInterceptor } from './platform/audit/audit.interceptor.js';
import { AuditModule } from './platform/audit/audit.module.js';
import { AuthModule } from './platform/auth/auth.module.js';
import { AppExceptionFilter } from './platform/common/app-exception.filter.js';
import { WILDCARD_ROUTE } from './platform/common/constants.js';
import { pinoParams } from './platform/common/logging.js';
import { RequestIdMiddleware } from './platform/common/request-id.middleware.js';
import { ZodValidationPipe } from './platform/common/zod-validation.pipe.js';
import { DbModule } from './platform/db/db.module.js';
import { HealthModule } from './platform/health/health.module.js';
import { MailModule } from './platform/mail/mail.module.js';
import { AccessGuard } from './platform/rbac/access.guard.js';
import { RbacModule } from './platform/rbac/rbac.module.js';

/**
 * Technical design §1: `platform/` is the shared kernel and `modules/` sits on
 * top of it. Attendance, CRM, and ERP will be imported here and nowhere else.
 *
 * The filter, pipe, guard, and interceptor are registered as providers rather
 * than through `app.useGlobal*`, so they take part in dependency injection --
 * `AccessGuard` needs the database and `AuditInterceptor` needs the audit
 * service, neither of which a manually constructed instance could reach.
 *
 * The four global bindings, and what each one guarantees:
 *
 * - `AccessGuard`    every route is denied unless it declares a policy
 * - `ZodValidationPipe`  every annotated body is parsed before the handler
 * - `AuditInterceptor`   every successful mutation leaves a row (REQ-M-01)
 * - `AppExceptionFilter` every failure leaves as the §6 envelope
 */
@Module({
  imports: [
    LoggerModule.forRoot(pinoParams()),
    DbModule,
    MailModule,
    AuditModule,
    RbacModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order matters: the audit context must be open before anything the
    // request does can try to record into it.
    consumer.apply(RequestIdMiddleware, AuditContextMiddleware).forRoutes(WILDCARD_ROUTE);
  }
}
