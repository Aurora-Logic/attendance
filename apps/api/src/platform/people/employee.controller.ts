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
  Query,
} from '@nestjs/common';
import {
  PERMISSIONS,
  type EmployeeDetail,
  type EmployeeListItem,
  type Paginated,
} from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import {
  CreateEmployeeDto,
  EmployeeListQueryDto,
  UpdateEmployeeDto,
} from './employee.dto.js';
import { EmployeeService } from './employee.service.js';

/**
 * REQ-A-03 … REQ-A-07, at `/api/v1/employees` (technical design §6).
 *
 * CLAUDE.md §6: "Controllers validate and delegate." Validation is the DTO on
 * each parameter; everything else is one call into `EmployeeService`.
 *
 * The permission keys are PRD §2.1's: `employee.view` to read, `employee.manage`
 * to write. How *much* a reader may see is not decided here -- `ScopeService`
 * resolves that into a predicate inside the service, so an Operations user with
 * team breadth gets a shorter list from the same handler.
 *
 * There is no DELETE route. Technical design §6 lists none, REQ-M-04 forbids a
 * hard delete, and REQ-A-05 already provides the way to retire someone: set the
 * status to INACTIVE with a last working date, which keeps the history that
 * past reports depend on.
 */
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: EmployeeListQueryDto,
  ): Promise<Paginated<EmployeeListItem>> {
    return this.employees.list(principal, query);
  }

  /**
   * `ParseUUIDPipe` rather than letting the id reach Postgres: an unparseable
   * uuid literal surfaces as a 500 from inside the driver, which reads as a
   * server fault for what is a malformed request.
   */
  @Get(':id')
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeDetail> {
    return this.employees.findOne(principal, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateEmployeeDto,
  ): Promise<EmployeeDetail> {
    return this.employees.create(principal, body);
  }

  /** REQ-A-05 lifecycle changes come through here too: status plus a last working date. */
  @Patch(':id')
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateEmployeeDto,
  ): Promise<EmployeeDetail> {
    return this.employees.update(principal, id, body);
  }
}
