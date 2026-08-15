import { z } from 'zod';

/**
 * Technical design §17: "Config strictly through environment variables,
 * validated by Zod at boot — the process refuses to start on a missing or
 * malformed var."
 *
 * The schema and the parser live here, free of side effects, so a test can
 * exercise them without a `.env` on disk. `env.ts` is the boot-time singleton
 * that reads the real process environment and is allowed to throw on import.
 *
 * Every value arrives as a string, so numbers and booleans are declared as
 * strings and piped through a conversion. Declaring them as `z.coerce.number()`
 * would report a missing variable as "expected number, received NaN", which
 * sends the reader looking for a typo that is not there.
 */

const text = z.string().min(1, 'must not be empty');

const wholeNumber = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/u, 'must be a whole number')
    .transform((value) => Number.parseInt(value, 10))
    .pipe(
      z
        .number()
        .int()
        .min(min, `must be at least ${String(min)}`)
        .max(max, `must be at most ${String(max)}`),
    );

const flag = z
  .enum(['true', 'false'], { error: 'must be either "true" or "false"' })
  .transform((value) => value === 'true');

/** Empty string and unset mean the same thing for an optional variable. */
const optionalText = z
  .string()
  .optional()
  .transform((value) => (value !== undefined && value.length > 0 ? value : undefined));

/**
 * A variable with a default. Unset and empty both fall back, so a `.env` that
 * predates the variable still boots -- which is the point: a new switch with a
 * safe default must not turn every existing environment into a failed start.
 */
const optionalChoice = <const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
) =>
  z
    .string()
    .optional()
    .transform((value) => (value !== undefined && value.length > 0 ? value : fallback))
    .pipe(z.enum(values, { error: `must be one of: ${values.join(', ')}` }));

const optionalFlag = (fallback: boolean) =>
  optionalChoice(['true', 'false'], fallback ? 'true' : 'false').transform(
    (value) => value === 'true',
  );

/**
 * Optional, but typed as a plain string so a reader of `env` cannot forget to
 * handle "unset".
 *
 * Only for variables where empty genuinely means "not configured" and the
 * consumer that requires one is guarded elsewhere -- see the SMTP block below,
 * where `superRefine` demands the same variables the moment `MAIL_TRANSPORT` is
 * `smtp`. `optionalText` would be the honest type, and it is the wrong one
 * here: it would flow `string | undefined` into the settings view the web
 * client parses with `z.string()`, which is a screen breaking over a variable
 * nobody set.
 */
const optionalTextOr = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((value) => (value !== undefined && value.length > 0 ? value : fallback));

const optionalWholeNumber = (min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value !== undefined && value.length > 0 ? value : String(fallback)))
    .pipe(wholeNumber(min, max));

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    // A malformed URL is the failure this predicate exists to report; the
    // caller turns `null` into a Zod issue naming the variable.
    return null;
  }
}

const urlWithProtocol = (protocols: readonly string[], label: string) =>
  z.string().refine((value) => {
    const url = parseUrl(value);
    return url !== null && protocols.includes(url.protocol);
  }, `must be a ${label} URL`);

const httpUrl = urlWithProtocol(['http:', 'https:'], 'http:// or https://');

/**
 * The placeholders shipped in `.env.example`. Length alone does not catch
 * them: both are comfortably over 32 characters, so a developer who copies the
 * example and never generates a key would otherwise boot with a secret that is
 * public knowledge in the repository history.
 */
const PLACEHOLDER_SECRETS: readonly string[] = [
  'replace_me_with_a_48_byte_random_value_before_running',
  'replace_me_with_a_different_48_byte_random_value',
];

function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_SECRETS.includes(value) || /replace[_-]?me|change[_-]?me/iu.test(value);
}

const jwtSecret = z
  .string()
  .min(32, 'must be at least 32 characters')
  .refine(
    (value) => !isPlaceholderSecret(value),
    'is still the .env.example placeholder; generate one with: openssl rand -base64 48',
  );

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format();
    return true;
  } catch {
    // Intl throws RangeError for an unknown zone. NFR-05 stores UTC and
    // converts for display, so a wrong zone silently shifts every rendered
    // punch time by hours -- worth refusing to start over.
    return false;
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: wholeNumber(1, 65535),
    API_BASE_URL: httpUrl,
    WEB_BASE_URL: httpUrl,

    DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:'], 'postgres:// or postgresql://'),
    REDIS_URL: urlWithProtocol(['redis:', 'rediss:'], 'redis:// or rediss://'),

    S3_ENDPOINT: httpUrl,
    S3_REGION: text,
    S3_ACCESS_KEY_ID: text,
    S3_SECRET_ACCESS_KEY: text,
    S3_BUCKET_PHOTOS: text,
    S3_BUCKET_EXPORTS: text,
    S3_FORCE_PATH_STYLE: flag,
    // NFR-09: photo URLs are short-lived. A day-long TTL would make a leaked
    // link as good as a public bucket, so the upper bound is deliberate.
    S3_SIGNED_URL_TTL_SECONDS: wholeNumber(30, 3600),

    JWT_ACCESS_SECRET: jwtSecret,
    JWT_REFRESH_SECRET: jwtSecret,
    // REQ-B-05: a short access token is what makes a stolen one survivable.
    JWT_ACCESS_TTL_SECONDS: wholeNumber(60, 3600),
    JWT_REFRESH_TTL_SECONDS: wholeNumber(300, 7_776_000),

    /**
     * The whole SMTP block is optional, because mail is optional.
     *
     * These were required, which meant a deployment with no mail server could
     * not start at all -- and the pilot has none. `MAIL_TRANSPORT` now defaults
     * to `log`, and the `superRefine` below demands a host and a from-address
     * the moment somebody sets it back to `smtp`. Nothing is relaxed for a
     * deployment that sends mail; the requirement simply now attaches to the
     * transport that needs it rather than to every process that boots.
     *
     * 587 is the submission port from RFC 6409 and is only ever reached by a
     * transport that has already been given a host.
     */
    SMTP_HOST: optionalTextOr(''),
    SMTP_PORT: optionalWholeNumber(1, 65535, 587),
    SMTP_SECURE: optionalFlag(false),
    // Mailpit accepts unauthenticated mail locally, so these stay optional.
    SMTP_USER: optionalText,
    SMTP_PASSWORD: optionalText,
    MAIL_FROM: optionalTextOr(''),
    /**
     * Which `Mailer` implementation `MailModule` binds. `log` -- the default --
     * writes the message and its link to the structured log and sends nothing;
     * `smtp` talks to the server configured above.
     *
     * The default is `log` because REQ-B-03's delivery no longer depends on it:
     * `POST /auth/invitations` returns the accept link to the administrator who
     * created it, and they pass it on themselves. An organisation that wants
     * email back sets this to `smtp` and fills in the block above -- the
     * transport interface and both implementations are untouched (REQ-K-02).
     */
    MAIL_TRANSPORT: optionalChoice(['smtp', 'log'], 'log'),

    /**
     * Whether this process consumes the BullMQ queues (technical design §11).
     * Producers are always wired -- an API instance must be able to enqueue --
     * so turning this off splits the deployment into web and worker roles
     * rather than disabling background work.
     */
    JOBS_WORKER_ENABLED: optionalFlag(true),

    /**
     * The Redis key namespace BullMQ puts every queue under.
     *
     * `bull` is BullMQ's own default, so leaving this unset changes nothing.
     * It exists because a queue is addressed by name alone: any two processes
     * pointed at one Redis are the same queue, and either may consume a job
     * the other enqueued. That is correct for two API instances sharing work,
     * and wrong for a staging deployment next to production, or for a test run
     * next to the developer's own API -- where it looks like a job silently
     * doing the wrong thing rather than like a collision.
     */
    JOBS_QUEUE_PREFIX: z
      .string()
      .optional()
      .transform((value) => (value !== undefined && value.length > 0 ? value : 'bull')),

    /**
     * How many reverse-proxy hops sit in front of this process. 0 -- the
     * default, and correct for development -- leaves Express alone: `req.ip`
     * is the socket address and X-Forwarded-For is ignored. Behind Caddy it
     * must be exactly 1 (OPEN-QUESTIONS P0-11): unset, every request appears
     * to come from the proxy and the per-IP login limit throttles the whole
     * company as one client; set too high, the client controls which
     * X-Forwarded-For entry is believed and can spoof past the same limit.
     */
    TRUST_PROXY_HOPS: optionalWholeNumber(0, 10, 0),

    DEFAULT_TIMEZONE: z.string().refine(isValidTimeZone, 'must be a valid IANA time zone'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    SENTRY_DSN: optionalText,
  })
  .superRefine((value, ctx) => {
    // Identical secrets would let a refresh token be presented as an access
    // token, quietly turning the 15-minute access window into a 30-day one.
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }

    // Asking for SMTP without saying where to send it is a process that boots
    // and then fails on the first message. The check that used to run for every
    // deployment now runs for the ones that chose the transport needing it.
    if (value.MAIL_TRANSPORT !== 'smtp') return;

    for (const variable of ['SMTP_HOST', 'MAIL_FROM'] as const) {
      if (value[variable].length > 0) continue;
      ctx.addIssue({
        code: 'custom',
        path: [variable],
        message: 'is required when MAIL_TRANSPORT is "smtp"',
      });
    }
  });

export type Env = Readonly<z.infer<typeof envSchema>>;

/**
 * Variables whose value must never reach a log line or a crash dump. The
 * validation error reports their length instead, which is enough to tell a
 * truncated paste from a missing one.
 */
const SECRET_VARS: ReadonlySet<string> = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'SMTP_PASSWORD',
  'SENTRY_DSN',
]);

export interface EnvIssue {
  readonly variable: string;
  readonly message: string;
}

/** Thrown at boot. The message is the whole report, ready to print. */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(formatIssues(issues));
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

function describeValue(variable: string, raw: string | undefined): string {
  if (raw === undefined) return '';
  if (SECRET_VARS.has(variable)) return ` (received ${String(raw.length)} characters)`;
  const shown = raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
  return ` (received "${shown}")`;
}

function formatIssues(issues: readonly EnvIssue[]): string {
  const width = Math.max(...issues.map((issue) => issue.variable.length));
  const lines = issues.map((issue) => `  ${issue.variable.padEnd(width)}  ${issue.message}`);
  return [
    `Environment validation failed (technical design §17). ${String(issues.length)} problem${issues.length === 1 ? '' : 's'}:`,
    '',
    ...lines,
    '',
    'Set these in the process environment, or copy .env.example to apps/api/.env.',
  ].join('\n');
}

/**
 * Validates a raw environment. Reports every offending variable rather than
 * the first, because fixing one at a time across a dozen restarts is how a
 * developer ends up disabling validation.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return Object.freeze(result.data);

  const seen = new Set<string>();
  const issues: EnvIssue[] = [];

  for (const issue of result.error.issues) {
    const variable = issue.path.map(String).join('.') || '(root)';
    // One line per variable: a piped schema can raise both "not a number" and
    // "out of range" for the same paste, and the second adds nothing.
    if (seen.has(variable)) continue;
    seen.add(variable);

    const raw = source[variable];
    const message =
      raw === undefined
        ? 'is required but not set'
        : `${issue.message}${describeValue(variable, raw)}`;

    issues.push({ variable, message });
  }

  issues.sort((a, b) => a.variable.localeCompare(b.variable));
  throw new EnvValidationError(issues);
}
