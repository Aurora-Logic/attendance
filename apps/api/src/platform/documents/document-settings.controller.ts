import { Body, Controller, Get, Put } from '@nestjs/common';
import { PERMISSIONS, documentSettingsSchema, type DocumentSettings } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../rbac/principal.js';
import { Authenticated, RequirePermission } from '../rbac/route-policy.js';
import { DocumentSettingsService } from './document-settings.service.js';

class DocumentSettingsDto extends createZodDto(documentSettingsSchema) {}

/**
 * The printed documents' identity and designs. Read by anyone signed in —
 * every document screen renders the paper — written under settings.manage,
 * since what the business calls itself on an invoice is the administrator's.
 */
@Controller('documents')
export class DocumentSettingsController {
  constructor(private readonly settings: DocumentSettingsService) {}

  @Get('settings')
  @Authenticated()
  read(@CurrentUser() principal: Principal): Promise<DocumentSettings> {
    return this.settings.read(principal.orgId);
  }

  @Put('settings')
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  write(@CurrentUser() principal: Principal, @Body() body: DocumentSettingsDto): Promise<DocumentSettings> {
    return this.settings.write(principal.orgId, principal.userId, body);
  }
}
