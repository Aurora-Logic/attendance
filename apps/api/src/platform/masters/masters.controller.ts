import {
  Controller,
  Get,
  MethodNotAllowedException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PERMISSIONS, partyListQuerySchema, type Paginated, type PartyView } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { MastersService } from './masters.service.js';

class PartyListQueryDto extends createZodDto(partyListQuerySchema) {}

/**
 * `/api/v1/masters/*` (09 §5): the Tally masters projection, read-only —
 * "no POST, PATCH or DELETE, by design".
 *
 * The write methods below exist to say so. Left unrouted they would answer
 * 404, which reads as a wrong address and invites a client author to try a
 * different path; 405 states the actual rule (REQ-R-04, permanent): a new
 * customer is created in Tally, where the accountant works, and appears here
 * on the next pull. The 6b exit criteria assert this verbatim.
 */
@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get('parties')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  listParties(
    @CurrentUser() principal: Principal,
    @Query() query: PartyListQueryDto,
  ): Promise<Paginated<PartyView>> {
    return this.masters.listParties(principal, query);
  }

  @Get('parties/:id')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  findParty(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PartyView> {
    return this.masters.findParty(principal, id);
  }

  @Post('parties')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  refuseCreate(): never {
    throw new MethodNotAllowedException(
      'Masters are read-only in Vyuha (REQ-R-04). A new party is created in Tally and appears here on the next pull.',
    );
  }

  @Patch('parties/:id')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  refuseEdit(): never {
    throw new MethodNotAllowedException(
      'Masters are read-only in Vyuha (REQ-R-04). Edit the party in Tally; the change arrives on the next pull.',
    );
  }
}

/*
 * There is deliberately no DELETE handler. `DELETE /masters/:entityType/:id`
 * belongs to the recycle bin's soft-delete surface, which registers first and
 * already refuses "parties" by name — it is not in SOFT_DELETABLE_ENTITIES
 * and never will be, because a party removed in Tally is marked absent here
 * and retained (REQ-R-06). A second handler on the same path would be dead
 * code that a route-order change could silently bring to life.
 */
