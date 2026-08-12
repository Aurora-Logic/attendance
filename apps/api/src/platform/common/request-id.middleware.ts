import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { resolveRequestId } from './request-id.js';

/**
 * Guarantees a request id even on paths pino-http does not cover — an excluded
 * route, or a request rejected before the logger middleware. `resolveRequestId`
 * is idempotent, so running in both places costs one property read.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    resolveRequestId(req, res);
    next();
  }
}
