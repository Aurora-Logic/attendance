import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, isUuid, uuidv7, type FilePurpose } from '@vyuha/shared';
import { and, asc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { AuditService } from '../audit/audit.service.js';
import { env } from '../common/env.js';
import { AppError, describeError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { files } from '../db/schema/index.js';
import { ScopedRepository } from '../db/scoped-repository.js';
import type { Principal } from '../rbac/principal.js';
import { orgContextOf } from '../rbac/principal.js';
import { BUCKETS, ObjectStore, type BucketName } from '../storage/object-store.js';
import { mayReadFile, requiredPermissionsFor } from './file-access.policy.js';
import { sanitizeImage } from './image-sanitizer.js';

/**
 * Technical design §7 and NFR-09. Everything that puts bytes into object
 * storage goes through here, and the invariants are enforced in this file
 * rather than asked of the caller:
 *
 * 1. The type is decided by the bytes, not by the client (`magic-bytes.ts`).
 * 2. Images are decoded and re-encoded, so nothing a client supplied is ever
 *    stored verbatim and EXIF cannot survive (`image-sanitizer.ts`).
 * 3. A row in `files` records the key, media type, size, checksum, and
 *    purpose, so an object with no provenance is a detectable anomaly.
 * 4. Reads happen only through a short-lived signed URL, issued after a
 *    permission check (`file-access.policy.ts`).
 */

/** Technical design §7: "Reject uploads over 3MB". */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/** REQ-D-03a: the client already downscales; this is the server's backstop. */
const PHOTO_MAX_EDGE = 1280;
const PHOTO_JPEG_QUALITY = 82;

/** REQ-L-01: the header renders it small, and it is on every page. */
const LOGO_MAX_EDGE = 256;

const BUCKET_BY_PURPOSE: Record<FilePurpose, BucketName> = {
  PUNCH_PHOTO: BUCKETS.PHOTOS,
  PUNCH_PHOTO_THUMB: BUCKETS.PHOTOS,
  ATTACHMENT: BUCKETS.PHOTOS,
  ORG_LOGO: BUCKETS.PHOTOS,
  EXPORT: BUCKETS.EXPORTS,
  IMPORT: BUCKETS.EXPORTS,
};

/** The leading path segment, so a bucket listing is readable by a human. */
const PREFIX_BY_PURPOSE: Record<FilePurpose, string> = {
  PUNCH_PHOTO: 'photos',
  PUNCH_PHOTO_THUMB: 'thumbs',
  ATTACHMENT: 'attachments',
  ORG_LOGO: 'logos',
  EXPORT: 'exports',
  IMPORT: 'imports',
};

export interface StoreImageInput {
  readonly orgId: string;
  /** Null for a system-generated file; the audit trail names the actor. */
  readonly uploadedBy: string | null;
  readonly purpose: FilePurpose;
  readonly bytes: Buffer;
  /**
   * Extra key segments, e.g. the employee id and punch id from §7. Each must
   * be a UUID -- a caller-supplied string in a storage key is a path traversal
   * waiting to be written, and there is no legitimate non-id segment.
   */
  readonly pathSegments?: readonly string[];
  /** REQ-L-03: when the retention job may remove this. */
  readonly expiresAt?: Date | null;
}

export interface StoredFile {
  readonly id: string;
  readonly storageKey: string;
  readonly mime: string;
  readonly bytes: number;
  readonly checksum: string;
  readonly purpose: FilePurpose;
}

export interface SignedFileUrl {
  readonly url: string;
  readonly expiresInSeconds: number;
}

export interface PurgeResult {
  readonly scanned: number;
  readonly purged: number;
  /** Rows whose object had already gone; the row is still closed out. */
  readonly alreadyAbsent: number;
}

/** One batch per run keeps a backlog from holding a transaction open for hours. */
const PURGE_BATCH_SIZE = 500;

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly objects: ObjectStore,
    private readonly auditContext: AuditContext,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- write

  async storeImage(input: StoreImageInput): Promise<StoredFile> {
    if (input.bytes.length === 0) {
      throw new AppError(ERROR_CODES.PUNCH_PHOTO_REQUIRED, 'No image was uploaded.');
    }
    if (input.bytes.length > MAX_UPLOAD_BYTES) {
      throw new AppError(
        ERROR_CODES.PUNCH_PHOTO_INVALID,
        `That image is larger than ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
        { details: { bytes: input.bytes.length, limit: MAX_UPLOAD_BYTES } },
      );
    }

    const wantsPng = input.purpose === 'ORG_LOGO';
    const sanitized = await sanitizeImage(input.bytes, {
      format: wantsPng ? 'png' : 'jpeg',
      maxEdge: wantsPng ? LOGO_MAX_EDGE : PHOTO_MAX_EDGE,
      quality: PHOTO_JPEG_QUALITY,
    });

    // Belt and braces against a future edit to the sanitiser that adds a
    // pass-through branch. Storing the client's bytes is the one thing this
    // service exists to prevent, so it is asserted rather than assumed.
    if (sanitized.bytes.equals(input.bytes)) {
      throw new Error(
        'The sanitiser returned the input buffer unchanged; client bytes must never be stored.',
      );
    }

    const fileId = uuidv7();
    const digest = createHash('sha256').update(sanitized.bytes).digest();
    const storageKey = this.buildKey(input, fileId, sanitized.extension);
    const bucket = BUCKET_BY_PURPOSE[input.purpose];

    await this.objects.put(
      bucket,
      storageKey,
      sanitized.bytes,
      sanitized.mime,
      digest.toString('base64'),
    );

    const inserted = await this.db
      .insert(files)
      .values({
        id: fileId,
        orgId: input.orgId,
        storageKey,
        mime: sanitized.mime,
        bytes: sanitized.bytes.length,
        checksum: digest.toString('hex'),
        purpose: input.purpose,
        uploadedBy: input.uploadedBy,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.uploadedBy,
        updatedBy: input.uploadedBy,
      })
      .returning({ id: files.id });

    if (inserted[0] === undefined) {
      // The object is written but unreferenced. Better to fail loudly and let
      // the retention sweep find an orphan than to return an id that is not
      // in the table.
      throw new Error(`File row insert returned nothing for object ${storageKey}.`);
    }

    // Enrichment, not a write: the interceptor turns this into a row on the
    // request that uploaded the file. Outside a request it is a silent no-op,
    // which is correct -- a job that generates a file audits its own run.
    this.auditContext.record({
      orgId: input.orgId,
      action: 'file.stored',
      entityType: 'file',
      entityId: fileId,
      after: {
        purpose: input.purpose,
        mime: sanitized.mime,
        bytes: sanitized.bytes.length,
        storageKey,
        // Recorded because "what did they upload" and "what did we keep" are
        // different questions during an incident.
        sourceMime: sanitized.sourceType.mime,
        sourceBytes: input.bytes.length,
      },
    });

    return {
      id: fileId,
      storageKey,
      mime: sanitized.mime,
      bytes: sanitized.bytes.length,
      checksum: digest.toString('hex'),
      purpose: input.purpose,
    };
  }

  private buildKey(input: StoreImageInput, fileId: string, extension: string): string {
    for (const segment of input.pathSegments ?? []) {
      if (!isUuid(segment)) {
        throw new Error(`Storage key segment "${segment}" is not an id; refusing to build a key.`);
      }
    }

    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    return [
      PREFIX_BY_PURPOSE[input.purpose],
      input.orgId,
      year,
      month,
      ...(input.pathSegments ?? []),
      `${fileId}.${extension}`,
    ].join('/');
  }

  // ----------------------------------------------------------------- read

  /**
   * NFR-09. Throws NOT_FOUND for another organisation's file -- the repository
   * never sees it -- and FORBIDDEN when the purpose demands a permission the
   * caller does not hold.
   *
   * `ttlSecondsOverride` can only *shorten* the link. A caller asking for a
   * day gets `S3_SIGNED_URL_TTL_SECONDS`, because a signed URL that outlives
   * its purpose is a public URL with extra steps.
   */
  async signedUrlFor(
    principal: Principal,
    fileId: string,
    ttlSecondsOverride?: number,
  ): Promise<SignedFileUrl> {
    const repository = new ScopedRepository(this.db, files, orgContextOf(principal));
    const file = await repository.findById(fileId);

    if (file === null || file.purgedAt !== null) throw AppError.notFound('File', fileId);

    if (!mayReadFile(principal, file)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'You do not have permission to view that file.', {
        details: { requiredAnyOf: [...requiredPermissionsFor(file.purpose)] },
      });
    }

    if (file.expiresAt !== null && file.expiresAt.getTime() <= Date.now()) {
      // Past retention but not yet swept. Handing out a link would serve a
      // photo the employee was told had been deleted (REQ-L-03).
      throw AppError.notFound('File', fileId);
    }

    const ttlSeconds = Math.min(
      ttlSecondsOverride ?? env.S3_SIGNED_URL_TTL_SECONDS,
      env.S3_SIGNED_URL_TTL_SECONDS,
    );

    const url = await this.objects.signedUrl(
      BUCKET_BY_PURPOSE[file.purpose],
      file.storageKey,
      ttlSeconds,
    );

    // Logged, not audited. A muster page issues one of these per row, so a
    // table write here would put five hundred rows into `audit_logs` for a
    // single report render and bury REQ-M-01's actual content. The log line
    // carries the same facts for an investigation.
    this.logger.log({
      msg: 'Signed URL issued',
      fileId,
      purpose: file.purpose,
      actorUserId: principal.userId,
      ttlSeconds,
    });

    return { url, expiresInSeconds: ttlSeconds };
  }

  // ------------------------------------------------------------- retention

  /**
   * REQ-L-03: "A retention job purges photos older than the configured window
   * and nulls `photo_file_id`, leaving the punch record intact." The second
   * half belongs to Phase 1, which owns `punches`; this half deletes the
   * object and closes out the row.
   *
   * Idempotent by construction, not by convention. The selection predicate is
   * `purged_at IS NULL`, and the very last thing done to a row is to set it,
   * so a second run selects nothing. A crash halfway leaves the rows it did
   * not reach still selectable, which is exactly what re-running should fix.
   */
  async purgeExpiredFiles(now: Date = new Date()): Promise<PurgeResult> {
    const due = await this.db
      .select({
        id: files.id,
        orgId: files.orgId,
        storageKey: files.storageKey,
        purpose: files.purpose,
      })
      .from(files)
      .where(
        and(isNotNull(files.expiresAt), lte(files.expiresAt, now), isNull(files.purgedAt)),
      )
      .orderBy(asc(files.expiresAt))
      .limit(PURGE_BATCH_SIZE);

    let purged = 0;
    let alreadyAbsent = 0;
    const purgedByOrg = new Map<string, number>();

    for (const file of due) {
      const bucket = BUCKET_BY_PURPOSE[file.purpose];

      let present: boolean;
      try {
        present = await this.objects.exists(bucket, file.storageKey);
        await this.objects.delete(bucket, file.storageKey);
      } catch (error: unknown) {
        // One unreachable object must not abandon the rest of the batch, and
        // the row stays selectable so the next run retries it.
        this.logger.error({
          msg: 'Could not remove an expired object; the file row is left for the next run.',
          fileId: file.id,
          storageKey: file.storageKey,
          reason: describeError(error),
        });
        continue;
      }

      if (!present) alreadyAbsent += 1;

      await this.db
        .update(files)
        .set({ purgedAt: now, updatedAt: now })
        .where(and(eq(files.id, file.id), isNull(files.purgedAt)));

      purged += 1;
      purgedByOrg.set(file.orgId, (purgedByOrg.get(file.orgId) ?? 0) + 1);
    }

    // Written directly rather than through `AuditContext`: there is no request
    // here, and REQ-M-01 wants the deletion of employee photographs in the
    // trail regardless of what triggered it.
    for (const [orgId, count] of purgedByOrg) {
      await this.audit.write({
        orgId,
        actorUserId: null,
        action: 'file.purged',
        entityType: 'file',
        after: { purged: count, reason: 'retention', at: now.toISOString() },
      });
    }

    if (purged > 0) {
      this.logger.log({ msg: 'Expired files purged', scanned: due.length, purged, alreadyAbsent });
    }

    return { scanned: due.length, purged, alreadyAbsent };
  }

  /** How many rows a purge run would take. Used by the job monitor and tests. */
  async countDueForPurge(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(files)
      .where(and(isNotNull(files.expiresAt), lte(files.expiresAt, now), isNull(files.purgedAt)));
    return rows[0]?.value ?? 0;
  }
}
