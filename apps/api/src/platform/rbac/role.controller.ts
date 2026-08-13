import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PERMISSIONS, type RoleSummary } from '@vyuha/shared';

import { CurrentUser, type Principal } from './principal.js';
import { RequirePermission } from './route-policy.js';
import { CreateRoleDto, UpdateRoleDto } from './role.dto.js';
import { RoleService } from './role.service.js';

/**
 * `/api/v1/roles` (technical design §6, REQ-B-07). PRD §5 screen 17.
 *
 * One key throughout: `roles.manage`. Reading the definitions is not a lesser
 * act than writing them — the list is a map of who can do what in the
 * organisation, which is not something to hand to anyone who asks. What an
 * account holds *itself* comes from `/auth/me` and needs no permission, so the
 * Permissions tab on the screen works for everybody.
 *
 * Delete and restore are not here. They are `DELETE /masters/role/:id` and
 * `POST /masters/role/:id/restore`, so that every soft delete in the product
 * enforces its reason, its refusal and its audit entry in one place.
 */
@Controller('roles')
export class RoleController {
  constructor(private readonly roles: RoleService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  async list(@CurrentUser() principal: Principal): Promise<{ data: RoleSummary[] }> {
    // Not `Paginated`: four to a dozen roles is the whole population, and a
    // page envelope on a list nobody will ever page is a client that has to
    // handle a case that cannot happen.
    return { data: await this.roles.list(principal) };
  }

  @Post()
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateRoleDto,
  ): Promise<RoleSummary> {
    return this.roles.create(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRoleDto,
  ): Promise<RoleSummary> {
    return this.roles.update(principal, id, body);
  }
}
