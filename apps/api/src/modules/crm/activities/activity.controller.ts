import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { PERMISSIONS, activityListQuerySchema, logActivitySchema, type ActivityPage, type ActivityView } from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { ActivityService } from './activity.service.js';

class LogActivityDto extends createZodDto(logActivitySchema) {}
class ActivityListQueryDto extends createZodDto(activityListQuerySchema) {}

/**
 * `/api/v1/crm/activities` (REQ-U-07). The guard admits anyone in either
 * family; the service checks the record is one the caller can open and,
 * for a write, that they hold its manage key.
 */
@Controller('crm/activities')
export class ActivityController {
  constructor(private readonly activities: ActivityService) {}

  @Get()
  @RequirePermission(
    PERMISSIONS.CRM_CONTACT_VIEW_SELF,
    PERMISSIONS.CRM_CONTACT_VIEW_ALL,
    PERMISSIONS.CRM_DEAL_VIEW_SELF,
    PERMISSIONS.CRM_DEAL_VIEW_ALL,
  )
  list(@CurrentUser() principal: Principal, @Query() query: ActivityListQueryDto): Promise<ActivityPage> {
    return this.activities.list(principal, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE, PERMISSIONS.CRM_DEAL_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  log(@CurrentUser() principal: Principal, @Body() body: LogActivityDto): Promise<ActivityView> {
    return this.activities.log(principal, body);
  }
}
