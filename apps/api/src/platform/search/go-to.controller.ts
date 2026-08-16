import { Controller, Get, Query } from '@nestjs/common';
import type { GoToResponse } from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { Authenticated } from '../rbac/route-policy.js';
import { GoToQueryDto } from './go-to.dto.js';
import { GoToService } from './go-to.service.js';

/**
 * `GET /go-to?q=` (REQ-O-05). What the Alt+G palette asks while the user types.
 *
 * `@Authenticated()` rather than a permission key, deliberately: there is no
 * key that means "may search", and inventing one would either be granted to
 * everybody (a check that checks nothing) or become a second copy of the
 * per-source keys. Every record source declares its own permission and
 * `GoToService` filters on those before it queries anything, so a caller with
 * no keys gets a well-formed empty answer — the same thing the sidebar shows
 * them.
 */
@Controller('go-to')
export class GoToController {
  constructor(private readonly goTo: GoToService) {}

  @Get()
  @Authenticated()
  search(@CurrentUser() principal: Principal, @Query() query: GoToQueryDto): Promise<GoToResponse> {
    return this.goTo.search(principal, query.q);
  }
}
