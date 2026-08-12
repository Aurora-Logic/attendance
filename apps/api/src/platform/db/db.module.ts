import { Global, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';

import { DRIZZLE, InjectPool, PG_POOL, drizzleProvider, pgPoolProvider } from './db.provider.js';

/**
 * Global because every module that will ever exist -- attendance now, CRM and
 * ERP later -- needs the same single pool. A second `DbModule` import
 * elsewhere would quietly open a second pool against the same database.
 */
@Global()
@Module({
  providers: [pgPoolProvider, drizzleProvider],
  exports: [DRIZZLE, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DbModule.name);

  constructor(@InjectPool() private readonly pool: Pool) {}

  /**
   * Ends the pool on shutdown so in-flight statements finish and the process
   * can exit. Without this, `pnpm dev` leaves connections behind on every
   * reload until Postgres refuses new ones.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    this.logger.log({ msg: 'Postgres pool closed.' });
  }
}
