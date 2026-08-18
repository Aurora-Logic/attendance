import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { OPSTALLY_HEADERS, type OpsTallyAck } from '@vyuha/shared';
import type { Request } from 'express';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { Public } from '../rbac/route-policy.js';
import { OpsTallyWebhookService } from './opstally-webhook.service.js';

/**
 * `/api/v1/sync/webhooks/*` — the doors other systems push through.
 *
 * `@Public()` at the guard, because the credential is not a bearer token but
 * an HMAC over the body, and the guard cannot see the body. The service
 * verifies before it does anything else; this handler's only job is to hand
 * it the raw bytes, which is why it reads `req.rawBody` and never `@Body()`
 * — a parsed-and-reserialised body would fail every signature (the
 * reference's "common mistake", spelled out).
 */
@Controller('sync/webhooks')
export class SyncWebhookController {
  constructor(
    private readonly opsTally: OpsTallyWebhookService,
    private readonly auditContext: AuditContext,
  ) {}

  @Post('opstally/:connectionId')
  @Public()
  @HttpCode(HttpStatus.OK)
  async opsTallyDelivery(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers(OPSTALLY_HEADERS.SIGNATURE) signature: string | undefined,
    @Headers(OPSTALLY_HEADERS.EVENT_ID) eventIdHeader: string | undefined,
    @Ip() ip: string | undefined,
  ): Promise<OpsTallyAck> {
    const rawBody = request.rawBody;
    if (rawBody === undefined) {
      // No JSON body parser ran (missing or wrong content-type), so there are
      // no bytes to verify. 400, not 401: the request is malformed, not
      // merely unsigned.
      throw AppError.validation('Expected an application/json body.', {
        fields: [{ path: 'body', message: 'missing' }],
      });
    }
    const ack = await this.opsTally.receive({
      connectionId,
      rawBody,
      signature,
      eventIdHeader,
      ip: ip ?? null,
    });
    // The journal and the inbox are this exchange's trail, richer than an
    // audit row could be; the same suppression the agent's results route uses.
    this.auditContext.suppress();
    return ack;
  }
}
