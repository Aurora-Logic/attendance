import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimiter } from './login-rate-limit.service.js';
import { PasswordResetRateLimiter } from './password-reset-rate-limit.service.js';
import { SessionService } from './session.service.js';

/**
 * Not global. Nothing outside auth should be able to mint a token or rotate a
 * session; the rest of the application deals in `Principal`, which
 * `RbacModule` provides.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, LoginRateLimiter, PasswordResetRateLimiter],
  exports: [SessionService],
})
export class AuthModule {}
