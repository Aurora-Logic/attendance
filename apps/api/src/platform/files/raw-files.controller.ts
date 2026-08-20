import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { env } from '../common/env.js';
import { AppError } from '../common/errors.js';
import { Public } from '../rbac/route-policy.js';
import { BUCKETS } from '../storage/object-store.js';

function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.csv':
      return 'text/csv';
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Serves disk-stored files using signed URLs.
 */
@Controller('files')
export class RawFilesController {
  @Get('raw/:bucket/*path')
  @Public()
  serveFile(
    @Param('bucket') bucket: string,
    // Express 5's named wildcard (`*path`) captures the remaining segments as
    // an array, each already URL-decoded -- unlike Express 4's `*`, which gave
    // a single raw string under the numeric key `req.params['0']`.
    @Param('path') pathSegments: string[],
    @Query('expires') expiresStr: string | undefined,
    @Query('signature') signature: string | undefined,
    @Res() res: Response,
  ): void {
    if (bucket !== BUCKETS.PHOTOS && bucket !== BUCKETS.EXPORTS) {
      throw AppError.forbidden('Invalid storage bucket.');
    }

    if (!expiresStr || !signature) {
      throw AppError.forbidden('Missing signature or expiration in file URL.');
    }

    const expires = Number(expiresStr);
    if (Number.isNaN(expires) || expires < Math.floor(Date.now() / 1000)) {
      throw AppError.forbidden('This file link has expired.');
    }

    const key = (pathSegments ?? []).join('/');

    // Verify HMAC signature
    const expectedSig = createHmac('sha256', env.JWT_ACCESS_SECRET)
      .update(`${bucket}:${key}:${expiresStr}`)
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      throw AppError.forbidden('Invalid file signature.');
    }

    const diskBaseDir = path.resolve(process.cwd(), env.STORAGE_DISK_PATH);
    const safeKey = key.replace(/^\/+/u, '');
    const resolvedPath = path.resolve(diskBaseDir, bucket, safeKey);

    if (!resolvedPath.startsWith(diskBaseDir)) {
      throw AppError.forbidden('Invalid path traversal detected.');
    }

    if (!existsSync(resolvedPath)) {
      throw AppError.notFound('File', key);
    }

    const stat = statSync(resolvedPath);
    res.setHeader('Content-Type', mimeForPath(resolvedPath));
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=300');

    const stream = createReadStream(resolvedPath);
    stream.pipe(res);
  }
}
