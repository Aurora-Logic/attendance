import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { DeliverPasswordResetHandler } from './handlers/deliver-password-reset.handler.js';
import { LoginRateLimiter } from './login-rate-limit.service.js';
import { PasswordResetRateLimiter } from './password-reset-rate-limit.service.js';
import { SessionService } from './session.service.js';

/**
 * Not global. Nothing outside auth should be able to mint a token or rotate a
 * session; the rest of the application deals in `Principal`, which
 * `RbacModule` provides.
 *
 * The job handler is provided here rather than in `JobsModule` for the reason
 * that module states: a handler registers itself with `JobRegistry`, so the
 * arrow points at `JobsModule` and never back, and the module that owns the
 * work also owns the consumer of it.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    LoginRateLimiter,
    PasswordResetRateLimiter,
    DeliverPasswordResetHandler,
  ],
  exports: [SessionService],
})
export class AuthModule {}
