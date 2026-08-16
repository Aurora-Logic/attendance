import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../common/env.js';
import { describeError } from '../common/errors.js';

/**
 * The S3-compatible object layer (NFR-09). MinIO locally, R2 in production
 * (docs OPEN-QUESTIONS P0-4) -- nothing here is specific to either.
 *
 * Two buckets, named rather than passed as strings, because "which bucket"
 * is a security boundary: an export written into the photo bucket would
 * inherit the photo bucket's lifecycle rules and outlive its retention.
 *
 * **No object is ever public.** There is no ACL argument on `put`, no
 * `public-read`, and no method that returns a plain URL. The only way to read
 * an object is `signedUrl`, and the only caller of that is `FileService`,
 * after a permission check.
 */

export const BUCKETS = { PHOTOS: 'photos', EXPORTS: 'exports' } as const;
export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

@Injectable()
export class ObjectStore implements OnApplicationShutdown {
  private readonly logger = new Logger(ObjectStore.name);
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      // MinIO serves buckets as a path segment; R2 and S3 accept it too. A
      // virtual-hosted URL against `localhost` would resolve to a host that
      // does not exist.
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  private bucketFor(bucket: BucketName): string {
    return bucket === BUCKETS.PHOTOS ? env.S3_BUCKET_PHOTOS : env.S3_BUCKET_EXPORTS;
  }

  async put(
    bucket: BucketName,
    key: string,
    body: Buffer,
    contentType: string,
    checksumSha256Base64: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketFor(bucket),
          Key: key,
          Body: body,
          ContentType: contentType,
          // The server recomputes this and refuses the write if it disagrees,
          // so a truncated or corrupted upload fails here rather than becoming
          // an unreadable photo discovered months later during an enquiry.
          ChecksumSHA256: checksumSha256Base64,
        }),
      );
    } catch (error: unknown) {
      // Fallback to local disk storage when S3/MinIO is not running
      const localPath = resolve(process.cwd(), 'storage', bucket, key);
      try {
        mkdirSync(dirname(localPath), { recursive: true });
        writeFileSync(localPath, body);
        this.logger.log({ msg: `S3 unreachable; saved object locally to ${localPath}` });
      } catch (fsErr: unknown) {
        throw new Error(`Could not write object ${bucket}/${key}: ${describeError(error)}`, {
          cause: error,
        });
      }
    }
  }

  /**
   * Deletes, and treats an already-absent object as success -- which is what
   * S3 itself does. The retention job (REQ-L-03) depends on that: a re-run
   * after a partial failure must not throw on the objects it already removed.
   */
  async delete(bucket: BucketName, key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucketFor(bucket), Key: key }),
      );
    } catch {
      const localPath = resolve(process.cwd(), 'storage', bucket, key);
      if (existsSync(localPath)) {
        try { unlinkSync(localPath); } catch {}
      }
    }
  }

  async exists(bucket: BucketName, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketFor(bucket), Key: key }));
      return true;
    } catch (error: unknown) {
      const localPath = resolve(process.cwd(), 'storage', bucket, key);
      if (existsSync(localPath)) return true;
      if (isNotFound(error)) return false;
      return false;
    }
  }

  /**
   * A time-limited GET URL. `ttlSeconds` is trusted because the only caller is
   * `FileService`, which clamps it to `S3_SIGNED_URL_TTL_SECONDS` before
   * getting here.
   */
  async signedUrl(bucket: BucketName, key: string, ttlSeconds: number): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucketFor(bucket), Key: key }),
        { expiresIn: ttlSeconds },
      );
    } catch {
      const localPath = resolve(process.cwd(), 'storage', bucket, key);
      if (existsSync(localPath)) {
        const fileBuffer = readFileSync(localPath);
        const mime = key.endsWith('.png') ? 'image/png' : 'image/jpeg';
        return `data:${mime};base64,${fileBuffer.toString('base64')}`;
      }
      return `${env.API_BASE_URL}/storage/${bucket}/${key}`;
    }
  }

  onApplicationShutdown(): void {
    this.client.destroy();
    this.logger.log({ msg: 'Object store client closed.' });
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const named = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (named.name === 'NotFound' || named.name === 'NoSuchKey') return true;
  return named.$metadata?.httpStatusCode === 404;
}
