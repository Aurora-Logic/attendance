import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@vyuha/shared';
import { z } from 'zod';

import { AuditContext } from '../audit/audit-context.js';
import { AppError, describeError } from '../common/errors.js';
import { env } from '../common/env.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { Mailer } from '../mail/mailer.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import {
  ATTENDANCE_SETTINGS,
  DEFAULT_ATTENDANCE_POLICY,
  DEFAULT_PHOTO_POLICY,
  PHOTO_SETTINGS,
  attendancePolicySchema,
  photoPolicySchema,
  resolveGroup,
  type AttendancePolicy,
  type PhotoPolicy,
  type SettingConsumer,
} from './settings.catalogue.js';
import type { UpdateSettingsInput } from './settings.dto.js';
import { SettingsRepository, type OrgProfilePatch, type OrgProfileRow } from './settings.repository.js';

/**
 * REQ-L-01 to REQ-L-05: read and change organisation settings, and audit the
 * change with before and after values.
 *
 * The audit entry is built from a read taken *before* the write and a read
 * taken after it, rather than from the request body. The body says what was
 * asked for; two reads say what happened, which is the only version worth
 * keeping when a partial patch, a default, and a stored value all disagree.
 */

export interface EmailSettingsView {
  /** `smtp` sends; `log` writes the message to the application log instead. */
  readonly transport: 'smtp' | 'log';
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly from: string;
  /** Whether a username and password are configured. Neither is ever returned. */
  readonly credentialsConfigured: boolean;
}

export interface OrgSettingsView {
  readonly organisation: OrgProfileRow;
  readonly attendance: AttendancePolicy;
  readonly photo: PhotoPolicy;
  readonly email: EmailSettingsView;
  /**
   * What reads each policy field today, or null when nothing does. The screen
   * says so beside the field; see the note in `settings.catalogue.ts`.
   */
  readonly enforcement: {
    readonly attendance: Readonly<Record<string, SettingConsumer>>;
    readonly photo: Readonly<Record<string, SettingConsumer>>;
  };
  /**
   * Stored rows that no longer satisfy their schema. The screen shows the
   * default it fell back to and names the key, because the settings screen is
   * the only place a corrupt row can be repaired.
   */
  readonly unreadableKeys: readonly string[];
}

export interface TestEmailResult {
  readonly sentTo: string;
  readonly transport: 'smtp' | 'log';
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
    private readonly mailer: Mailer,
  ) {}

  async read(principal: Principal): Promise<OrgSettingsView> {
    return this.compose(this.repository(principal));
  }

  async update(principal: Principal, input: UpdateSettingsInput): Promise<OrgSettingsView> {
    const repository = this.repository(principal);
    const before = await this.compose(repository);

    const profile = profilePatchOf(input);
    const values = this.valuePatchOf(before, input);

    await repository.write({ profile, values });

    const after = await this.compose(repository);

    // REQ-L-05. `diffJson` in the audit service narrows this to the fields
    // that actually moved, so sending the whole view costs nothing and means a
    // field added later is audited without anyone remembering to add it here.
    this.auditContext.record({
      action: 'settings.updated',
      entityType: 'settings',
      entityId: before.organisation.id,
      before: auditShape(before),
      after: auditShape(after),
    });

    return after;
  }

  /**
   * REQ-L-04's test send.
   *
   * The recipient is the caller's own address and cannot be chosen. A test-send
   * that accepts an arbitrary address is a mail relay with an admin login in
   * front of it, and "does our SMTP work" is answered just as well by a message
   * the administrator can read in their own inbox.
   */
  async sendTestEmail(principal: Principal): Promise<TestEmailResult> {
    const profile = await this.requireProfile(this.repository(principal));

    try {
      await this.mailer.send({
        to: principal.email,
        subject: `${profile.name}: test message`,
        body:
          'This is a test message sent from the Settings screen. ' +
          'Receiving it means outbound email is configured correctly. ' +
          'Nothing was changed by sending it.',
      });
    } catch (error: unknown) {
      this.logger.error({
        msg: 'Test email failed to send.',
        reason: describeError(error),
        orgId: principal.orgId,
        actorUserId: principal.userId,
      });
      // Rethrown with context rather than swallowed: the whole point of the
      // button is to report the transport's answer.
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'The message could not be sent. The mail server refused it or could not be reached.',
        { cause: error },
      );
    }

    this.auditContext.record({
      action: 'settings.email_tested',
      entityType: 'settings',
      entityId: profile.id,
      after: { sentTo: principal.email, transport: env.MAIL_TRANSPORT },
    });

    return { sentTo: principal.email, transport: env.MAIL_TRANSPORT };
  }

  // ------------------------------------------------------------- internals

  private repository(principal: Principal): SettingsRepository {
    return new SettingsRepository(this.db, orgContextOf(principal));
  }

  private async compose(repository: SettingsRepository): Promise<OrgSettingsView> {
    const [organisation, rows] = await Promise.all([
      this.requireProfile(repository),
      repository.readValues(),
    ]);

    const attendance = resolveGroup(
      attendancePolicySchema,
      ATTENDANCE_SETTINGS,
      DEFAULT_ATTENDANCE_POLICY,
      rows,
    );
    const photo = resolveGroup(photoPolicySchema, PHOTO_SETTINGS, DEFAULT_PHOTO_POLICY, rows);

    return {
      organisation,
      attendance: attendance.value,
      photo: photo.value,
      email: emailView(),
      enforcement: {
        attendance: enforcementOf(ATTENDANCE_SETTINGS),
        photo: enforcementOf(PHOTO_SETTINGS),
      },
      unreadableKeys: [...attendance.unreadable, ...photo.unreadable],
    };
  }

  private async requireProfile(repository: SettingsRepository): Promise<OrgProfileRow> {
    const profile = await repository.readProfile();
    if (profile === null) {
      // The principal carries an org id the guard already resolved, so a
      // missing row is a deleted organisation rather than a bad request.
      throw AppError.notFound('Organisation');
    }
    return profile;
  }

  /**
   * The rows to write, validated against the *merged* policy rather than
   * against the patch.
   *
   * `photoPolicySchema` refuses an inverted size band, and that rule can be
   * broken by a body that sends only `maxBytes`. Merging first is what makes
   * the cross-field rules mean anything.
   */
  private valuePatchOf(
    current: OrgSettingsView,
    input: UpdateSettingsInput,
  ): Map<string, unknown> {
    const values = new Map<string, unknown>();

    if (input.attendance !== undefined) {
      const merged = parseMerged(
        attendancePolicySchema,
        { ...current.attendance, ...input.attendance },
        'attendance',
      );
      for (const [field, descriptor] of Object.entries(ATTENDANCE_SETTINGS)) {
        if (!(field in input.attendance)) continue;
        values.set(descriptor.key, merged[field as keyof AttendancePolicy]);
      }
    }

    if (input.photo !== undefined) {
      const merged = parseMerged(
        photoPolicySchema,
        { ...current.photo, ...input.photo },
        'photo',
      );
      for (const [field, descriptor] of Object.entries(PHOTO_SETTINGS)) {
        if (!(field in input.photo)) continue;
        values.set(descriptor.key, merged[field as keyof PhotoPolicy]);
      }
    }

    return values;
  }
}

function parseMerged<TSchema extends z.ZodType>(
  schema: TSchema,
  candidate: unknown,
  group: string,
): z.infer<TSchema> {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  throw AppError.validation(`The ${group} settings would not be valid after this change.`, {
    issues: z.treeifyError(parsed.error),
  });
}

/** Only the keys the body actually carried, so absent means "leave alone". */
function profilePatchOf(input: UpdateSettingsInput): OrgProfilePatch {
  const patch: Record<string, unknown> = {};
  if (input.organisation === undefined) return patch;
  for (const [field, value] of Object.entries(input.organisation)) {
    if (value === undefined) continue;
    patch[field] = value;
  }
  return patch;
}

function enforcementOf(
  descriptors: Record<string, { readonly enforcedBy: SettingConsumer }>,
): Record<string, SettingConsumer> {
  return Object.fromEntries(
    Object.entries(descriptors).map(([field, descriptor]) => [field, descriptor.enforcedBy]),
  );
}

/**
 * What goes in the audit diff.
 *
 * `enforcement` and `email` are excluded: neither is stored, neither can be
 * changed by this endpoint, and including them would put a constant in every
 * before/after pair for the reader to skip past.
 */
function auditShape(view: OrgSettingsView): Record<string, unknown> {
  return {
    organisation: view.organisation,
    attendance: view.attendance,
    photo: view.photo,
  };
}

function emailView(): EmailSettingsView {
  return {
    transport: env.MAIL_TRANSPORT,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    from: env.MAIL_FROM,
    // The values themselves never leave the process. Whether they are set is
    // the part an administrator needs in order to read the transport's answer.
    credentialsConfigured: Boolean(env.SMTP_USER) && Boolean(env.SMTP_PASSWORD),
  };
}
