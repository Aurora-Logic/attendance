import { Injectable } from '@nestjs/common';
import { DEFAULT_DOCUMENT_SETTINGS, documentSettingsSchema, type DocumentSettings } from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';

const SETTING_KEY = 'documents.settings';

/**
 * The printed documents' identity and designs — one setting, org-wide, read
 * by every document module and written from the design rail. Parsed on the
 * way out so a row written before a field existed still yields a complete
 * object: the defaults fill what the row does not say.
 */
@Injectable()
export class DocumentSettingsService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
  ) {}

  async read(orgId: string): Promise<DocumentSettings> {
    const rows = await this.db.execute<{ value: unknown }>(sql`
      SELECT value FROM settings WHERE org_id = ${orgId} AND scope = 'ORG' AND key = ${SETTING_KEY} AND deleted_at IS NULL LIMIT 1
    `);
    const raw = rows.rows[0]?.value;
    if (raw === undefined || raw === null || typeof raw !== 'object') return DEFAULT_DOCUMENT_SETTINGS;
    const stored = raw as Partial<DocumentSettings>;
    const merged: DocumentSettings = {
      profile: { ...DEFAULT_DOCUMENT_SETTINGS.profile, ...(stored.profile ?? {}) },
      designs: {
        ESTIMATE: { ...DEFAULT_DOCUMENT_SETTINGS.designs.ESTIMATE, ...(stored.designs?.ESTIMATE ?? {}) },
        SALES_ORDER: { ...DEFAULT_DOCUMENT_SETTINGS.designs.SALES_ORDER, ...(stored.designs?.SALES_ORDER ?? {}) },
        INVOICE: { ...DEFAULT_DOCUMENT_SETTINGS.designs.INVOICE, ...(stored.designs?.INVOICE ?? {}) },
        PURCHASE_ORDER: { ...DEFAULT_DOCUMENT_SETTINGS.designs.PURCHASE_ORDER, ...(stored.designs?.PURCHASE_ORDER ?? {}) },
      },
    };
    const parsed = documentSettingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_DOCUMENT_SETTINGS;
  }

  async write(orgId: string, actorUserId: string | null, settings: DocumentSettings): Promise<DocumentSettings> {
    const before = await this.read(orgId);
    await this.db.execute(sql`
      INSERT INTO settings (org_id, scope, scope_id, key, value, created_by, updated_by)
      VALUES (${orgId}, 'ORG', NULL, ${SETTING_KEY}, ${JSON.stringify(settings)}::jsonb, ${actorUserId}, ${actorUserId})
      ON CONFLICT (org_id, scope, (coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)), key) WHERE deleted_at IS NULL
      DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
    `);
    this.auditContext.record({
      action: 'documents.settings.updated',
      entityType: 'organization',
      entityId: orgId,
      before: { profile: before.profile, templates: Object.fromEntries(Object.entries(before.designs).map(([k, v]) => [k, v.templateId])) },
      after: { profile: settings.profile, templates: Object.fromEntries(Object.entries(settings.designs).map(([k, v]) => [k, v.templateId])) },
    });
    return this.read(orgId);
  }
}
