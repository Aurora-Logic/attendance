/**
 * Attendance tables (technical design §4.2).
 *
 * Deliberately not re-exported from `platform/db/schema/index.ts`: the §1
 * dependency rule says platform must never reach into a module, and a barrel
 * that pulled these in would make that violation invisible. `drizzle.config.ts`
 * picks them up through its own `src/modules/**\/*.schema.ts` glob.
 */
export * from './attendance-day.schema.js';
export * from './holiday.schema.js';
export * from './leave.schema.js';
export * from './punch.schema.js';
export * from './regularization.schema.js';
export * from './shift.schema.js';
