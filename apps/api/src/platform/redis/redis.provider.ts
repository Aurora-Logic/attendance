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

/**
 * How long a command may wait for a Redis that is not answering.
 *
 * ioredis gives up on a queued command after `MAX_RETRIES_PER_REQUEST`
 * reconnection attempts, so the wait a caller actually experiences is that
 * many `reconnectDelayMs` values -- and once an outage has lasted a few
 * seconds, every one of them is the cap. The two numbers therefore multiply,
 * which is the part that was missed: a 5,000ms cap meant a single command took
 * about twenty seconds to fail, and a sign-in makes two of them.
 *
 * Exported so `redis.provider.test.ts` can hold the product to a stated bound
 * rather than each half to a number that looks reasonable on its own.
 */
export const MAX_RETRIES_PER_REQUEST = 3;
export const RECONNECT_DELAY_CAP_MS = 1_000;

export function reconnectDelayMs(attempt: number): number {
  return Math.min(attempt * 200, RECONNECT_DELAY_CAP_MS);
}

/** The worst a caller waits before the fail-open path runs. */
export function commandGiveUpMs(): number {
  return MAX_RETRIES_PER_REQUEST * RECONNECT_DELAY_CAP_MS;
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

function createDisabledRedis(): Redis {
  const logger = new Logger('Redis');
  logger.log({ msg: 'JOBS_WORKER_ENABLED is false; Redis connection is disabled.' });

  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      // Very important: do NOT trap 'then', 'catch', or 'finally', otherwise
      // JavaScript/NestJS treats this object as a Promise and hangs forever.
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined;
      }
      if (prop === 'status') return 'ready';
      if (
        prop === 'on' ||
        prop === 'once' ||
        prop === 'addListener' ||
        prop === 'removeListener' ||
        prop === 'off'
      ) {
        return () => proxy;
      }
      if (prop === 'quit' || prop === 'disconnect') {
        return () => Promise.resolve('OK');
      }
      if (prop === 'evalsha' || prop === 'eval') {
        // Return claimed slot for Lua scripts: [status: 1, oldestScore: '']
        return () => Promise.resolve([1, '']);
      }
      return () => Promise.resolve(1);
    },
  };

  const proxy = new Proxy({}, handler) as unknown as Redis;
  return proxy;
}

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis => {
    if (!env.JOBS_WORKER_ENABLED) {
      return createDisabledRedis();
    }

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
      //
      // "Quick" is the retry cap's job, not this number's, and the cap used to
      // be 5,000: a few seconds into an outage the strategy always sits there,
      // so a command took about twenty seconds to fail and a sign-in -- two
      // commands -- was measured at 35.3s against an unreachable Redis. The
      // limiter failed open exactly as documented, half a minute after anybody
      // cared. See `commandGiveUpMs`.
      maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
      connectTimeout: 2_000,
      retryStrategy: reconnectDelayMs,
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
