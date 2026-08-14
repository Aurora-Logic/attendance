import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { ConsentAcceptance } from '@vyuha/shared';
import type { Response } from 'express';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { Authenticated } from '../rbac/route-policy.js';
import { ConsentAcceptanceDto } from './consent.dto.js';
import { ConsentService } from './consent.service.js';

/**
 * `POST /me/consent` (REQ-M-03).
 *
 * Under `/me` because acceptance only ever acts on the caller's own account,
 * which is also why the policy is `Authenticated` rather than a permission
 * key: an account with no roles at all is still the account whose consent is
 * being asked for.
 *
 * 201 for a new acceptance, 200 for a replay -- the punch endpoint's
 * convention, and for the same reason: saying "created" a second time would
 * be a lie a retry loop could act on.
 */
@Controller('me')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post('consent')
  @Authenticated()
  async accept(
    @CurrentUser() principal: Principal,
    @Body() body: ConsentAcceptanceDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ConsentAcceptance> {
    const acceptance = await this.consent.record(principal, body.consentKey);
    response.status(acceptance.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return acceptance;
  }
}
