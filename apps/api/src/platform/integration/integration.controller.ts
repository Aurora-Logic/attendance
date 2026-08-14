import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS, type IntegrationListResponse } from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { IntegrationService } from './integration.service.js';

/**
 * `/api/v1/integrations` (technical design §14). PRD §2.1's `integration.manage`.
 *
 * Read-only, and the absence of everything else is the design. Phase 0's scope
 * is "the tables and the interface exist so Phase 6 is additive"; a POST that
 * created a connection would have to mint an agent token, and there is nothing
 * behind that yet. The screen says so rather than offering a button that fails.
 *
 * `integration.manage` to read, not a weaker key: a connection names the
 * machine that talks to the accounts system and whether a credential has been
 * issued for it, which is not a list to hand to anyone who asks.
 */
@Controller('integrations')
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  @Get()
  @RequirePermission(PERMISSIONS.INTEGRATION_MANAGE)
  list(@CurrentUser() principal: Principal): Promise<IntegrationListResponse> {
    // Not `Paginated`: an organisation has one Tally connection, or a handful
    // if it runs several offices. A page envelope on a list nobody will page is
    // a client handling a case that cannot happen.
    return this.integrations.list(principal);
  }
}
