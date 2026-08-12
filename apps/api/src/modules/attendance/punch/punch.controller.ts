import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  MAX_OFFLINE_SYNC_BATCH,
  PERMISSIONS,
  type CursorPaginated,
  type PunchContext,
  type PunchReceipt,
  type PunchRecord,
  type PunchSyncReport,
  type SignedPhotoUrl,
} from '@vyuha/shared';
import type { Request, Response } from 'express';

import { AppError } from '../../../platform/common/errors.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import {
  PunchFeedQueryDto,
  PunchFormDto,
  PunchPhotoQueryDto,
  PunchSyncFormDto,
  idempotencyHeaderSchema,
} from './punch.dto.js';
import { PunchService, type RequestMeta, type UploadedPhoto } from './punch.service.js';

/**
 * `/api/v1/punches` (technical design §6). REQ-D-01 … REQ-D-13.
 *
 * CLAUDE.md §6: "Controllers validate and delegate." Everything here reads a
 * request and hands it to `PunchService`; no branch in this file decides
 * whether a punch is acceptable. The one thing the controller owns is HTTP
 * itself -- the multipart parts, the idempotency header, and the difference
 * between 201 for a new punch and 200 for a replay.
 */

/** Technical design §7: "Reject uploads over 3MB". Enforced twice, see below. */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/**
 * A multer file, reduced to what this codebase uses.
 *
 * Declared here rather than imported: `@types/multer` is not a dependency of
 * this workspace, so `Express.Multer.File` does not exist as a type. Reading
 * the two fields we need through a runtime check is the more honest shape
 * anyway -- CLAUDE.md treats anything crossing a boundary as untrusted input,
 * and an upload parsed by a third-party middleware is exactly that.
 */
function toUploadedPhoto(value: unknown): UploadedPhoto | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { buffer?: unknown; fieldname?: unknown };
  if (!Buffer.isBuffer(candidate.buffer)) return null;
  return {
    bytes: candidate.buffer,
    fieldName: typeof candidate.fieldname === 'string' ? candidate.fieldname : 'photo',
  };
}

function toUploadedPhotos(value: unknown): UploadedPhoto[] {
  if (!Array.isArray(value)) return [];
  const photos: UploadedPhoto[] = [];
  for (const item of value) {
    const photo = toUploadedPhoto(item);
    if (photo !== null) photos.push(photo);
  }
  return photos;
}

/**
 * REQ-D-11 arrives in a header, which no DTO covers, so it is parsed with the
 * same schema the sync body applies to its per-entry keys.
 */
function requireIdempotencyKey(raw: string | undefined): string {
  const parsed = idempotencyHeaderSchema.safeParse(raw ?? '');
  if (!parsed.success) {
    throw AppError.validation(
      'An Idempotency-Key header is required on a punch, so a retry cannot create a second one.',
      { fields: [{ path: 'Idempotency-Key', message: parsed.error.issues[0]?.message ?? 'invalid' }] },
    );
  }
  return parsed.data;
}

function metaOf(request: Request): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    // Attacker-controlled text destined for a screen: bounded here, escaped at
    // render, exactly as the session list does with the same header.
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}

@Controller('punches')
export class PunchController {
  constructor(private readonly punches: PunchService) {}

  /**
   * REQ-D-02's photo is a multipart part, not a field in the JSON. There is no
   * request shape that omits it and succeeds, and the interceptor's own limit
   * is a second line after `FileService`'s -- multer refuses the bytes before
   * they are buffered, which is the only place a 50 MB upload can be stopped
   * cheaply.
   */
  @Post()
  @RequirePermission(PERMISSIONS.PUNCH_SELF)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 4 } }),
  )
  async create(
    @CurrentUser() principal: Principal,
    @UploadedFile() photo: unknown,
    @Body() body: PunchFormDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PunchReceipt> {
    const receipt = await this.punches.punch(
      principal,
      body.payload,
      toUploadedPhoto(photo),
      requireIdempotencyKey(idempotencyKey),
      metaOf(request),
    );

    // 200 rather than 201 for a replay. The client asked twice and got the
    // same punch; saying "created" a second time would be a lie a retry loop
    // could act on.
    response.status(receipt.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return receipt;
  }

  /**
   * REQ-D-10, the offline queue drain. Always 200: the body reports per-entry
   * outcomes, because a batch where the third entry is too old is not a failed
   * request, it is four accepted punches and one that needs regularization.
   */
  @Post('sync')
  @RequirePermission(PERMISSIONS.PUNCH_SELF)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('photos', MAX_OFFLINE_SYNC_BATCH, {
      limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_OFFLINE_SYNC_BATCH, fields: 4 },
    }),
  )
  sync(
    @CurrentUser() principal: Principal,
    @UploadedFiles() photos: unknown,
    @Body() body: PunchSyncFormDto,
    @Req() request: Request,
  ): Promise<PunchSyncReport> {
    return this.punches.sync(
      principal,
      body.payload.punches,
      toUploadedPhotos(photos),
      metaOf(request),
    );
  }

  /**
   * The punch audit feed. Every row carries a thumbnail id and never a full
   * image id to render from -- REQ-D-03a calls fetching full images in a list
   * a review failure, and the shape of `PunchRecord.photo` is what makes the
   * cheap path the obvious one.
   */
  @Get()
  @RequirePermission(
    PERMISSIONS.ATTENDANCE_VIEW_SELF,
    PERMISSIONS.ATTENDANCE_VIEW_TEAM,
    PERMISSIONS.ATTENDANCE_VIEW_ALL,
  )
  feed(
    @CurrentUser() principal: Principal,
    @Query() query: PunchFeedQueryDto,
  ): Promise<CursorPaginated<PunchRecord>> {
    return this.punches.feed(principal, query);
  }

  /** NFR-09: a five-minute signed URL, issued after a scope check on the punch. */
  @Get(':id/photo')
  @RequirePermission(
    PERMISSIONS.ATTENDANCE_VIEW_SELF,
    PERMISSIONS.ATTENDANCE_VIEW_TEAM,
    PERMISSIONS.ATTENDANCE_VIEW_ALL,
  )
  photo(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PunchPhotoQueryDto,
  ): Promise<SignedPhotoUrl> {
    return this.punches.photoUrl(principal, id, query.variant);
  }
}

/**
 * REQ-D-13's "before punching" payload, at `/api/v1/me/today`.
 *
 * Technical design §6 reserves `GET /me` for "profile, permissions, today's
 * shift and status". The profile half is served by `/auth/me` today
 * (OPEN-QUESTIONS P0-12); this is the attendance half, and it lives in the
 * attendance module because everything in it -- shift, window, last punch --
 * is attendance data.
 */
@Controller('me')
export class PunchContextController {
  constructor(private readonly punches: PunchService) {}

  @Get('today')
  @RequirePermission(PERMISSIONS.PUNCH_SELF)
  today(@CurrentUser() principal: Principal, @Req() request: Request): Promise<PunchContext> {
    return this.punches.context(principal, metaOf(request));
  }
}
