import {
  employeeDisplayName,
  type EmployeeStatus,
  type HalfDayPart,
  type PunchFlag,
  type PunchRecord,
  type PunchSource,
  type PunchType,
} from '@vyuha/shared';
import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../../../platform/db/db.provider.js';
import { devices, employees, locations, organizations, settings } from '../../../platform/db/schema/index.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { punches, shifts } from '../schema/index.js';
import { resolvePunchSettings, type PunchSettings } from './punch-settings.js';

/**
 * Everything the punch endpoints read and the single row they write.
 *
 * `ScopedRepository` is not the base class for the same reason the day engine
 * gives: `punches` carries no soft-delete columns (REQ-D-12), so it does not
 * satisfy `ScopedTable` at all. The rule that base class enforces still holds
 * here -- every statement starts from `orgScoped`, which cannot be called
 * without an org predicate -- and `punch.schema.ts` already names this file as
 * the one place that filters `org_id` by hand.
 */

/** The `punches` columns plus the employee the row is about. */
const PUNCH_COLUMNS = {
  id: punches.id,
  employeeId: punches.employeeId,
  employeeCode: employees.employeeCode,
  employeeFirstName: employees.firstName,
  employeeLastName: employees.lastName,
  attendanceDate: punches.attendanceDate,
  punchType: punches.punchType,
  serverTime: punches.serverTime,
  clientTime: punches.clientTime,
  clockSkewSeconds: punches.clockSkewSeconds,
  syncDelaySeconds: punches.syncDelaySeconds,
  source: punches.source,
  photoFileId: punches.photoFileId,
  thumbnailFileId: punches.thumbnailFileId,
  latitude: punches.latitude,
  longitude: punches.longitude,
  gpsAccuracyM: punches.gpsAccuracyM,
  distanceFromGeofenceM: punches.distanceFromGeofenceM,
  isHalfDayMarked: punches.isHalfDayMarked,
  halfDayPart: punches.halfDayPart,
  outsideWindow: punches.outsideWindow,
  outsideGeofence: punches.outsideGeofence,
  deviceMismatch: punches.deviceMismatch,
  reason: punches.reason,
  flags: punches.flags,
} as const;

interface PunchRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeFirstName: string;
  employeeLastName: string | null;
  attendanceDate: string;
  punchType: PunchType;
  serverTime: Date;
  clientTime: Date | null;
  clockSkewSeconds: number | null;
  syncDelaySeconds: number | null;
  source: PunchSource;
  photoFileId: string;
  thumbnailFileId: string;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyM: number | null;
  distanceFromGeofenceM: number | null;
  isHalfDayMarked: boolean;
  halfDayPart: HalfDayPart | null;
  outsideWindow: boolean;
  outsideGeofence: boolean;
  deviceMismatch: boolean;
  reason: string | null;
  flags: PunchFlag[];
}

/**
 * The complete flag list the API serves, assembled from the three places a
 * punch verdict is stored.
 *
 * `punch.schema.ts` explains the split: the day engine reads
 * `outside_window`, `outside_geofence` and `device_mismatch` as typed
 * booleans, `source` already says whether a punch came off the offline queue,
 * and the rest live in the array. A reader of the API should not have to know
 * any of that, so the seam is closed here, once.
 */
function composeFlags(row: PunchRow): PunchFlag[] {
  const present = new Set<PunchFlag>(row.flags);
  if (row.outsideWindow) present.add('outside_window');
  if (row.outsideGeofence) present.add('outside_geofence');
  if (row.deviceMismatch) present.add('device_mismatch');
  if (row.source === 'OFFLINE_SYNC') present.add('offline_sync');
  // Canonical order, so two reads of the same row cannot differ by arrangement.
  return PUNCH_FLAG_ORDER.filter((flag) => present.has(flag));
}

const PUNCH_FLAG_ORDER: readonly PunchFlag[] = [
  'outside_window',
  'outside_geofence',
  'low_gps_accuracy',
  'no_location',
  'geofence_disabled',
  'ip_allowlist_disabled',
  'field_staff_exempt',
  'device_mismatch',
  'clock_skew',
  'offline_sync',
];

function toPunchRecord(row: PunchRow): PunchRecord {
  return {
    id: row.id,
    employee: {
      id: row.employeeId,
      name: employeeDisplayName(row.employeeFirstName, row.employeeLastName),
    },
    employeeCode: row.employeeCode,
    attendanceDate: row.attendanceDate,
    type: row.punchType,
    serverTime: row.serverTime.toISOString(),
    clientTime: row.clientTime === null ? null : row.clientTime.toISOString(),
    clockSkewSeconds: row.clockSkewSeconds,
    syncDelaySeconds: row.syncDelaySeconds,
    source: row.source,
    photo: { fileId: row.photoFileId, thumbnailFileId: row.thumbnailFileId },
    location:
      row.latitude === null || row.longitude === null
        ? null
        : {
            latitude: row.latitude,
            longitude: row.longitude,
            accuracyM: row.gpsAccuracyM,
            distanceFromGeofenceM: row.distanceFromGeofenceM,
          },
    isHalfDayMarked: row.isHalfDayMarked,
    halfDayPart: row.halfDayPart,
    reason: row.reason,
    flags: composeFlags(row),
  };
}

/** Who is punching, and everything the policy checks need about them. */
export interface PunchEmployee {
  readonly id: string;
  readonly employeeCode: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly status: EmployeeStatus;
  readonly dateOfLeaving: string | null;
  /** REQ-D-08: exempt from the geofence. */
  readonly isFieldStaff: boolean;
  readonly locationId: string | null;
  readonly defaultShiftId: string | null;
  readonly weeklyOffPatternId: string | null;
  readonly holidayCalendarId: string | null;
  readonly timezone: string;
  /** REQ-D-08: null until the office coordinates are supplied. */
  readonly geofenceLat: number | null;
  readonly geofenceLng: number | null;
  readonly geofenceRadiusM: number;
  /** REQ-D-09: empty until the office addresses are supplied. */
  readonly ipAllowlist: readonly string[];
}

export interface NewPunch {
  readonly employeeId: string;
  readonly attendanceDate: string;
  readonly punchType: PunchType;
  readonly serverTime: Date;
  readonly clientTime: Date | null;
  readonly clockSkewSeconds: number | null;
  readonly syncDelaySeconds: number | null;
  readonly photoFileId: string;
  readonly thumbnailFileId: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly gpsAccuracyM: number | null;
  readonly distanceFromGeofenceM: number | null;
  readonly ip: string | null;
  readonly deviceFingerprint: string | null;
  readonly source: PunchSource;
  readonly userAgent: string | null;
  readonly appVersion: string | null;
  readonly isHalfDayMarked: boolean;
  readonly halfDayPart: HalfDayPart | null;
  readonly outsideWindow: boolean;
  readonly outsideGeofence: boolean;
  readonly deviceMismatch: boolean;
  readonly reason: string | null;
  readonly flags: readonly PunchFlag[];
  readonly idempotencyKey: string;
}

export interface PunchFeedFilters {
  /** Resolved by `ScopeService`; never built here and never optional. */
  readonly scope: SQL;
  readonly employeeId?: string | undefined;
  readonly date?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** Exclusive: rows strictly older than this point in the ordering. */
  readonly after?: { readonly serverTime: Date; readonly id: string } | undefined;
  readonly limit: number;
}

export interface DayPunchState {
  readonly date: string;
  readonly hasOpenIn: boolean;
  readonly lastType: PunchType | null;
}

export class PunchRepository {
  constructor(
    private readonly db: Database,
    private readonly ctx: OrgContext,
  ) {}

  /** Mirrors `ScopedRepository.scoped()`; see the class comment for why. */
  private orgScoped(orgPredicate: SQL, ...extra: (SQL | undefined)[]): SQL {
    const predicate = and(orgPredicate, ...extra);
    if (predicate === undefined) {
      throw new Error('Scope predicate collapsed to undefined; refusing to run an unscoped query.');
    }
    return predicate;
  }

  private baseSelect() {
    return this.db
      .select(PUNCH_COLUMNS)
      .from(punches)
      .innerJoin(
        employees,
        and(
          eq(employees.id, punches.employeeId),
          eq(employees.orgId, this.ctx.orgId),
          isNull(employees.deletedAt),
        ),
      );
  }

  // ------------------------------------------------------------------ reads

  /**
   * The employee plus the premises rules that apply to them. One statement
   * rather than three because every punch needs all of it, and three round
   * trips on the hottest endpoint in the product is three chances to be slow.
   */
  async findPunchEmployee(employeeId: string): Promise<PunchEmployee | null> {
    const rows = await this.db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        status: employees.status,
        dateOfLeaving: employees.dateOfLeaving,
        isFieldStaff: employees.isFieldStaff,
        locationId: employees.locationId,
        defaultShiftId: employees.defaultShiftId,
        weeklyOffPatternId: employees.weeklyOffPatternId,
        holidayCalendarId: sql<
          string | null
        >`coalesce(${employees.holidayCalendarId}, ${locations.holidayCalendarId})`,
        timezone: sql<string>`coalesce(${locations.timezone}, ${organizations.timezone})`,
        geofenceLat: locations.geofenceLat,
        geofenceLng: locations.geofenceLng,
        geofenceRadiusM: sql<number>`coalesce(${locations.geofenceRadiusM}, 100)`,
        ipAllowlist: sql<string[]>`coalesce(${locations.ipAllowlist}, '{}'::text[])`,
      })
      .from(employees)
      .innerJoin(organizations, eq(organizations.id, employees.orgId))
      .leftJoin(locations, and(eq(locations.id, employees.locationId), isNull(locations.deletedAt)))
      .where(
        this.orgScoped(
          eq(employees.orgId, this.ctx.orgId),
          eq(employees.id, employeeId),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /** REQ-D-11. The unique index is what actually enforces this; see `insert`. */
  async findByIdempotencyKey(employeeId: string, key: string): Promise<PunchRecord | null> {
    const rows = await this.baseSelect()
      .where(
        this.orgScoped(
          eq(punches.orgId, this.ctx.orgId),
          eq(punches.employeeId, employeeId),
          eq(punches.idempotencyKey, key),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toPunchRecord(row);
  }

  /**
   * REQ-D-01's "alternating and strictly ordered per attendance day", as the
   * state of each candidate date.
   *
   * `DISTINCT ON` rather than loading every punch: the ordering question only
   * needs the latest row per date, and a long day of punches should not be
   * read in full on every punch.
   */
  async punchStateFor(employeeId: string, dates: readonly string[]): Promise<DayPunchState[]> {
    if (dates.length === 0) return [];

    const rows = await this.db.execute<{ attendance_date: string; punch_type: PunchType }>(sql`
      SELECT DISTINCT ON (attendance_date) attendance_date, punch_type
        FROM punches
       WHERE org_id = ${this.ctx.orgId}
         AND employee_id = ${employeeId}
         AND attendance_date = ANY(${sql.param(dates)}::date[])
       ORDER BY attendance_date, server_time DESC, id DESC
    `);

    const latest = new Map(rows.rows.map((row) => [row.attendance_date, row.punch_type]));
    return dates.map((date) => {
      const lastType = latest.get(date) ?? null;
      return { date, hasOpenIn: lastType === 'IN', lastType };
    });
  }

  async findById(punchId: string, scope: SQL): Promise<PunchRecord | null> {
    const rows = await this.baseSelect()
      .where(this.orgScoped(eq(punches.orgId, this.ctx.orgId), eq(punches.id, punchId), scope))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toPunchRecord(row);
  }

  /** The punches of one attendance day, oldest first, for the day detail. */
  async findForDay(employeeId: string, date: string): Promise<PunchRecord[]> {
    const rows = await this.baseSelect()
      .where(
        this.orgScoped(
          eq(punches.orgId, this.ctx.orgId),
          eq(punches.employeeId, employeeId),
          eq(punches.attendanceDate, date),
        ),
      )
      .orderBy(asc(punches.serverTime), asc(punches.id));

    return rows.map(toPunchRecord);
  }

  /** The employee's most recent punch overall, for REQ-D-13's "last punch". */
  async findLatestFor(employeeId: string): Promise<PunchRecord | null> {
    const rows = await this.baseSelect()
      .where(
        this.orgScoped(eq(punches.orgId, this.ctx.orgId), eq(punches.employeeId, employeeId)),
      )
      .orderBy(desc(punches.serverTime), desc(punches.id))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toPunchRecord(row);
  }

  /**
   * The audit feed, newest first. One row more than asked for, so the caller
   * can tell "this is the last page" from "there is more" without a second
   * count query over a table that only grows.
   */
  async feed(filters: PunchFeedFilters): Promise<PunchRecord[]> {
    const predicates: (SQL | undefined)[] = [
      filters.scope,
      filters.employeeId === undefined ? undefined : eq(punches.employeeId, filters.employeeId),
      filters.date === undefined ? undefined : eq(punches.attendanceDate, filters.date),
      filters.from === undefined ? undefined : gte(punches.attendanceDate, filters.from),
      filters.to === undefined ? undefined : lte(punches.attendanceDate, filters.to),
    ];

    if (filters.after !== undefined) {
      // A row comparison rather than `server_time < cursor`: two punches can
      // share a millisecond -- a double tap produces exactly that -- and
      // comparing on time alone would silently drop one of them at a page
      // boundary. The casts are explicit because an untyped parameter on the
      // right of a row comparison is resolved by Postgres from the left, and
      // relying on that inference is how a cursor starts throwing after a
      // column type changes.
      predicates.push(
        sql`(${punches.serverTime}, ${punches.id}) < (${filters.after.serverTime}::timestamptz, ${filters.after.id}::uuid)`,
      );
    }

    const rows = await this.baseSelect()
      .where(this.orgScoped(eq(punches.orgId, this.ctx.orgId), ...predicates))
      .orderBy(desc(punches.serverTime), desc(punches.id))
      .limit(filters.limit);

    return rows.map(toPunchRecord);
  }

  /**
   * REQ-D-08a: "Repeated `no_location` punches by the same employee raise a
   * notification to HR." Counted over a window rather than for all time, so a
   * single bad week two years ago does not keep the alarm ringing.
   */
  async countFlagged(employeeId: string, flag: PunchFlag, sinceDate: string): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(punches)
      .where(
        this.orgScoped(
          eq(punches.orgId, this.ctx.orgId),
          eq(punches.employeeId, employeeId),
          gte(punches.attendanceDate, sinceDate),
          sql`${punches.flags} @> ARRAY[${flag}]::text[]`,
        ),
      );

    return rows[0]?.value ?? 0;
  }

  /** Display name and code for a shift, for REQ-D-13's "today's shift". */
  async shiftLabel(shiftId: string): Promise<{ name: string; code: string } | null> {
    const rows = await this.db
      .select({ name: shifts.name, code: shifts.code })
      .from(shifts)
      .where(
        this.orgScoped(
          eq(shifts.orgId, this.ctx.orgId),
          eq(shifts.id, shiftId),
          isNull(shifts.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * REQ-B-08. Whether this employee has *any* enrolled device, and whether this
   * fingerprint is one of them.
   *
   * Both halves are needed because there is no enrolment path yet: with no
   * registered devices, every punch would otherwise be a "mismatch" and the
   * flag would mean nothing. An employee with no device on file is not
   * mismatched, they are simply not enrolled.
   */
  async deviceState(
    employeeId: string,
    fingerprint: string | null,
  ): Promise<{ enrolled: boolean; known: boolean }> {
    const rows = await this.db
      .select({
        fingerprint: devices.fingerprint,
      })
      .from(devices)
      .where(
        this.orgScoped(
          eq(devices.orgId, this.ctx.orgId),
          eq(devices.employeeId, employeeId),
          eq(devices.status, 'ACTIVE'),
          isNull(devices.deletedAt),
        ),
      );

    if (rows.length === 0) return { enrolled: false, known: false };
    return {
      enrolled: true,
      known: fingerprint !== null && rows.some((row) => row.fingerprint === fingerprint),
    };
  }

  /** REQ-L-02: punch policy lives in rows, so it changes without a deploy. */
  async readSettings(): Promise<PunchSettings> {
    const rows = await this.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(
        this.orgScoped(
          eq(settings.orgId, this.ctx.orgId),
          eq(settings.scope, 'ORG'),
          isNull(settings.scopeId),
          isNull(settings.deletedAt),
        ),
      );

    return resolvePunchSettings(new Map(rows.map((row) => [row.key, row.value])));
  }

  // ------------------------------------------------------------------ write

  /**
   * The only write in the punch path, and the only one there will ever be:
   * REQ-D-12 makes the row immutable, and migration 0004's trigger refuses an
   * UPDATE or DELETE regardless of what any service believes.
   *
   * `onConflictDoNothing` on the idempotency index rather than a pre-flight
   * check alone. The check in the service answers for the instant it ran; two
   * requests carrying the same key can both pass it, and only the index
   * decides. A null return here means the other request won, and the caller
   * reads the row it wrote.
   */
  async insert(values: NewPunch): Promise<PunchRecord | null> {
    const inserted = await this.db
      .insert(punches)
      .values({
        orgId: this.ctx.orgId,
        employeeId: values.employeeId,
        attendanceDate: values.attendanceDate,
        punchType: values.punchType,
        serverTime: values.serverTime,
        clientTime: values.clientTime,
        clockSkewSeconds: values.clockSkewSeconds,
        syncDelaySeconds: values.syncDelaySeconds,
        photoFileId: values.photoFileId,
        thumbnailFileId: values.thumbnailFileId,
        latitude: values.latitude,
        longitude: values.longitude,
        gpsAccuracyM: values.gpsAccuracyM,
        distanceFromGeofenceM: values.distanceFromGeofenceM,
        ip: values.ip,
        deviceFingerprint: values.deviceFingerprint,
        source: values.source,
        userAgent: values.userAgent,
        appVersion: values.appVersion,
        isHalfDayMarked: values.isHalfDayMarked,
        halfDayPart: values.halfDayPart,
        outsideWindow: values.outsideWindow,
        outsideGeofence: values.outsideGeofence,
        deviceMismatch: values.deviceMismatch,
        reason: values.reason,
        flags: [...values.flags],
        idempotencyKey: values.idempotencyKey,
        createdAt: values.serverTime,
        createdBy: this.ctx.actorUserId,
      })
      .onConflictDoNothing({ target: [punches.employeeId, punches.idempotencyKey] })
      .returning({ id: punches.id });

    const id = inserted[0]?.id;
    if (id === undefined) return null;

    const rows = await this.baseSelect()
      .where(this.orgScoped(eq(punches.orgId, this.ctx.orgId), eq(punches.id, id)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Punch ${id} was written but could not be read back.`);
    }
    return toPunchRecord(row);
  }
}
