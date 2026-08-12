import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { AuditContext } from './audit-context.js';

/**
 * Opens the audit context for the request.
 *
 * Express calls `next()` synchronously from inside this function, so the
 * entire downstream chain -- guards, pipes, the handler, and the interceptor's
 * completion callbacks -- runs inside the AsyncLocalStorage scope. Establishing
 * it any later would leave the handler outside it; see the note on
 * `AuditContext.run`.
 */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  constructor(private readonly context: AuditContext) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.context.run(() => {
      next();
    });
  }
}
