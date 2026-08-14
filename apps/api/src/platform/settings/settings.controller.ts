import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ERROR_CODES, PERMISSIONS, type OrgBranding } from '@vyuha/shared';

import { AppError } from '../common/errors.js';
import { Authenticated, RequirePermission } from '../rbac/route-policy.js';
import { CurrentUser, type Principal } from '../rbac/principal.js';
import { UpdateSettingsDto } from './settings.dto.js';
import { SettingsService, type OrgSettingsView, type TestEmailResult } from './settings.service.js';

/** Technical design §7: "Reject uploads over 3MB". Enforced here and in `FileService`. */
const MAX_LOGO_BYTES = 3 * 1024 * 1024;

/**
 * A multer file, reduced to the one field this codebase uses.
 *
 * Read through a runtime check rather than a cast, the same way the punch
 * controller does: `@types/multer` is not a dependency of this workspace, and
 * an upload parsed by third-party middleware is untrusted input even when we
 * wrote both ends.
 */
function uploadedBytes(value: unknown): Buffer | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { buffer?: unknown };
  return Buffer.isBuffer(candidate.buffer) ? candidate.buffer : null;
}

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
   * REQ-L-01's logo and the organisation name, for anybody signed in.
   *
   * The one route on this controller that is not gated on `settings.manage`,
   * and the exception is deliberate: the sidebar renders this on every screen
   * for every employee. Gating it would mean the person who uploaded the logo
   * was the only person who ever saw it, which is the localStorage bug this
   * endpoint exists to fix (OPEN-QUESTIONS P0-7) wearing different clothes.
   * `FILE_READ_RULES` already grants `ORG_LOGO` to any authenticated principal.
   */
  @Get('branding')
  @Authenticated()
  branding(@CurrentUser() principal: Principal): Promise<OrgBranding> {
    return this.settings.branding(principal);
  }

  /**
   * REQ-L-01. Multipart, because it is bytes -- and the interceptor's own limit
   * is a second line after `FileService`'s: multer refuses an oversized upload
   * before it is buffered, which is the only cheap place to stop one.
   *
   * 200 rather than 201: the organisation already existed and its logo is a
   * column on it, so nothing new is addressable afterwards.
   */
  @Post('logo')
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 1 } }),
  )
  uploadLogo(
    @CurrentUser() principal: Principal,
    @UploadedFile() logo: unknown,
  ): Promise<OrgBranding> {
    const bytes = uploadedBytes(logo);
    if (bytes === null) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'No image was uploaded. Send the file as a multipart part named "logo".',
      );
    }
    return this.settings.replaceLogo(principal, bytes);
  }

  @Delete('logo')
  @RequirePermission(PERMISSIONS.SETTINGS_MANAGE)
  removeLogo(@CurrentUser() principal: Principal): Promise<OrgBranding> {
    return this.settings.removeLogo(principal);
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
