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
import { PERMISSIONS, type DesignationSummary, type Paginated } from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { DesignationService } from './designation.service.js';
import { CreateDesignationDto, MasterListQueryDto, UpdateDesignationDto } from './org.dto.js';

/** REQ-A-02 at `/api/v1/designations`. Same keys as departments, same reasoning. */
@Controller('designations')
export class DesignationController {
  constructor(private readonly designations: DesignationService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: MasterListQueryDto,
  ): Promise<Paginated<DesignationSummary>> {
    return this.designations.list(principal, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateDesignationDto,
  ): Promise<DesignationSummary> {
    return this.designations.create(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDesignationDto,
  ): Promise<DesignationSummary> {
    return this.designations.update(principal, id, body);
  }
}
