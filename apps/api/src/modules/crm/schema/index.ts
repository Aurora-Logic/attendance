/**
 * CRM tables (09 §4.4). Like attendance's, deliberately not re-exported from
 * `platform/db/schema/index.ts` — see the note there. `drizzle.config.ts`
 * picks these up through its `src/modules/**\/*.schema.ts` glob.
 */
export * from './crm.schema.js';
