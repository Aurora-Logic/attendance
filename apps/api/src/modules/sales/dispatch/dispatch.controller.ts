import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  PERMISSIONS,
  createDispatchSchema,
  dispatchListQuerySchema,
  markNotificationSentSchema,
  type DispatchView,
  type Paginated,
} from '@vyuha/shared';
import { z } from 'zod';

import { AppError } from '../../../platform/common/errors.js';
import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { DispatchService } from './dispatch.service.js';

class DispatchListQueryDto extends createZodDto(dispatchListQuerySchema) {}
class MarkNotificationDto extends createZodDto(markNotificationSentSchema) {}

const VIEW = [PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL] as const;
/**
 * The files service refuses anything over 3 MB (technical design §7), so
 * multer stops at the same line: an 8 MB ceiling here only let a large
 * photograph through to be refused later, after the whole body had been
 * read. The client re-encodes gallery photographs to fit before sending.
 */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

interface UploadedPart {
  readonly buffer: Buffer;
}
const uploadedPartSchema = z.object({ buffer: z.instanceof(Buffer) });

function buffersOf(parts: unknown): Buffer[] {
  if (!Array.isArray(parts)) return [];
  return parts.map((part) => uploadedPartSchema.parse(part)).map((part: UploadedPart) => part.buffer);
}

/** Dispatches (12 §3.4): the multipart form carries the JSON as `payload` and the photographs as `box` and `lr` parts. */
@Controller('sales')
export class DispatchController {
  constructor(private readonly dispatches: DispatchService) {}

  @Get('dispatches')
  @RequirePermission(...VIEW)
  list(@CurrentUser() principal: Principal, @Query() query: DispatchListQueryDto): Promise<Paginated<DispatchView>> {
    return this.dispatches.list(principal, query);
  }

  @Get('dispatches/:id')
  @RequirePermission(...VIEW)
  find(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<DispatchView> {
    return this.dispatches.find(principal, id);
  }

  @Get('dispatches/:id/attachments/:fileId/url')
  @RequirePermission(...VIEW)
  attachmentUrl(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.dispatches.attachmentUrl(principal, id, fileId);
  }

  @Post('orders/:id/dispatches')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'box', maxCount: 6 }, { name: 'lr', maxCount: 3 }], { limits: { fileSize: MAX_PHOTO_BYTES, files: 9, fields: 4 } }),
  )
  create(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { payload?: unknown },
    @UploadedFiles() files: { box?: unknown; lr?: unknown } | undefined,
  ): Promise<DispatchView> {
    // The JSON rides as a form field beside the photographs; parsed here for
    // the same reason the punch controller parses its own part.
    let raw: unknown = body.payload;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw AppError.validation('payload must be JSON.', { fields: [{ path: 'payload', message: 'not JSON' }] });
      }
    }
    const input = createDispatchSchema.parse(raw ?? {});
    return this.dispatches.create(principal, id, input, { box: buffersOf(files?.box), lr: buffersOf(files?.lr) });
  }

  @Post('dispatches/:id/notifications/:notificationId')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  markNotification(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @Body() body: MarkNotificationDto,
  ): Promise<DispatchView> {
    return this.dispatches.markNotification(principal, id, notificationId, body.status, body.error ?? null);
  }

  @Post('dispatches/:id/push')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  push(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<DispatchView> {
    return this.dispatches.push(principal, id);
  }
}
