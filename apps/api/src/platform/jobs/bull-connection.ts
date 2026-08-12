import type { ConnectionOptions } from 'bullmq';

import { redisTarget } from '../redis/redis.provider.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` and refuses to start without
 * it: a worker whose blocking read is aborted mid-flight can lose a job it has
 * already claimed, so the client must keep retrying rather than give up on the
 * command.
 *
 * Returned as fresh options rather than a shared client. A worker holds a
 * blocking read open on its connection, so BullMQ needs its own sockets --
 * sharing the general-purpose client would queue every unrelated command
 * behind a `BRPOP` that is waiting for work that may not arrive for hours.
 */
export function bullConnectionOptions(): ConnectionOptions {
  const target = redisTarget();
  return {
    host: target.host,
    port: target.port,
    ...(target.username === null ? {} : { username: target.username }),
    ...(target.password === null ? {} : { password: target.password }),
    ...(target.db === null ? {} : { db: target.db }),
    ...(target.useTls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
