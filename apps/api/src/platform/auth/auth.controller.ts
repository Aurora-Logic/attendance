import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { PERMISSIONS } from '@vyuha/shared';
import type { Request, Response } from 'express';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { Authenticated, Public, RequirePermission, WindowExempt } from '../rbac/route-policy.js';
import {
  AcceptInvitationDto,
  ConfirmPasswordResetDto,
  CreateInvitationDto,
  IssuePasswordResetDto,
  LoginDto,
  RequestPasswordResetDto,
  type LoginResponse,
  type MeResponse,
} from './auth.dto.js';
import {
  AuthService,
  type InvitationResult,
  type PasswordResetLink,
  type SignInAccount,
} from './auth.service.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie.js';
import type { SessionRequestContext } from './session.service.js';

/**
 * CLAUDE.md §6: "Controllers validate and delegate." Everything here reads a
 * request, hands it to `AuthService`, and translates the result into HTTP.
 * There is no branch in this file that decides anything about a credential.
 *
 * The one thing the controller does own is the refresh cookie, because it is
 * an HTTP concern: `AuthService` deals in tokens and never sees a `Response`.
 *
 * **There is no signup route** (ADR 0002), and there is no route that issues
 * an account except `POST /invitations`, which requires `employee.manage`.
 */
// 12 REQ-AB-05: the session plumbing stays reachable; login refuses on its own terms.
@WindowExempt()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(body, requestContext(req));
    setRefreshCookie(res, result.refreshToken);
    return result.response;
  }

  /**
   * REQ-B-05. Public because the access token it exists to replace has
   * expired; the refresh cookie is the credential.
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const presented = readRefreshCookie(req) ?? '';
    try {
      const result = await this.auth.refresh(presented, requestContext(req));
      setRefreshCookie(res, result.refreshToken);
      return result.response;
    } catch (error: unknown) {
      // Whatever went wrong, the cookie the browser holds is now worthless --
      // and after reuse detection it is actively dangerous to keep resending.
      // Clearing it here means the client's next step is the login screen
      // rather than a refresh loop against a dead family.
      clearRefreshCookie(res);
      throw error;
    }
  }

  /**
   * Public rather than authenticated: signing out must work when the access
   * token has already expired, which is the common case. The refresh cookie
   * is `SameSite=Strict`, so a cross-site request cannot carry it and cannot
   * log anyone out.
   */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
  }

  /**
   * REQ-B-03. `employee.manage` is the HR/Admin key from PRD §2.1 -- the
   * decorator names a permission, never a role.
   *
   * The 201 carries the accept link. There is no mail server by default
   * (`MAIL_TRANSPORT=log`), so this response *is* the delivery: the
   * administrator copies the link and passes it on. See `AuthService`.
   */
  @Post('invitations')
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  createInvitation(
    @CurrentUser() principal: Principal,
    @Body() body: CreateInvitationDto,
  ): Promise<InvitationResult> {
    return this.auth.createInvitation(principal, body);
  }

  /**
   * Whether an employee already has a login, for the screen that decides
   * whether to offer them one.
   *
   * Under `employee.manage` and not `roles.manage`: `GET /employees/:id/access`
   * answers this and also returns the person's role list, which is a different
   * and more sensitive question. An invite screen that read *that* would refuse
   * HR -- the role the screen exists for -- so it reads this instead.
   */
  @Get('invitations/for-employee/:employeeId')
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  readSignInAccount(
    @CurrentUser() principal: Principal,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ): Promise<SignInAccount> {
    return this.auth.readSignInAccount(principal, employeeId);
  }

  @Post('invitations/:token/accept')
  @Public()
  @HttpCode(HttpStatus.OK)
  acceptInvitation(
    @Param('token') token: string,
    @Body() body: AcceptInvitationDto,
  ): Promise<{ userId: string; email: string }> {
    return this.auth.acceptInvitation(token, body.password);
  }

  /**
   * REQ-B-04. Always 202, whether or not the address has an account: a
   * different answer for an unknown address is an account enumeration oracle.
   */
  @Post('password-resets')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body() body: RequestPasswordResetDto,
    @Req() req: Request,
  ): Promise<{ status: 'accepted' }> {
    await this.auth.requestPasswordReset(body.email, req.ip ?? null);
    return { status: 'accepted' };
  }

  /**
   * REQ-B-04 for an administrator holding `employee.manage`, and a separate
   * route from the public one above on purpose -- `AuthService` states why at
   * length. In short: the public endpoint is unauthenticated and must never
   * return a link; this one is the only way to help somebody reset a password
   * when no mail server is configured.
   *
   * The literal segment cannot collide with `password-resets/:token/confirm`:
   * that route matches two segments after the resource and this one matches
   * one.
   */
  @Post('password-resets/for-employee')
  @RequirePermission(PERMISSIONS.EMPLOYEE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  issuePasswordResetLink(
    @CurrentUser() principal: Principal,
    @Body() body: IssuePasswordResetDto,
  ): Promise<PasswordResetLink> {
    return this.auth.issuePasswordResetLink(principal, body.employeeId);
  }

  @Post('password-resets/:token/confirm')
  @Public()
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(
    @Param('token') token: string,
    @Body() body: ConfirmPasswordResetDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string }> {
    const result = await this.auth.confirmPasswordReset(token, body.password);
    // Every session was just revoked, including whichever one this browser
    // held. Leaving the cookie would send a revoked token on the next refresh.
    clearRefreshCookie(res);
    return result;
  }

  /** Technical design §10: what the web client reads to decide what to render. */
  @Get('me')
  @Authenticated()
  me(@CurrentUser() principal: Principal): Promise<MeResponse> {
    return this.auth.me(principal);
  }
}

function requestContext(req: Request): SessionRequestContext {
  const userAgent = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    // REQ-B-06 shows this in the session list, so it is attacker-controlled
    // text destined for a screen. Truncated here; escaped at render.
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}
