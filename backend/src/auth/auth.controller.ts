import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LoginSchema, RegisterSchema, ResetConfirmSchema, ResetRequestSchema, type LoginInput, type RegisterInput } from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public } from './decorators.js';
import { SessionService, type SessionUser } from './session.service.js';

/** Per-route auth limits; AUTH_RATE_MULTIPLIER lets the test suite raise them (read per request). */
const authLimit = (base: number) => () => base * Number(process.env.AUTH_RATE_MULTIPLIER ?? 1);

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private async signIn(userId: string, req: Request, res: Response): Promise<void> {
    // Rotate: drop any session the browser already presents before issuing a new one.
    const existing = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];
    if (existing) {
      const s = await this.sessions.validate(existing);
      if (s) await this.sessions.revoke(s.sessionId);
    }
    const token = await this.auth.startSession(userId, { userAgent: req.headers['user-agent'], ip: req.ip });
    res.cookie(this.sessions.cookieName, token, { httpOnly: true, sameSite: 'lax', secure: this.sessions.cookieName.startsWith('__Host-'), path: '/', maxAge: this.sessions.absoluteMs });
  }

  @Public()
  @Throttle({ default: { limit: authLimit(5), ttl: 60_000 } })
  @Post('register')
  async register(@Body({ schema: RegisterSchema }) body: RegisterInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(body);
    await this.signIn(user.id, req, res);
    return this.auth.me(user.id);
  }

  @Public()
  @Throttle({ default: { limit: authLimit(10), ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body({ schema: LoginSchema }) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(body);
    await this.signIn(user.id, req, res);
    return this.auth.me(user.id);
  }

  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(user.sessionId);
    res.clearCookie(this.sessions.cookieName, { path: '/' });
  }

  @HttpCode(204)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revokeAll(user.id);
    res.clearCookie(this.sessions.cookieName, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return this.auth.me(user.id);
  }

  @Public()
  @Throttle({ default: { limit: authLimit(5), ttl: 60_000 } })
  @HttpCode(202)
  @Post('password-reset/request')
  async requestReset(@Body({ schema: ResetRequestSchema }) body: { email: string }): Promise<{ ok: true }> {
    await this.auth.requestReset(body.email);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: authLimit(10), ttl: 60_000 } })
  @HttpCode(204)
  @Post('password-reset/confirm')
  async confirmReset(@Body({ schema: ResetConfirmSchema }) body: { token: string; password: string }): Promise<void> {
    await this.auth.confirmReset(body.token, body.password);
  }
}
