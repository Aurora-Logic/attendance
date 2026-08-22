import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { PERMISSIONS, type EmployeeAccess } from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { AssignRoleDto, RevokeRoleDto, SetCredentialsDto } from './employee-access.dto.js';
import { EmployeeAccessService } from './employee-access.service.js';

/**
 * REQ-B-07: "Admin can ... assign multiple roles to a user", at
 * `/api/v1/employees/:id/access`.
 *
 * Mounted under the employee rather than under the account, because that is
 * where an administrator is standing when the question comes up -- they have
 * opened a person, not a row in `users`. The account is resolved from the
 * employee inside the service (REQ-B-02's 1:1 link).
 *
 * One key throughout: `roles.manage`. Reading who holds what is not a lesser
 * act than changing it -- the answer is a map of what one named person can do
 * in the organisation, which is the same information `GET /roles` is gated on.
 * It is deliberately *not* `employee.manage`: HR editing a person's department
 * must not be able to make them an administrator.
 */
@Controller('employees/:employeeId/access')
export class EmployeeAccessController {
  constructor(private readonly access: EmployeeAccessService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  read(
    @CurrentUser() principal: Principal,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ): Promise<EmployeeAccess> {
    return this.access.read(principal, employeeId);
  }

  /**
   * Direct credential provisioning and password reset for an employee.
   *
   * Gated on `roles.manage`, not `employee.manage`, for the same reason the
   * role routes are: setting somebody's password is taking over their
   * account, and the body may attach a role. HR editing a department must
   * not be able to sign in as the administrator afterwards.
   */
  @Post('credentials')
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  @HttpCode(HttpStatus.OK)
  setCredentials(
    @CurrentUser() principal: Principal,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: SetCredentialsDto,
  ): Promise<EmployeeAccess> {
    return this.access.setCredentials(principal, employeeId, body);
  }

  /**
   * 200 rather than 201. Assignment is idempotent -- `RbacAdminService` inserts
   * with `ON CONFLICT DO NOTHING` -- so a second press creates nothing, and
   * "created" would be a claim a retry could act on.
   */
  @Post('roles')
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  @HttpCode(HttpStatus.OK)
  assign(
    @CurrentUser() principal: Principal,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: AssignRoleDto,
  ): Promise<EmployeeAccess> {
    return this.access.assign(principal, employeeId, body);
  }

  /**
   * Refuses with `LAST_ROLES_MANAGE_HOLDER` when it would leave the
   * organisation with nobody able to manage roles. That refusal is not written
   * here or anywhere near here: it comes out of the locking transaction inside
   * `RbacAdminService.removeRoleFromUser`, which is the only code that removes
   * a membership row.
   */
  @Delete('roles/:roleId')
  @RequirePermission(PERMISSIONS.ROLES_MANAGE)
  revoke(
    @CurrentUser() principal: Principal,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: RevokeRoleDto,
  ): Promise<EmployeeAccess> {
    return this.access.revoke(principal, employeeId, roleId, body.reason);
  }
}
