import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { assertDecoratorMetadataIsEmitted } from './platform/common/decorator-metadata.js';
import { EnvValidationError } from './platform/common/env.schema.js';

/**
 * Everything below is imported dynamically, and that is deliberate.
 *
 * `env.ts` validates the environment as a side effect of being imported
 * (technical design §17), so a static import would make a bad variable throw
 * during module resolution -- before any handler exists to print the report,
 * and buried under a require stack. `env.schema.ts` above is side-effect free,
 * so the error type is safe to import statically.
 */
async function bootstrap(): Promise<void> {
  assertDecoratorMetadataIsEmitted();

  const { env } = await import('./platform/common/env.js');
  const { API_PREFIX } = await import('./platform/common/constants.js');
  const { REQUEST_ID_HEADER } = await import('./platform/common/request-id.js');
  const { AppModule } = await import('./app.module.js');

  // Buffered until the pino logger is attached, so startup lines are not
  // emitted in Nest's format and then everything else in JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // OPEN-QUESTIONS P0-11. Behind a reverse proxy, `req.ip` is the proxy's
  // socket address until Express is told how many hops to trust -- and then
  // it believes exactly that many X-Forwarded-For entries, counted from the
  // right, no more. The count must match the real topology (Caddy in
  // production is 1): with 0 behind a proxy the per-IP login limit throttles
  // the whole company as one address; with too many, any client spoofs its
  // way past it by writing the header itself. 0 -- the dev default -- leaves
  // Express untouched, so the no-proxy topology behaves exactly as before.
  if (env.TRUST_PROXY_HOPS > 0) {
    const express = app.getHttpAdapter().getInstance() as Express;
    express.set('trust proxy', env.TRUST_PROXY_HOPS);
  }

  app.setGlobalPrefix(API_PREFIX);

  app.use(helmet({
    // The API serves JSON to a web client on a different origin. Helmet's
    // default same-origin resource policy is written for a server that also
    // serves the page, and would block those responses in some browsers.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.enableCors({
    // Exactly one origin, from validated config. No wildcard: `credentials`
    // below carries the rotating refresh cookie (ADR 0002).
    origin: [env.WEB_BASE_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', REQUEST_ID_HEADER],
    // Without this the browser can see the header but script cannot read it,
    // and the web client has nothing to quote in a bug report.
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  // Runs onApplicationShutdown on SIGTERM and SIGINT, which is what ends the
  // Postgres pool (DbModule).
  app.enableShutdownHooks();

  await app.listen(env.PORT);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    // The report is the whole message; a stack trace here would only point at
    // the parser, never at the variable the reader has to fix.
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`API failed to start: ${String(error)}\n`);
  if (error instanceof Error && error.stack !== undefined) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
});
