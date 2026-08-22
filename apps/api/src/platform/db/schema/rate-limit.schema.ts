import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { primaryId } from '../columns.js';

/**
 * The Postgres fallback for the Redis sorted-set rate limiters
 * (`LoginRateLimiter`, `PasswordResetRateLimiter`) when Redis is unreachable.
 *
 * One generic table for every limiter, not one per limiter — mirrors
 * `redis.provider.ts`'s own "one client for everything that speaks ordinary
 * commands" philosophy. `bucket` names which limiter+window this row belongs
 * to ('login', 'pwreset:ip', 'pwreset:email', ...); `subject` is the IP or
 * email being limited. One row per attempt, exactly like a Redis sorted-set
 * member, so the DB path replicates the same sliding-window semantics rather
 * than approximating it with a single counter row.
 */
export const rateLimitFallbackAttempts = pgTable(
  'rate_limit_fallback_attempts',
  {
    id: primaryId(),
    bucket: text('bucket').notNull(),
    subject: text('subject').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rate_limit_fallback_attempts_bucket_subject_idx').on(t.bucket, t.subject, t.attemptedAt)],
);
