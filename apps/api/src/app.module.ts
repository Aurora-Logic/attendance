import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AppExceptionFilter } from './platform/common/app-exception.filter.js';
import { WILDCARD_ROUTE } from './platform/common/constants.js';
import { pinoParams } from './platform/common/logging.js';
import { RequestIdMiddleware } from './platform/common/request-id.middleware.js';
import { ZodValidationPipe } from './platform/common/zod-validation.pipe.js';
import { DbModule } from './platform/db/db.module.js';
import { HealthModule } from './platform/health/health.module.js';

/**
 * Technical design §1: `platform/` is the shared kernel and `modules/` sits on
 * top of it. Attendance, CRM, and ERP will be imported here and nowhere else.
 *
 * The filter and pipe are registered as providers rather than through
 * `app.useGlobalFilters`, so they take part in dependency injection and a
 * later version that needs, say, the audit service can ask for it.
 */
@Module({
  imports: [LoggerModule.forRoot(pinoParams()), DbModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes(WILDCARD_ROUTE);
  }
}
