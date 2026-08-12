import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseEnv, type Env } from './env.schema.js';

export { EnvValidationError, parseEnv, envSchema } from './env.schema.js';
export type { Env, EnvIssue } from './env.schema.js';

/**
 * The boot-time configuration singleton. Importing this module parses the
 * environment, and a bad environment throws here rather than at the first
 * request that happens to need the offending value (technical design §17).
 *
 * `main.ts` imports it dynamically so the report can be printed on its own
 * instead of buried in a module-load stack trace.
 */

function loadDotEnvFile(): void {
  const envFile = resolve(process.cwd(), '.env');
  if (!existsSync(envFile)) return;
  // Node leaves already-set variables alone, so a value injected by the
  // container, CI, or a one-off shell prefix still wins over the file.
  process.loadEnvFile(envFile);
}

loadDotEnvFile();

export const env: Env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
