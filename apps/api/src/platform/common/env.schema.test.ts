import { describe, expect, it } from 'vitest';

import { EnvValidationError, parseEnv } from './env.schema.js';

/**
 * Technical design §17: the process refuses to start on a missing or malformed
 * variable. These tests exercise the parser directly rather than the singleton
 * in `env.ts`, so they say nothing about whether a `.env` file happens to exist
 * on the machine running them.
 */

const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  API_BASE_URL: 'http://localhost:3000',
  WEB_BASE_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://vyuha:secret@localhost:55432/vyuha',
  REDIS_URL: 'redis://localhost:56379',
  S3_ENDPOINT: 'http://localhost:59000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'vyuha',
  S3_SECRET_ACCESS_KEY: 'vyuha_dev_only',
  S3_BUCKET_PHOTOS: 'vyuha-photos',
  S3_BUCKET_EXPORTS: 'vyuha-exports',
  S3_FORCE_PATH_STYLE: 'true',
  S3_SIGNED_URL_TTL_SECONDS: '300',
  JWT_ACCESS_SECRET: 'H3nRPTZLuVYbC0mQoJ8xW6aKdE1sNfGzT4iAqXpMv2yUrLcB',
  JWT_REFRESH_SECRET: 'Q9wZtYkNb7XeR2sVhD5uMjCa0LgPoIf3TnKr6ByWx1dSlAuE',
  JWT_ACCESS_TTL_SECONDS: '900',
  JWT_REFRESH_TTL_SECONDS: '2592000',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '51025',
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  MAIL_FROM: 'Vyuha <no-reply@vyuha.local>',
  DEFAULT_TIMEZONE: 'Asia/Kolkata',
  LOG_LEVEL: 'debug',
  SENTRY_DSN: '',
};

function envWithout(key: string): NodeJS.ProcessEnv {
  const copy = { ...VALID_ENV };
  delete copy[key];
  return copy;
}

function issuesOf(source: NodeJS.ProcessEnv): Record<string, string> {
  try {
    parseEnv(source);
  } catch (error: unknown) {
    if (!(error instanceof EnvValidationError)) throw error;
    return Object.fromEntries(error.issues.map((issue) => [issue.variable, issue.message]));
  }
  throw new Error('parseEnv accepted an environment it should have rejected.');
}

describe('parseEnv', () => {
  it('accepts a complete environment and converts the typed values', () => {
    const env = parseEnv(VALID_ENV);

    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.SMTP_SECURE).toBe(false);
    // Empty means unset, not an empty username.
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('freezes the result so nothing can rewrite configuration at runtime', () => {
    const env = parseEnv(VALID_ENV);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('rejects a missing variable and says it is missing rather than malformed', () => {
    const issues = issuesOf(envWithout('DATABASE_URL'));
    expect(issues.DATABASE_URL).toBe('is required but not set');
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    const issues = issuesOf({ ...VALID_ENV, JWT_ACCESS_SECRET: 'too-short-for-signing' });
    expect(issues.JWT_ACCESS_SECRET).toContain('at least 32 characters');
  });

  it('rejects the .env.example placeholder even though it is long enough', () => {
    const placeholder = 'replace_me_with_a_48_byte_random_value_before_running';
    // The check has to be a placeholder check, not a length check: a length
    // rule alone would wave this through.
    expect(placeholder.length).toBeGreaterThan(32);

    const issues = issuesOf({ ...VALID_ENV, JWT_ACCESS_SECRET: placeholder });
    expect(issues.JWT_ACCESS_SECRET).toContain('placeholder');
  });

  it('rejects identical access and refresh secrets', () => {
    const issues = issuesOf({
      ...VALID_ENV,
      JWT_REFRESH_SECRET: VALID_ENV.JWT_ACCESS_SECRET,
    });
    expect(issues.JWT_REFRESH_SECRET).toContain('must differ from JWT_ACCESS_SECRET');
  });

  it('reports every invalid variable, not just the first', () => {
    const issues = issuesOf({
      ...VALID_ENV,
      PORT: 'not-a-number',
      DEFAULT_TIMEZONE: 'Mars/Olympus_Mons',
      LOG_LEVEL: 'chatty',
      REDIS_URL: 'http://localhost:56379',
    });

    expect(Object.keys(issues).sort()).toEqual([
      'DEFAULT_TIMEZONE',
      'LOG_LEVEL',
      'PORT',
      'REDIS_URL',
    ]);
  });

  it('never echoes a secret value into the report', () => {
    const secret = 'sup3rsecret-value-that-must-not-be-printed-anywhere';
    // Long enough to pass the length rule, so the failure comes from elsewhere
    // and the report still has to describe the variable without quoting it.
    const message = issuesOf({
      ...VALID_ENV,
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: secret,
    }).JWT_REFRESH_SECRET;

    expect(message).not.toContain(secret);
  });

  it('quotes a non-secret value so the typo is visible', () => {
    const issues = issuesOf({ ...VALID_ENV, PORT: 'not-a-number' });
    expect(issues.PORT).toContain('"not-a-number"');
  });

  it('describes a bad DATABASE_URL by length, never by content', () => {
    const url = 'mysql://vyuha:hunter2@localhost:3306/vyuha';
    const issues = issuesOf({ ...VALID_ENV, DATABASE_URL: url });
    expect(issues.DATABASE_URL).toContain('postgres://');
    expect(issues.DATABASE_URL).not.toContain('hunter2');
    expect(issues.DATABASE_URL).toContain(`${String(url.length)} characters`);
  });

  it('builds a message that names every offending variable', () => {
    let message = '';
    try {
      parseEnv(envWithout('MAIL_FROM'));
    } catch (error: unknown) {
      if (!(error instanceof EnvValidationError)) throw error;
      message = error.message;
    }

    expect(message).toContain('Environment validation failed');
    expect(message).toContain('MAIL_FROM');
    expect(message).toContain('.env.example');
  });
});
