import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { UpdateSettingsDto } from './settings.dto.js';
import { SettingsService, type OrgSettingsView, type TestEmailResult } from './settings.service.js';

/**
 * Technical design §6 lists `GET/PUT /settings`. REQ-L-01 to REQ-L-05.
 *
 * The write is PATCH rather than PUT, deliberately. A group left out of the
 * body is left unchanged -- the screen saves one tab at a time and a PUT that
 * ignores absent fields is a misuse of the verb, not a convenience. Every other
 * update endpoint in this codebase is PATCH for the same reason.
 *
 * Read is gated on `settings.manage` rather than on a weaker view permission.
 * There is no separate `settings.view` key in PRD §2.1, and the alternative --
 * letting anyone authenticated read the policy -- would publish the punch
 * window behaviour and the device binding mode to the people those controls
 * exist to constrain.
 */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  read(@CurrentUser() principal: Principal): Promise<OrgSettingsView> {
    return this.settings.read(principal);
  }

  @Patch()
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Body() body: UpdateSettingsDto,
  ): Promise<OrgSettingsView> {
    return this.settings.update(principal, body);
  }

  /**
   * REQ-L-04's test-send. POST rather than GET because it has an effect, and
   * 200 rather than 201 because it creates nothing addressable.
   */
  @Post('email/test')
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(HttpStatus.OK)
  sendTestEmail(@CurrentUser() principal: Principal): Promise<TestEmailResult> {
    return this.settings.sendTestEmail(principal);
  }
}
