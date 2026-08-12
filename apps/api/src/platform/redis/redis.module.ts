import { Global, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { InjectRedis, REDIS_CLIENT, redisProvider } from './redis.provider.js';

/**
 * Global for the same reason `DbModule` is: one connection, shared. A second
 * import elsewhere would open a second socket to the same server and split the
 * counters that only work because everyone reads the same ones.
 */
@Global()
@Module({
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // `quit` finishes in-flight commands; `disconnect` would drop them. An
    // open socket also keeps the event loop alive, so without this the process
    // ignores SIGTERM.
    await this.redis.quit().catch(() => {
      // Already closed, or the server went away first. Either way the process
      // is on its way out and there is nothing left to salvage.
      this.redis.disconnect();
    });
    this.logger.log({ msg: 'Redis client closed.' });
  }
}
