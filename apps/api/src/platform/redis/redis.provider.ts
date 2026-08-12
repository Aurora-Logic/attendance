import { Inject, Logger, type Provider } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

import { env } from '../common/env.js';

/**
 * One Redis client for everything that speaks ordinary commands -- today the
 * per-IP login limiter (REQ-B-10), tomorrow anything else that needs a shared
 * counter across instances.
 *
 * BullMQ deliberately does **not** share it. A worker holds a blocking `BRPOP`
 * open on its connection, so a command issued on the same socket waits behind
 * it; BullMQ's own documentation requires a dedicated connection per worker.
 * `bullConnectionOptions()` below hands BullMQ the settings and lets it manage
 * its own sockets.
 */

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const InjectRedis = (): ParameterDecorator => Inject(REDIS_CLIENT);

/**
 * `REDIS_URL` broken into its parts, once.
 *
 * Library-agnostic on purpose. ioredis and BullMQ each declare their own
 * `RedisOptions`, and the two are structurally close but not assignable to one
 * another; a helper typed as either would force a cast at the other call site.
 * This is the shared fact -- where the server is -- and each side builds its
 * own options object from it.
 */
export interface RedisTarget {
  readonly host: string;
  readonly port: number;
  readonly username: string | null;
  readonly password: string | null;
  readonly db: number | null;
  readonly useTls: boolean;
}

export function redisTarget(): RedisTarget {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: url.port === '' ? 6379 : Number.parseInt(url.port, 10),
    username: url.username === '' ? null : decodeURIComponent(url.username),
    password: url.password === '' ? null : decodeURIComponent(url.password),
    // Path is `/0`, `/1`, ... when a database is selected.
    db: url.pathname.length > 1 ? Number.parseInt(url.pathname.slice(1), 10) : null,
    useTls: url.protocol === 'rediss:',
  };
}

function ioredisOptions(): RedisOptions {
  const target = redisTarget();
  return {
    host: target.host,
    port: target.port,
    ...(target.username === null ? {} : { username: target.username }),
    ...(target.password === null ? {} : { password: target.password }),
    ...(target.db === null ? {} : { db: target.db }),
    ...(target.useTls ? { tls: {} } : {}),
  };
}

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis => {
    const logger = new Logger('Redis');
    const client = new Redis({
      ...ioredisOptions(),
      // Three quick tries then fail the command, rather than retrying it
      // forever. The rate limiter has a defined answer for "Redis is not
      // there"; a command that never settles would hang the login instead.
      //
      // The offline queue is left on deliberately. Turning it off makes every
      // command issued before the socket is ready throw -- which is precisely
      // the first login after a deploy, and would have the limiter failing
      // open at the one moment it is most likely to be needed.
      maxRetriesPerRequest: 3,
      connectTimeout: 2_000,
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 5_000),
    });

    // ioredis emits 'error' on a dropped connection. With no listener, Node
    // treats it as unhandled and kills the process -- the API would go down
    // every time Redis restarted.
    client.on('error', (error: Error) => {
      logger.warn({ msg: 'Redis client error; it will reconnect.', err: error.message });
    });

    return client;
  },
};
