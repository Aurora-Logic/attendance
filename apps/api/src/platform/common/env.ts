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
  const envCandidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ];
  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      try { process.loadEnvFile(envPath); } catch {}
    }
  }
}


loadDotEnvFile();

export const env: Env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
