import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  PERMISSIONS,
  createIntegrationConnectionSchema,
  type IntegrationConnectionView,
  type IntegrationListResponse,
  type IssuedAgentToken,
} from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { IntegrationService } from './integration.service.js';

class CreateIntegrationConnectionDto extends createZodDto(createIntegrationConnectionSchema) {}

/**
 * `/api/v1/integrations` (technical design §14). PRD §2.1's `integration.manage`.
 *
 * Phase 0 shipped this read-only because a POST would have had to mint an
 * agent credential and nothing existed behind that. Phase 6b built the
 * credential machinery (`AgentAuthService`), so the two writes exist now:
 * create a connection, issue or rotate its token.
 *
 * `integration.manage` throughout, not a weaker key: a connection names the
 * machine that talks to the accounts system, and the token route hands out
 * the credential that machine authenticates with.
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

  /** REQ-Q-03: one connection per Tally company. */
  @Post()
  @RequirePermission(PERMISSIONS.INTEGRATION_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateIntegrationConnectionDto,
  ): Promise<IntegrationConnectionView> {
    return this.integrations.create(principal, body);
  }

  /**
   * The one response that ever carries the token. 200 rather than 201 on
   * purpose: reissuing rotates, and "created" on a rotation would be a claim
   * a retry could act on.
   */
  @Post(':id/token')
  @RequirePermission(PERMISSIONS.INTEGRATION_MANAGE)
  @HttpCode(HttpStatus.OK)
  issueToken(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IssuedAgentToken> {
    return this.integrations.issueToken(principal, id);
  }
}
