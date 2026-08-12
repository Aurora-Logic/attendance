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
import { PERMISSIONS, type DepartmentSummary, type Paginated } from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { DepartmentService } from './department.service.js';
import { CreateDepartmentDto, MasterListQueryDto, UpdateDepartmentDto } from './org.dto.js';

/**
 * REQ-A-02 at `/api/v1/departments`.
 *
 * PRD §2.1 names no key for this master, so the choice is recorded in
 * docs/OPEN-QUESTIONS P1-1: `employee.view` to read, because the employee
 * screen's filters are built from this list, and `employee.manage` to write,
 * because it is people master data that HR owns.
 */
@Controller('departments')
export class DepartmentController {
  constructor(private readonly departments: DepartmentService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: MasterListQueryDto,
  ): Promise<Paginated<DepartmentSummary>> {
    return this.departments.list(principal, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateDepartmentDto,
  ): Promise<DepartmentSummary> {
    return this.departments.create(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDepartmentDto,
  ): Promise<DepartmentSummary> {
    return this.departments.update(principal, id, body);
  }
}
