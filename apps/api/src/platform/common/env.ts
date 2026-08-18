import { loadDotEnvFiles } from './dotenv.js';
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

loadDotEnvFiles();

export const env: Env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
