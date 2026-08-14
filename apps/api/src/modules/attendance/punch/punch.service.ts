import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  OFFLINE_SYNC_MAX_AGE_HOURS,
  PERMISSIONS,
  employeeDisplayName,
  type AttendanceDaySummary,
  type CursorPaginated,
  type PunchContext,
  type PunchFeedQuery,
  type PunchFlag,
  type PunchRecord,
  type PunchSource,
  type PunchSubmission,
  type PunchSyncItem,
  type PunchSyncReport,
  type PunchSyncResult,
  type PunchReceipt,
  type PunchType,
  type PhotoVariant,
  type SignedPhotoUrl,
} from '@vyuha/shared';
import { sql, type SQL } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { env } from '../../../platform/common/env.js';
import { AppError, describeError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { FileService } from '../../../platform/files/file.service.js';
import { sanitizeImage } from '../../../platform/files/image-sanitizer.js';
import { NOTIFICATION_EVENTS } from '../../../platform/notifications/notification-events.js';
import { NotificationDispatcher } from '../../../platform/notifications/notification.dispatcher.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService, type ScopeGrants } from '../../../platform/rbac/scope.service.js';
import { addDays, localDateIn } from '../day-engine/calendar-date.js';
import { DayEngineRepository, type EmployeeContext } from '../day-engine/day-engine.repository.js';
import { DayEngineService } from '../day-engine/day-engine.service.js';
import { AttendanceDayRepository } from '../days/attendance-day.repository.js';
import { dayForViewer, overtimeVisibleTo } from '../days/attendance-day-visibility.js';
import { punches } from '../schema/index.js';
import { burnStamp } from './punch-photo.js';
import {
  chooseAttendanceDate,
  clockSkewSeconds,
  evaluateGeofence,
  isClockSkewed,
  isIpAllowed,
  isWithinWindow,
  normaliseIp,
  windowFor,
  type DateCandidate,
  type PunchWindow,
} from './punch-policy.js';
import { photoExpiry, type PunchSettings } from './punch-settings.js';
import { PunchRepository, type PunchEmployee } from './punch.repository.js';

/**
 * REQ-D-01 … REQ-D-13. The heart of the product, and the file where the order
 * of the checks is the design.
 *
 * Every rejection happens **before** a single byte is written to object
 * storage, so a refused punch leaves nothing behind to reconcile. Every check
 * is here rather than in the controller, and none of them can be satisfied by
 * anything the client says about itself: the photo is re-encoded, the time is
 * the server's, the distance is measured from a centre the client never sees,
 * and the alternating order is read from the database.
 *
 * Two rules are absolute and are asserted directly rather than being properties
 * of the flow: no photo means no punch (REQ-D-02), and one idempotency key
 * means at most one punch (REQ-D-11, enforced by a unique index rather than by
 * this file's good intentions).
 */

/**
 * PRD §2.1 gives every employee `punch.self`, and the attendance-view family
 * decides how much of the punch feed a caller sees. `self` is
 * `attendance.view.self`, which is the key that lets an employee open their own
 * punch history.
 */
export const ATTENDANCE_SCOPE_GRANTS: ScopeGrants = {
  self: PERMISSIONS.ATTENDANCE_VIEW_SELF,
  team: PERMISSIONS.ATTENDANCE_VIEW_TEAM,
  all: PERMISSIONS.ATTENDANCE_VIEW_ALL,
};

/**
 * Flags worth waking HR for. Deliberately excludes `geofence_disabled` and
 * `ip_allowlist_disabled`: until the office coordinates and addresses are
 * supplied (docs OPEN-QUESTIONS items 1 and 3) every punch carries them, and a
 * notification on every punch is a notification nobody reads.
 */
const REVIEW_WORTHY_FLAGS: readonly PunchFlag[] = [
  'outside_window',
  'outside_geofence',
  'device_mismatch',
  'clock_skew',
];

/** REQ-D-08a: "Repeated `no_location` punches ... raise a notification to HR." */
const NO_LOCATION_ALERT_THRESHOLD = 3;
const NO_LOCATION_ALERT_WINDOW_DAYS = 30;

const SECONDS_PER_HOUR = 3600;

/** NFR-09 and technical design §7: "signed URLs valid for 5 minutes". */
const PHOTO_URL_TTL_SECONDS = 300;

export interface RequestMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** One uploaded image, reduced to the only two things that matter about it. */
export interface UploadedPhoto {
  readonly bytes: Buffer;
  readonly fieldName: string;
}

/**
 * What the client asserted, with the channel decided by the server rather than
 * by the request: `POST /punches` may claim WEB or MOBILE, and only
 * `POST /punches/sync` produces OFFLINE_SYNC.
 */
type PunchFacts = Omit<PunchSubmission, 'source'>;
type SourcedFacts = PunchFacts & { readonly source: PunchSource };

/** What a punch decided about itself, before anything is written. */
interface PunchVerdict {
  readonly flags: Set<PunchFlag>;
  readonly outsideWindow: boolean;
  readonly outsideGeofence: boolean;
  readonly deviceMismatch: boolean;
  readonly distanceFromGeofenceM: number | null;
  readonly reasonRequired: boolean;
  /** REQ-D-05 on a live punch; REQ-D-10's queue delay on a synced one. */
  readonly skewSeconds: number;
}

interface ShiftForDate {
  readonly candidate: DateCandidate;
  readonly shiftId: string;
  readonly breakMinutes: number;
}

@Injectable()
export class PunchService {
  private readonly logger = new Logger(PunchService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly files: FileService,
    private readonly dayEngine: DayEngineService,
    private readonly scopes: ScopeService,
    private readonly auditContext: AuditContext,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  // -------------------------------------------------------------- commands

  /** `POST /punches` (REQ-D-01 … REQ-D-13). */
  async punch(
    principal: Principal,
    submission: PunchSubmission,
    photo: UploadedPhoto | null,
    idempotencyKey: string,
    meta: RequestMeta,
  ): Promise<PunchReceipt> {
    return this.record(principal, {
      facts: submission,
      source: submission.source,
      idempotencyKey,
      photo,
      now: new Date(),
      meta,
    });
  }

  /**
   * `POST /punches/sync` (REQ-D-10). One bad entry must not lose the rest of
   * the queue -- a phone that has been offline for a shift is holding the only
   * copy of those punches, and an all-or-nothing drain would throw away four
   * good punches because the fifth was too old.
   */
  async sync(
    principal: Principal,
    items: readonly PunchSyncItem[],
    photos: readonly UploadedPhoto[],
    meta: RequestMeta,
  ): Promise<PunchSyncReport> {
    const now = new Date();
    const results: PunchSyncResult[] = [];

    for (const item of items) {
      const photo = photos[item.photoIndex] ?? null;
      try {
        const receipt = await this.record(principal, {
          facts: item,
          source: 'OFFLINE_SYNC',
          idempotencyKey: item.idempotencyKey,
          photo,
          now,
          meta,
        });
        results.push({
          idempotencyKey: item.idempotencyKey,
          outcome: receipt.replayed ? 'replayed' : 'created',
          punch: receipt.punch,
          error: null,
        });
      } catch (error: unknown) {
        // Rethrown as a per-entry result rather than swallowed: the client is
        // told exactly which key failed and why, and keeps the rest of its
        // queue. Anything that is not an AppError is a bug, and is logged in
        // full before being reported as an internal error.
        if (!(error instanceof AppError)) {
          this.logger.error({
            msg: 'Offline punch failed with an unexpected error.',
            idempotencyKey: item.idempotencyKey,
            reason: describeError(error),
          });
        }
        results.push({
          idempotencyKey: item.idempotencyKey,
          outcome: 'rejected',
          punch: null,
          error: {
            code: error instanceof AppError ? error.code : ERROR_CODES.INTERNAL_ERROR,
            message:
              error instanceof AppError
                ? error.message
                : 'That queued punch could not be recorded.',
          },
        });
      }
    }

    return {
      results,
      created: results.filter((result) => result.outcome === 'created').length,
      replayed: results.filter((result) => result.outcome === 'replayed').length,
      rejected: results.filter((result) => result.outcome === 'rejected').length,
    };
  }

  // ----------------------------------------------------------------- reads

  /** `GET /punches` — the audit feed. Thumbnails only; see `PunchRecord.photo`. */
  async feed(
    principal: Principal,
    query: PunchFeedQuery,
  ): Promise<CursorPaginated<PunchRecord>> {
    const repository = new PunchRepository(this.db, orgContextOf(principal));
    const cursor = decodeCursor(query.cursor);

    // One more than asked for, so "there is another page" is answered without
    // a count over a table that only ever grows.
    const rows = await repository.feed({
      scope: this.scopeFor(principal),
      employeeId: query.employeeId,
      date: query.date,
      from: query.from,
      to: query.to,
      after: cursor,
      limit: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const last = page[page.length - 1];

    return {
      data: page,
      meta: {
        hasMore,
        nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
      },
    };
  }

  /**
   * NFR-09. A signed URL for one punch photo, after two checks rather than
   * one: this endpoint decides whether the caller may see *this punch*, and
   * `FileService` decides whether they may see a file of that purpose.
   *
   * The row-level half has to be here. `file-access.policy.ts` says so in as
   * many words -- it grants a punch photo to anyone holding
   * `attendance.view.team`, with no idea whose punch it is, because `punches`
   * did not exist when it was written.
   */
  async photoUrl(
    principal: Principal,
    punchId: string,
    variant: PhotoVariant,
  ): Promise<SignedPhotoUrl> {
    const repository = new PunchRepository(this.db, orgContextOf(principal));
    const punch = await repository.findById(punchId, this.scopeFor(principal));

    // Out of scope and non-existent are the same answer, for the reason the
    // employee service gives: a 403 would confirm the id names a real punch.
    if (punch === null) throw AppError.notFound('Punch', punchId);

    const fileId = variant === 'full' ? punch.photo.fileId : punch.photo.thumbnailFileId;
    return this.files.signedUrlFor(principal, fileId, PHOTO_URL_TTL_SECONDS);
  }

  /**
   * REQ-D-13: everything the punch screen shows before anyone punches.
   *
   * Answering "you cannot punch, and here is why" is the whole point. A screen
   * that renders a live button and finds out on submit that the employee is
   * inactive has wasted the one photo the employee bothered to take.
   */
  async context(principal: Principal, meta: RequestMeta): Promise<PunchContext> {
    const now = new Date();
    const ctx = orgContextOf(principal);
    const repository = new PunchRepository(this.db, ctx);

    const employeeId = principal.employeeId;
    if (employeeId === null) {
      // Not a 403: an administrator with no employee record (REQ-B-02) still
      // holds `punch.self` through the role hierarchy, and the screen they
      // land on should say why the button is dead rather than fail to load.
      return emptyContext(now, env.DEFAULT_TIMEZONE, {
        code: ERROR_CODES.FORBIDDEN,
        message: 'This account is not linked to an employee record, so it cannot punch.',
      });
    }

    const employee = await repository.findPunchEmployee(employeeId);
    if (employee === null) throw AppError.notFound('Employee', employeeId);

    const settings = await repository.readSettings();
    const blocked = employeeBlockedReason(employee, now);

    let shifts: ShiftForDate[] = [];
    let shiftError: PunchContext['blockedReason'] = null;
    try {
      shifts = await this.candidatesFor(repository, ctx, employee, now);
    } catch (error: unknown) {
      if (!(error instanceof AppError)) throw error;
      shiftError = { code: error.code, message: error.message };
    }

    const today = localDateIn(now, employee.timezone);
    const primary = shifts[0] ?? null;
    const state = primary?.candidate.hasOpenIn ?? false;
    const nextPunchType: PunchType = state ? 'OUT' : 'IN';

    // The date the *next* punch would land on, which for a night-shift OUT is
    // yesterday. Computed with the same function the punch itself uses, so the
    // screen cannot show one date and the receipt another.
    const attendanceDate =
      shifts.length === 0
        ? today
        : chooseAttendanceDate(
            shifts.map((entry) => entry.candidate),
            nextPunchType,
            now,
          );

    const chosen = shifts.find((entry) => entry.candidate.date === attendanceDate) ?? primary;
    const label = chosen === null ? null : await repository.shiftLabel(chosen.shiftId);

    const nextWindow =
      chosen === null
        ? null
        : windowFor(
            chosen.candidate.policy,
            chosen.candidate.scheduledIn,
            chosen.candidate.scheduledOut,
            nextPunchType,
          );
    const insideWindow = nextWindow !== null && isWithinWindow(nextWindow, now);

    const ip = normaliseIp(meta.ip);
    const allowlistConfigured = employee.ipAllowlist.length > 0;

    const [lastPunch, day] = await Promise.all([
      repository.findLatestFor(employee.id),
      this.readDay(principal, employee.id, attendanceDate),
    ]);

    return {
      serverTime: now.toISOString(),
      timezone: employee.timezone,
      attendanceDate,
      employee: {
        id: employee.id,
        name: employeeDisplayName(employee.firstName, employee.lastName),
        employeeCode: employee.employeeCode,
        isFieldStaff: employee.isFieldStaff,
      },
      canPunch: blocked === null && shiftError === null,
      nextPunchType: blocked === null && shiftError === null ? nextPunchType : null,
      shift:
        chosen === null || label === null || nextWindow === null
          ? null
          : {
              id: chosen.shiftId,
              name: label.name,
              code: label.code,
              scheduledIn: chosen.candidate.scheduledIn.toISOString(),
              scheduledOut: chosen.candidate.scheduledOut.toISOString(),
              breakMinutes: chosen.breakMinutes,
              inWindow: windowView(
                windowFor(
                  chosen.candidate.policy,
                  chosen.candidate.scheduledIn,
                  chosen.candidate.scheduledOut,
                  'IN',
                ),
                now,
              ),
              outWindow: windowView(
                windowFor(
                  chosen.candidate.policy,
                  chosen.candidate.scheduledIn,
                  chosen.candidate.scheduledOut,
                  'OUT',
                ),
                now,
              ),
            },
      windowBehaviour: settings.windowBehaviour,
      reasonRequired: !insideWindow && settings.windowBehaviour === 'ALLOW_WITH_REASON',
      photoRequired: true,
      geofence: {
        enforced: employee.geofenceLat !== null && employee.geofenceLng !== null,
        radiusM: employee.geofenceRadiusM,
        exempt: employee.isFieldStaff,
      },
      ipAllowlist: {
        enforced: allowlistConfigured,
        allowed: !allowlistConfigured || isIpAllowed(employee.ipAllowlist, ip),
      },
      lastPunch,
      day,
      blockedReason: blocked ?? shiftError,
    };
  }

  // ------------------------------------------------------------- internals

  private scopeFor(principal: Principal): SQL {
    return this.scopes.resolve(principal, ATTENDANCE_SCOPE_GRANTS, punches.employeeId).where;
  }

  private async record(
    principal: Principal,
    attempt: {
      facts: PunchFacts;
      source: PunchSource;
      idempotencyKey: string;
      photo: UploadedPhoto | null;
      now: Date;
      meta: RequestMeta;
    },
  ): Promise<PunchReceipt> {
    const { facts, source, idempotencyKey, now, meta } = attempt;

    // 1. REQ-D-02, first and unconditionally. "If the camera is unavailable or
    //    denied, punching is blocked ... there is no bypass."
    const photoBytes = attempt.photo?.bytes;
    if (photoBytes === undefined || photoBytes.length === 0) {
      throw new AppError(
        ERROR_CODES.PUNCH_PHOTO_REQUIRED,
        'A photo is required on every punch, in and out.',
      );
    }

    const ctx = orgContextOf(principal);
    const repository = new PunchRepository(this.db, ctx);

    const employeeId = principal.employeeId;
    if (employeeId === null) {
      throw AppError.forbidden(
        'This account is not linked to an employee record, so it cannot punch.',
      );
    }

    // 2. REQ-D-11. Before any work: a retry is the common case on a phone with
    //    one bar of signal, and it must cost a single indexed lookup.
    const replayed = await repository.findByIdempotencyKey(employeeId, idempotencyKey);
    if (replayed !== null) {
      this.auditContext.record({
        action: 'punch.replayed',
        entityType: 'punch',
        entityId: replayed.id,
        after: { idempotencyKey, source },
      });
      return {
        punch: replayed,
        day: await this.readDay(principal, employeeId, replayed.attendanceDate),
        replayed: true,
      };
    }

    const employee = await repository.findPunchEmployee(employeeId);
    if (employee === null) throw AppError.notFound('Employee', employeeId);

    // 3. REQ-A-05: an inactive employee, or one past their last working date,
    //    cannot punch.
    const blocked = employeeBlockedReason(employee, now);
    if (blocked !== null) throw new AppError(blocked.code, blocked.message);

    const settings = await repository.readSettings();
    const candidates = await this.candidatesFor(repository, ctx, employee, now);

    // 4. REQ-C-02. Which day this punch belongs to, decided once, here.
    const attendanceDate = chooseAttendanceDate(
      candidates.map((entry) => entry.candidate),
      facts.type,
      now,
    );
    const chosen = candidates.find((entry) => entry.candidate.date === attendanceDate);
    if (chosen === undefined) {
      throw new Error(`chooseAttendanceDate returned ${attendanceDate}, which is not a candidate.`);
    }

    // 5. REQ-E-09: a locked period accepts nothing, punches included.
    const dayEngineRepository = new DayEngineRepository(this.db, ctx);
    if (await dayEngineRepository.isPeriodLocked(employeeContextOf(employee), attendanceDate)) {
      throw new AppError(
        ERROR_CODES.PERIOD_LOCKED,
        `Attendance for ${attendanceDate} is locked, so no punch can be recorded against it.`,
        { details: { attendanceDate } },
      );
    }

    // 6. REQ-D-01: alternating, strictly ordered. A second IN is refused.
    assertOrdering(facts.type, chosen.candidate.hasOpenIn, attendanceDate);

    const verdict = await this.evaluate(
      repository,
      employee,
      settings,
      chosen,
      { ...facts, source },
      now,
      meta,
      principal,
    );

    // 7. REQ-D-06 / REQ-D-08a. The reason is demanded before the photo is
    //    processed, so a punch that will be refused never reaches storage.
    const reason = facts.reason ?? null;
    if (verdict.reasonRequired && reason === null) {
      throw new AppError(
        ERROR_CODES.PUNCH_REASON_REQUIRED,
        'This punch needs a typed reason before it can be recorded.',
        { details: { flags: [...verdict.flags] } },
      );
    }

    // 8. REQ-D-03 / REQ-D-03a. Decode, strip EXIF, stamp, compress, thumbnail.
    const stored = await this.storePhoto(principal, employee, facts.type, photoBytes, now, settings);

    const inserted = await repository.insert({
      employeeId: employee.id,
      attendanceDate,
      punchType: facts.type,
      serverTime: now,
      clientTime: new Date(facts.clientTime),
      // The same subtraction, filed under the meaning it actually has for this
      // source: a wrong clock on a live punch, a queue delay on a synced one.
      clockSkewSeconds: source === 'OFFLINE_SYNC' ? null : verdict.skewSeconds,
      syncDelaySeconds: source === 'OFFLINE_SYNC' ? verdict.skewSeconds : null,
      photoFileId: stored.photoFileId,
      thumbnailFileId: stored.thumbnailFileId,
      latitude: facts.latitude ?? null,
      longitude: facts.longitude ?? null,
      gpsAccuracyM: facts.gpsAccuracyM ?? null,
      distanceFromGeofenceM: verdict.distanceFromGeofenceM,
      ip: normaliseIp(meta.ip),
      deviceFingerprint: facts.deviceFingerprint ?? null,
      source,
      userAgent: meta.userAgent,
      appVersion: facts.appVersion ?? null,
      isHalfDayMarked: facts.isHalfDay,
      halfDayPart: facts.halfDayPart ?? null,
      outsideWindow: verdict.outsideWindow,
      outsideGeofence: verdict.outsideGeofence,
      deviceMismatch: verdict.deviceMismatch,
      reason,
      flags: [...verdict.flags],
      idempotencyKey,
    });

    // A null insert means the unique index refused it: another request carrying
    // the same key committed while this one was re-encoding a photograph. That
    // request's punch is the punch, and this one returns it (REQ-D-11).
    if (inserted === null) {
      const winner = await repository.findByIdempotencyKey(employee.id, idempotencyKey);
      if (winner === null) {
        throw new Error(
          `Punch insert for key ${idempotencyKey} was refused but no existing punch was found.`,
        );
      }
      return {
        punch: winner,
        day: await this.readDay(principal, employee.id, winner.attendanceDate),
        replayed: true,
      };
    }

    this.auditContext.record({
      action: 'punch.created',
      entityType: 'punch',
      entityId: inserted.id,
      before: null,
      after: {
        type: inserted.type,
        attendanceDate: inserted.attendanceDate,
        serverTime: inserted.serverTime,
        source: inserted.source,
        flags: inserted.flags,
        photoFileId: inserted.photo.fileId,
        reason: inserted.reason,
      },
    });

    // 9. Technical design §5: the engine runs inline on punch creation, "so the
    //    employee sees immediate status".
    const day = await this.computeDayInline(principal, employee.id, attendanceDate, now);
    await this.raiseFlagAlerts(repository, principal.orgId, employee, inserted, attendanceDate);

    return { punch: inserted, day, replayed: false };
  }

  /**
   * Every premises and plausibility check, in the order a reviewer would ask
   * about them. Nothing here writes; it only decides.
   */
  private async evaluate(
    repository: PunchRepository,
    employee: PunchEmployee,
    settings: PunchSettings,
    shift: ShiftForDate,
    facts: SourcedFacts,
    now: Date,
    meta: RequestMeta,
    principal: Principal,
  ): Promise<PunchVerdict> {
    const flags = new Set<PunchFlag>();
    let reasonRequired = false;

    // -- clock (REQ-D-05). Server time already decided everything above; this
    //    only records how far off the device was.
    const skew = clockSkewSeconds(now, new Date(facts.clientTime));
    if (facts.source === 'OFFLINE_SYNC') {
      if (skew > OFFLINE_SYNC_MAX_AGE_HOURS * SECONDS_PER_HOUR) {
        throw new AppError(
          ERROR_CODES.PUNCH_QUEUED_TOO_OLD,
          `This punch was queued more than ${String(OFFLINE_SYNC_MAX_AGE_HOURS)} hours ago. Raise a regularization for it instead.`,
          { details: { queuedAt: facts.clientTime, delaySeconds: skew } },
        );
      }
      // No `offline_sync` flag is stored: `source` already says it, and
      // `PunchRepository` puts it back into the API's flag list. One fact, one
      // column.
    } else if (isClockSkewed(skew)) {
      flags.add('clock_skew');
    }

    // -- window (REQ-D-06)
    const window = windowFor(
      shift.candidate.policy,
      shift.candidate.scheduledIn,
      shift.candidate.scheduledOut,
      facts.type,
    );
    const outsideWindow = !isWithinWindow(window, now);
    if (outsideWindow) {
      if (settings.windowBehaviour === 'BLOCK') {
        throw new AppError(
          ERROR_CODES.PUNCH_OUTSIDE_WINDOW,
          `The punch window for this shift runs from ${window.opens.toISOString()} to ${window.closes.toISOString()}.`,
          {
            details: {
              windowStart: window.opens.toISOString(),
              windowEnd: window.closes.toISOString(),
              punchType: facts.type,
            },
          },
        );
      }
      flags.add('outside_window');
      if (settings.windowBehaviour === 'ALLOW_WITH_REASON') reasonRequired = true;
    }

    // -- network origin (REQ-D-09). Governs web; GPS governs mobile.
    if (facts.source === 'WEB') {
      if (employee.ipAllowlist.length === 0) {
        // OPEN-QUESTIONS item 3. Enforcement is off because there is nothing to
        // enforce, and the flag is what stops that reading as "checked and
        // fine" in a report six months from now.
        flags.add('ip_allowlist_disabled');
      } else if (!isIpAllowed(employee.ipAllowlist, normaliseIp(meta.ip))) {
        await this.auditRejection(principal, employee, 'ip_not_allowed', {
          ip: normaliseIp(meta.ip),
        });
        throw new AppError(
          ERROR_CODES.PUNCH_IP_NOT_ALLOWED,
          'Web punch is only accepted from the office network.',
        );
      }
    }

    // -- location (REQ-D-08, REQ-D-08a)
    let distanceFromGeofenceM: number | null = null;
    let outsideGeofence = false;

    if (facts.isMockLocation) {
      // Before every other location question: a reading the device itself
      // admits is fabricated is not evidence of anything.
      await this.auditRejection(principal, employee, 'mock_location', {
        latitude: facts.latitude ?? null,
        longitude: facts.longitude ?? null,
      });
      throw new AppError(
        ERROR_CODES.PUNCH_MOCK_LOCATION,
        'This device reported a simulated location, so the punch was not recorded.',
      );
    }

    const centre =
      employee.geofenceLat === null || employee.geofenceLng === null
        ? null
        : {
            latitude: employee.geofenceLat,
            longitude: employee.geofenceLng,
            radiusM: employee.geofenceRadiusM,
          };
    const reading =
      facts.latitude === null || facts.latitude === undefined || facts.longitude === null || facts.longitude === undefined
        ? null
        : {
            latitude: facts.latitude,
            longitude: facts.longitude,
            accuracyM: facts.gpsAccuracyM ?? null,
          };

    const verdict = evaluateGeofence(centre, reading);
    switch (verdict.kind) {
      case 'not_configured':
        // OPEN-QUESTIONS item 1. Same reasoning as the allowlist above.
        flags.add('geofence_disabled');
        if (reading === null) flags.add('no_location');
        break;
      case 'no_reading':
        // REQ-D-08a: allowed with a mandatory typed reason, never silently.
        flags.add('no_location');
        reasonRequired = true;
        break;
      case 'inside':
        distanceFromGeofenceM = verdict.distanceM;
        break;
      case 'tolerated':
        distanceFromGeofenceM = verdict.distanceM;
        flags.add('low_gps_accuracy');
        break;
      case 'outside':
        distanceFromGeofenceM = verdict.distanceM;
        if (employee.isFieldStaff) {
          // REQ-D-08: "Employees flagged as field staff are exempt." Recorded
          // as genuinely outside, because it was -- the exemption is about who
          // may punch there, not about pretending they were at the office.
          flags.add('field_staff_exempt');
          outsideGeofence = true;
          break;
        }
        await this.auditRejection(principal, employee, 'outside_geofence', {
          distanceM: Math.round(verdict.distanceM),
          radiusM: employee.geofenceRadiusM,
        });
        throw new AppError(
          ERROR_CODES.PUNCH_OUTSIDE_GEOFENCE,
          `You are about ${String(Math.round(verdict.distanceM))} m from the office, outside the ${String(employee.geofenceRadiusM)} m punch area.`,
          {
            details: {
              distanceM: Math.round(verdict.distanceM),
              radiusM: employee.geofenceRadiusM,
              accuracyM: facts.gpsAccuracyM ?? null,
            },
          },
        );
    }

    if (employee.isFieldStaff && verdict.kind !== 'outside') flags.add('field_staff_exempt');

    // -- device (REQ-B-08, WARN by 05-decisions)
    const fingerprint = facts.deviceFingerprint ?? null;
    let deviceMismatch = false;
    if (settings.deviceBindingMode !== 'OFF') {
      const device = await repository.deviceState(employee.id, fingerprint);
      if (device.enrolled && !device.known) {
        if (settings.deviceBindingMode === 'ENFORCE') {
          throw new AppError(
            ERROR_CODES.PUNCH_DEVICE_NOT_BOUND,
            'This device is not registered for your account.',
          );
        }
        deviceMismatch = true;
      }
    }

    return {
      flags,
      outsideWindow,
      outsideGeofence,
      deviceMismatch,
      distanceFromGeofenceM,
      reasonRequired,
      skewSeconds: skew,
    };
  }

  /**
   * Technical design §7's pipeline, in order: sanitise, stamp, compress,
   * thumbnail.
   *
   * The sanitiser runs first and separately from `FileService.storeImage`
   * because the stamp has to be burned into *clean* pixels -- an image that
   * still carries its EXIF orientation would be stamped upside down on half
   * the phones in the building. `storeImage` re-encodes again afterwards, which
   * is what lands the object in the REQ-D-03a band.
   */
  private async storePhoto(
    principal: Principal,
    employee: PunchEmployee,
    punchType: PunchType,
    bytes: Buffer,
    now: Date,
    settings: PunchSettings,
  ): Promise<{ photoFileId: string; thumbnailFileId: string }> {
    const sanitised = await sanitizeImage(bytes, { format: 'jpeg', maxEdge: 1280, quality: 92 });

    const stamped = await burnStamp(sanitised.bytes, {
      employeeName: employeeDisplayName(employee.firstName, employee.lastName),
      employeeCode: employee.employeeCode,
      punchType,
      serverTime: now,
      timezone: employee.timezone,
    });

    // REQ-L-03: stamped at write time, so the purge job's sweep over
    // `files.expires_at` selects punch photos without knowing they are punch
    // photos. The retention months are read from the same settings row the
    // Settings screen edits, which is what makes the consent notice's promise
    // a fact rather than copy.
    const expiresAt = photoExpiry(now, settings.photoRetentionMonths);

    const photo = await this.files.storeImage({
      orgId: principal.orgId,
      uploadedBy: principal.userId,
      purpose: 'PUNCH_PHOTO',
      bytes: stamped,
      pathSegments: [employee.id],
      maxBytes: settings.photoMaxBytes,
      expiresAt,
    });

    // From the stamped image, not the original: REQ-D-03a's thumbnail is what
    // every list renders, and a thumbnail without the stamp would be the one
    // view of a punch photo that carries no evidence. It expires with the full
    // image -- a purged photo whose thumbnail survives is not purged.
    const thumbnail = await this.files.storeImage({
      orgId: principal.orgId,
      uploadedBy: principal.userId,
      purpose: 'PUNCH_PHOTO_THUMB',
      bytes: stamped,
      pathSegments: [employee.id],
      expiresAt,
    });

    return { photoFileId: photo.id, thumbnailFileId: thumbnail.id };
  }

  /**
   * The candidate dates a punch could belong to, today first.
   *
   * Yesterday is offered only while its own shift window is still open, which
   * is what keeps a night shift's 02:00 OUT attached to the day it started
   * (REQ-C-02) without letting an ordinary evening punch drift backwards.
   */
  private async candidatesFor(
    repository: PunchRepository,
    ctx: OrgContext,
    employee: PunchEmployee,
    now: Date,
  ): Promise<ShiftForDate[]> {
    const dayEngineRepository = new DayEngineRepository(this.db, ctx);
    const employeeContext = employeeContextOf(employee);

    const today = localDateIn(now, employee.timezone);
    const yesterday = addDays(today, -1);

    const [todayShift, yesterdayShift] = await Promise.all([
      dayEngineRepository.resolveShift(employeeContext, today),
      dayEngineRepository.resolveShift(employeeContext, yesterday),
    ]);

    if (todayShift === null) {
      // The same refusal the day engine makes, and for the same reason: every
      // threshold lives on the shift row (REQ-C-01), the general shift's
      // timings are still unanswered (OPEN-QUESTIONS item 2), and there is no
      // honest default to invent.
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'You have no shift for today: no roster assignment covers it and no default shift is set.',
        { details: { employeeId: employee.id, date: today } },
      );
    }

    const dates = [today];
    const yesterdayStillOpen =
      yesterdayShift !== null &&
      now.getTime() <=
        yesterdayShift.scheduledOut.getTime() +
          yesterdayShift.policy.graceOutAfter * 60_000;
    if (yesterdayStillOpen) dates.push(yesterday);

    const states = new Map(
      (await repository.punchStateFor(employee.id, dates)).map((state) => [state.date, state]),
    );

    const build = (date: string, resolved: NonNullable<typeof todayShift>): ShiftForDate => ({
      candidate: {
        date,
        scheduledIn: resolved.scheduledIn,
        scheduledOut: resolved.scheduledOut,
        policy: resolved.policy,
        hasOpenIn: states.get(date)?.hasOpenIn ?? false,
      },
      shiftId: resolved.policy.id,
      breakMinutes: resolved.policy.breakMinutes,
    });

    const built = [build(today, todayShift)];
    if (yesterdayStillOpen && yesterdayShift !== null) built.push(build(yesterday, yesterdayShift));
    return built;
  }

  /** Technical design §5: inline on punch, so the employee sees status now. */
  private async computeDayInline(
    principal: Principal,
    employeeId: string,
    date: string,
    now: Date,
  ): Promise<AttendanceDaySummary | null> {
    const outcome = await this.dayEngine.forOrg(orgContextOf(principal)).computeDay(employeeId, date, { now });
    if (outcome.outcome === 'locked') return null;
    return this.readDay(principal, employeeId, date);
  }

  /**
   * Read back unscoped within the organisation. The employee just punched, so
   * they are entitled to their own day whatever breadth their permissions give
   * them for other people's.
   *
   * Entitled to the day, not to every field on it: the receipt and
   * `GET /me/today` embed the same row `GET /attendance/days` serves, and a
   * figure withheld from the muster that arrives in a punch receipt instead is
   * not withheld at all.
   */
  private async readDay(
    principal: Principal,
    employeeId: string,
    date: string,
  ): Promise<AttendanceDaySummary | null> {
    const repository = new AttendanceDayRepository(this.db, orgContextOf(principal));
    const day = await repository.findDay(employeeId, date, sql`true`);
    return day === null ? null : dayForViewer(day, overtimeVisibleTo(principal));
  }

  /**
   * REQ-D-06 ("flagged for approval") and REQ-D-08a ("repeat offenders raise a
   * notification to HR"), as far as Phase 1 goes: the approval record itself
   * belongs to §4.I, which is a later slice.
   *
   * A notification failure never fails a punch. The employee's attendance is
   * recorded either way, and an exception here would undo nothing -- the row
   * is already committed -- while turning a Redis hiccup into a refused punch.
   */
  private async raiseFlagAlerts(
    repository: PunchRepository,
    orgId: string,
    employee: PunchEmployee,
    punch: PunchRecord,
    attendanceDate: string,
  ): Promise<void> {
    const noteworthy = punch.flags.filter((flag) => REVIEW_WORTHY_FLAGS.includes(flag));

    if (punch.flags.includes('no_location')) {
      const repeats = await repository.countFlagged(
        employee.id,
        'no_location',
        addDays(attendanceDate, -NO_LOCATION_ALERT_WINDOW_DAYS),
      );
      if (repeats >= NO_LOCATION_ALERT_THRESHOLD) noteworthy.push('no_location');
    }

    if (noteworthy.length === 0) return;

    try {
      await this.notifications.emit({
        orgId,
        type: NOTIFICATION_EVENTS.PUNCH_FLAGGED,
        audience: { kind: 'permission', key: PERMISSIONS.ATTENDANCE_VIEW_ALL },
        payload: {
          punchId: punch.id,
          employeeName: punch.employee.name,
          date: attendanceDate,
          flags: noteworthy.join(', '),
        },
        idempotencyKey: `punch-flagged-${punch.id}`,
      });
    } catch (error: unknown) {
      this.logger.error({
        msg: 'Could not queue the flagged-punch notification; the punch itself is recorded.',
        punchId: punch.id,
        reason: describeError(error),
      });
    }
  }

  /**
   * A refusal leaves no punch row, and `AuditInterceptor` only audits
   * successful requests -- so the three refusals that are anti-fraud signals
   * are written here directly. A geofence rejection that leaves no trace is a
   * rejection nobody can count.
   */
  private async auditRejection(
    principal: Principal,
    employee: PunchEmployee,
    reason: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.write({
      orgId: principal.orgId,
      actorUserId: principal.userId,
      action: 'punch.rejected',
      entityType: 'punch',
      entityId: null,
      after: { reason, employeeId: employee.id, employeeCode: employee.employeeCode, ...details },
    });
  }
}

// ------------------------------------------------------------- free helpers

function employeeContextOf(employee: PunchEmployee): EmployeeContext {
  return {
    id: employee.id,
    locationId: employee.locationId,
    defaultShiftId: employee.defaultShiftId,
    weeklyOffPatternId: employee.weeklyOffPatternId,
    holidayCalendarId: employee.holidayCalendarId,
    timezone: employee.timezone,
  };
}

/** REQ-A-05 and REQ-D-01, as the one question "may this person punch at all". */
function employeeBlockedReason(
  employee: PunchEmployee,
  now: Date,
): { code: typeof ERROR_CODES.PUNCH_EMPLOYEE_INACTIVE; message: string } | null {
  if (employee.status === 'INACTIVE') {
    return {
      code: ERROR_CODES.PUNCH_EMPLOYEE_INACTIVE,
      message: 'This employee record is inactive, so it cannot record a punch.',
    };
  }

  const leaving = employee.dateOfLeaving;
  if (leaving !== null && localDateIn(now, employee.timezone) > leaving) {
    return {
      code: ERROR_CODES.PUNCH_EMPLOYEE_INACTIVE,
      message: `This employee's last working date was ${leaving}.`,
    };
  }

  return null;
}

/** REQ-D-01. The message names what is already open, not just that it failed. */
function assertOrdering(type: PunchType, hasOpenIn: boolean, attendanceDate: string): void {
  if (type === 'IN' && hasOpenIn) {
    throw new AppError(
      ERROR_CODES.PUNCH_OUT_OF_ORDER,
      'You are already punched in. Punch out before punching in again.',
      { details: { attendanceDate, expected: 'OUT' } },
    );
  }
  if (type === 'OUT' && !hasOpenIn) {
    throw new AppError(
      ERROR_CODES.PUNCH_OUT_OF_ORDER,
      'There is no open punch in to close. Punch in first.',
      { details: { attendanceDate, expected: 'IN' } },
    );
  }
}

function windowView(window: PunchWindow, now: Date): {
  opensAt: string;
  closesAt: string;
  isOpenNow: boolean;
} {
  return {
    opensAt: window.opens.toISOString(),
    closesAt: window.closes.toISOString(),
    isOpenNow: isWithinWindow(window, now),
  };
}

function emptyContext(
  now: Date,
  timezone: string,
  blockedReason: NonNullable<PunchContext['blockedReason']>,
): PunchContext {
  return {
    serverTime: now.toISOString(),
    timezone,
    attendanceDate: localDateIn(now, timezone),
    employee: null,
    canPunch: false,
    nextPunchType: null,
    shift: null,
    windowBehaviour: 'ALLOW_WITH_REASON',
    reasonRequired: false,
    photoRequired: true,
    geofence: { enforced: false, radiusM: 0, exempt: false },
    ipAllowlist: { enforced: false, allowed: false },
    lastPunch: null,
    day: null,
    blockedReason,
  };
}

/**
 * `serverTime|id`, base64url. Opaque to the client on purpose: a cursor that
 * looks like a timestamp is a cursor somebody will hand-edit, and the ordering
 * it encodes is an implementation detail of this endpoint.
 */
function encodeCursor(record: PunchRecord): string {
  return Buffer.from(`${record.serverTime}|${record.id}`, 'utf8').toString('base64url');
}

function decodeCursor(
  cursor: string | undefined,
): { serverTime: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;

  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  const serverTime = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);

  if (separator < 0 || Number.isNaN(serverTime.getTime()) || id.length === 0) {
    throw AppError.validation('That page cursor is not valid.', {
      fields: [{ path: 'cursor', message: 'unreadable' }],
    });
  }

  return { serverTime, id };
}
