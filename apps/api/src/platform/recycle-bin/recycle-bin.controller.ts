import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  softDeletableEntitySchema,
  type Paginated,
  type RecycleBinEntry,
  type SoftDeletableEntity,
} from '@vyuha/shared';

import { AppError } from '../common/errors.js';
import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { RecycleBinQueryDto, ReasonBodyDto } from './recycle-bin.dto.js';
import { RecycleBinService } from './recycle-bin.service.js';
import { MASTER_MANAGE_KEYS } from './soft-deletable.js';

/**
 * REQ-B-09a and REQ-M-04: soft delete, restore, and the recycle bin.
 *
 * One generic pair of routes rather than a `DELETE` on each of six resource
 * controllers. Technical design §6 lists no `DELETE` for any master — P1-2
 * records that none exists — so there is no resource-oriented contract to
 * break, and the trade is worth naming: `DELETE /masters/departments/:id` reads
 * a little less REST than `DELETE /departments/:id`, and in exchange the reason
 * requirement, the in-use refusal, the audit shape and the permission check
 * exist exactly once. Six copies of a destructive rule is six chances for one
 * of them to be the copy that forgot.
 *
 * `DELETE` carries a body, which §6 already commits to for
 * `DELETE /attendance/locks/:id { reason }`.
 */
@Controller()
export class RecycleBinController {
  constructor(private readonly recycleBin: RecycleBinService) {}

  @Get('recycle-bin')
  @RequirePermission(...MASTER_MANAGE_KEYS)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: RecycleBinQueryDto,
  ): Promise<Paginated<RecycleBinEntry>> {
    return this.recycleBin.list(principal, query);
  }

  @Delete('masters/:entityType/:id')
  @RequirePermission(...MASTER_MANAGE_KEYS)
  remove(
    @CurrentUser() principal: Principal,
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReasonBodyDto,
  ): Promise<{ entityType: SoftDeletableEntity; id: string; name: string; deleted: boolean }> {
    return this.recycleBin.softDelete(principal, requireEntityType(entityType), id, body.reason);
  }

  @Post('masters/:entityType/:id/restore')
  @RequirePermission(...MASTER_MANAGE_KEYS)
  restore(
    @CurrentUser() principal: Principal,
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReasonBodyDto,
  ): Promise<{ entityType: SoftDeletableEntity; id: string; name: string; deleted: boolean }> {
    return this.recycleBin.restore(principal, requireEntityType(entityType), id, body.reason);
  }
}

/**
 * Parsed here rather than left to the service, so an unknown type is a 400
 * naming the allowed values instead of a 404 that reads as "no such record".
 */
function requireEntityType(raw: string): SoftDeletableEntity {
  const parsed = softDeletableEntitySchema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.validation('That is not a master that supports delete and restore.', {
      fields: [{ path: 'entityType', message: 'unknown master', value: raw }],
      allowed: softDeletableEntitySchema.options,
    });
  }
  return parsed.data;
}
