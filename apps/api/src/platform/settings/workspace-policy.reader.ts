import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { InjectDatabase, type Database } from '../db/db.provider.js';
import { settings } from '../db/schema/index.js';
import { resolveGroup, type SettingDescriptor } from './settings.catalogue.js';

/**
 * Reads one settings group for an organisation without a principal: the
 * session service at sign-in, the export service when a file is written,
 * the nightly purge. The same catalogue, the same defaults and the same
 * repair-per-field as the settings screen, so a row the screen would show
 * as unreadable is the default here too.
 */
@Injectable()
export class WorkspacePolicyReader {
  constructor(@InjectDatabase() private readonly db: Database) {}

  async read<TSchema extends z.ZodType>(
    orgId: string,
    schema: TSchema,
    descriptors: Record<string, SettingDescriptor>,
    fallback: z.infer<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const rows = await this.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(and(eq(settings.orgId, orgId), eq(settings.scope, 'ORG'), isNull(settings.scopeId), isNull(settings.deletedAt)));
    return resolveGroup(schema, descriptors, fallback, new Map(rows.map((row) => [row.key, row.value]))).value;
  }
}
